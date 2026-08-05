/**
 * [INPUT]: 依赖 agents SDK（Agent/SQLite/State 同步/ws）、@hangtola/domain（schema/patch/迁移/标识）与 ../models/deepseek 模型边界
 * [OUTPUT]: 对外提供 HangtolaAgent Durable Object：每榜一实例；ensureBoard/getPublicSnapshot/getFullSnapshot/commitPatchRpc/revertRpc/listRevisionsRpc/chatRpc/generateRpc 与 ws 协议
 * [POS]: 榜单事实的唯一守门人——一切修改走 commitPatch 单一路径产不可变 revision；Agent State 只放公开投影，隐私靠类型收窄
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { Agent, type Connection } from 'agents';
import {
  BoardDocumentV2,
  BoardPatchV1,
  applyPatch,
  PatchError,
  migrateLegacyToV2,
  toPublicView,
  newItemId,
  newRevisionId,
  newEditKey,
  hashEditKey,
  type BoardDocumentV2T,
  type BoardPatchV1T,
  type PublicBoardView,
} from '@hangtola/domain';
import type { Env } from '../env.js';
import { DDL, type RevisionRow } from './sql.js';
import { createModelClient } from '../models/deepseek.js';

interface Generation {
  status: 'idle' | 'running' | 'failed' | 'done';
  stage: string;
  pct: number;
  detail?: string;
}

export interface PublicState {
  publicDoc: PublicBoardView | null;
  head: string | null;
  generation: Generation;
}

type CommitOutcome =
  | { ok: true; head: string; summary: string }
  | { ok: false; error: 'forbidden' }
  | { ok: false; error: 'conflict'; head: string; doc: BoardDocumentV2T }
  | { ok: false; error: 'invalid'; message: string };

const IDLE: Generation = { status: 'idle', stage: '', pct: 0 };

/** 资产 URL 生成：P2 只有 dataurl 图片，占位实现留给 P3 接 R2 */
const assetUrl = (assetId: string): string => `/assets/${assetId}`;

export class HangtolaAgent extends Agent<Env, PublicState> {
  override initialState: PublicState = { publicDoc: null, head: null, generation: IDLE };

  #authed = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const statement of DDL) this.#exec(statement);
  }

  /* ---- SQLite 原语 ---- */
  #exec(statement: string): Record<string, unknown>[] {
    const strings = Object.assign([statement], { raw: [statement] }) as unknown as TemplateStringsArray;
    return this.sql(strings) as Record<string, unknown>[];
  }

  #metaGet(key: string): string | null {
    const rows = this.sql`SELECT value FROM meta WHERE key = ${key}` as { value: string }[];
    return rows[0]?.value ?? null;
  }

  #metaSet(key: string, value: string): void {
    this.sql`INSERT INTO meta (key, value) VALUES (${key}, ${value})
             ON CONFLICT(key) DO UPDATE SET value = ${value}`;
  }

  #headId(): string | null {
    return this.#metaGet('head_revision');
  }

  #revisionById(id: string): RevisionRow | null {
    const rows = this.sql`SELECT * FROM revisions WHERE id = ${id}` as unknown as RevisionRow[];
    return rows[0] ?? null;
  }

  #currentDoc(): BoardDocumentV2T {
    const head = this.#headId();
    if (!head) throw new Error('board 未初始化');
    const row = this.#revisionById(head);
    if (!row) throw new Error(`head revision ${head} 缺失`);
    return BoardDocumentV2.parse(JSON.parse(row.doc_json));
  }

  /* ---- 版本写入：唯一路径 ---- */
  #writeRevision(input: {
    kind: 'genesis' | 'generate' | 'patch' | 'revert' | 'import';
    doc: BoardDocumentV2T;
    summary: string;
    author: BoardPatchV1T['author']['kind'];
    patch?: BoardPatchV1T;
    revertOf?: string;
  }): string {
    const id = newRevisionId();
    const parent = this.#headId();
    const patchJson = input.patch ? JSON.stringify(input.patch) : null;
    this.sql`INSERT INTO revisions (id, parent_id, kind, summary, author, created_at, patch_json, doc_json)
             VALUES (${id}, ${parent}, ${input.kind}, ${input.summary}, ${input.author},
                     ${Date.now()}, ${patchJson}, ${JSON.stringify(input.doc)})`;
    this.#metaSet('head_revision', id);
    this.setState({
      publicDoc: toPublicView(input.doc, assetUrl),
      head: id,
      generation: this.state.generation,
    });
    this.#broadcastAuthed({
      type: 'doc.revision',
      revision: { id, kind: input.kind, summary: input.summary, author: input.author },
      doc: input.doc,
    });
    return id;
  }

  #setGeneration(generation: Generation): void {
    this.setState({ ...this.state, generation });
  }

  /* ============================================================
     公开 RPC（HTTP / MCP / 内部共用）
     ============================================================ */

  /** 首次创建返回 editKey（唯一一次）；已存在则拒绝重复初始化 */
  async ensureBoard(boardId: string): Promise<{ created: boolean; editKey?: string }> {
    if (this.#metaGet('board_id')) return { created: false };
    const editKey = newEditKey();
    this.#metaSet('board_id', boardId);
    this.#metaSet('edit_key_hash', await hashEditKey(editKey));
    this.#metaSet('created_at', String(Date.now()));
    const genesis: BoardDocumentV2T = migrateLegacyToV2(
      { id: boardId, tiers: [], pool: [] },
      { newItemId },
    );
    this.#writeRevision({ kind: 'genesis', doc: genesis, summary: '创建榜单', author: 'web' });
    return { created: true, editKey };
  }

  async verifyEdit(editKey: string): Promise<boolean> {
    const stored = this.#metaGet('edit_key_hash');
    if (!stored || !editKey) return false;
    const hashed = await hashEditKey(editKey);
    let mismatch = 0;
    for (let i = 0; i < stored.length; i++) mismatch |= stored.charCodeAt(i) ^ (hashed.charCodeAt(i) || 0);
    const ok = mismatch === 0 && stored.length === hashed.length;
    if (ok) this.#metaSet('last_used_at', String(Date.now()));
    return ok;
  }

  getPublicSnapshot(): { exists: boolean; state: PublicState } {
    return { exists: this.#metaGet('board_id') !== null, state: this.state };
  }

  async getFullSnapshot(editKey: string):
    Promise<{ ok: false } | { ok: true; doc: BoardDocumentV2T; head: string }> {
    if (!(await this.verifyEdit(editKey))) return { ok: false };
    return { ok: true, doc: this.#currentDoc(), head: this.#headId()! };
  }

  async commitPatchRpc(editKey: string, patchRaw: unknown): Promise<CommitOutcome> {
    if (!(await this.verifyEdit(editKey))) return { ok: false, error: 'forbidden' };
    return this.#commit(patchRaw);
  }

  /** 内部提交（agent 自身或已认证 ws）：冲突/非法都以结构化结果返回 */
  #commit(patchRaw: unknown): CommitOutcome {
    let patch: BoardPatchV1T;
    try {
      patch = BoardPatchV1.parse(patchRaw);
    } catch (error) {
      return { ok: false, error: 'invalid', message: `patch 不合法: ${String(error)}` };
    }
    const head = this.#headId();
    if (!head) return { ok: false, error: 'invalid', message: 'board 未初始化' };
    if (patch.baseRevision !== head) {
      return { ok: false, error: 'conflict', head, doc: this.#currentDoc() };
    }
    let next: BoardDocumentV2T;
    try {
      next = applyPatch(this.#currentDoc(), patch, { newItemId });
    } catch (error) {
      if (error instanceof PatchError) return { ok: false, error: 'invalid', message: error.message };
      throw error;
    }
    const id = this.#writeRevision({
      kind: 'patch', doc: next, summary: patch.summary, author: patch.author.kind, patch,
    });
    return { ok: true, head: id, summary: patch.summary };
  }

  async revertRpc(editKey: string, revisionId: string): Promise<CommitOutcome> {
    if (!(await this.verifyEdit(editKey))) return { ok: false, error: 'forbidden' };
    const target = this.#revisionById(revisionId);
    if (!target) return { ok: false, error: 'invalid', message: `revision ${revisionId} 不存在` };
    const doc = BoardDocumentV2.parse(JSON.parse(target.doc_json));
    const summary = `回滚到 ${revisionId.slice(0, 12)}`;
    const id = this.#writeRevision({ kind: 'revert', doc, summary, author: 'web', revertOf: revisionId });
    return { ok: true, head: id, summary };
  }

  async listRevisionsRpc(editKey: string):
    Promise<{ ok: false } | { ok: true; revisions: { id: string; kind: string; summary: string; author: string; createdAt: number; parentId: string | null }[] }> {
    if (!(await this.verifyEdit(editKey))) return { ok: false };
    const rows = this.sql`SELECT id, kind, summary, author, created_at, parent_id
                          FROM revisions ORDER BY created_at ASC, id ASC` as unknown as
      { id: string; kind: string; summary: string; author: string; created_at: number; parent_id: string | null }[];
    return {
      ok: true,
      revisions: rows.map((r) => ({
        id: r.id, kind: r.kind, summary: r.summary, author: r.author,
        createdAt: r.created_at, parentId: r.parent_id,
      })),
    };
  }

  /** 自然语言修改：模型编译 ops → 内部提交；失败零 revision */
  async chatRpc(editKey: string, message: string):
    Promise<{ ok: false } | { ok: true; reply: string; revisionId: string | null; summary: string | null }> {
    if (!(await this.verifyEdit(editKey))) return { ok: false };
    const now = Date.now();
    this.sql`INSERT INTO conversation (id, role, content, revision_id, created_at)
             VALUES (${`msg_${now}_u`}, ${'user'}, ${message}, ${null}, ${now})`;
    const doc = this.#currentDoc();
    const result = await createModelClient(this.env).reviseOps(doc, message);
    let revisionId: string | null = null;
    let reply = result.reply;
    if (result.ok) {
      const outcome = this.#commit({
        schemaVersion: 'patch.v1',
        boardId: doc.id,
        baseRevision: this.#headId(),
        ops: result.ops,
        summary: result.summary,
        author: { kind: 'agent' },
      });
      if (outcome.ok) {
        revisionId = outcome.head;
      } else {
        reply = '这次指令我没能编译成合法修改，榜单保持原样。换个说法试试？';
      }
    }
    this.sql`INSERT INTO conversation (id, role, content, revision_id, created_at)
             VALUES (${`msg_${now}_a`}, ${'assistant'}, ${reply}, ${revisionId}, ${Date.now()})`;
    return { ok: true, reply, revisionId, summary: revisionId ? result.summary : null };
  }

  /** P2：纯文字主题生成（内联执行 + 分阶段进度；P3 迁移到可恢复 Workflow） */
  async generateRpc(editKey: string, input: { topic: string; extraText?: string }):
    Promise<{ ok: false; error: string } | { ok: true; head: string }> {
    if (!(await this.verifyEdit(editKey))) return { ok: false, error: 'forbidden' };
    const taskId = `task_${Date.now()}`;
    const boardId = this.#metaGet('board_id')!;
    this.sql`INSERT INTO tasks (id, kind, status, progress_json, input_json, error, created_at, updated_at)
             VALUES (${taskId}, ${'generate'}, ${'running'}, ${'{}'}, ${JSON.stringify(input)}, ${null}, ${Date.now()}, ${Date.now()})`;
    const step = (stage: string, pct: number) => {
      this.#setGeneration({ status: 'running', stage, pct });
      this.sql`UPDATE tasks SET progress_json = ${JSON.stringify({ stage, pct })}, updated_at = ${Date.now()}
               WHERE id = ${taskId}`;
    };
    try {
      step('寻找候选', 20);
      const draft = await createModelClient(this.env).draftBoard(input);
      step('确定维度', 55);
      const doc = migrateLegacyToV2(
        { ...draft, id: boardId, footnote: '', savedAt: new Date().toISOString() },
        { newItemId },
      );
      step('生成榜单', 90);
      const head = this.#writeRevision({
        kind: 'generate', doc, summary: `按主题「${input.topic}」生成榜单`, author: 'agent',
      });
      this.sql`UPDATE tasks SET status = ${'done'}, updated_at = ${Date.now()} WHERE id = ${taskId}`;
      this.#setGeneration({ status: 'done', stage: '完成', pct: 100 });
      return { ok: true, head };
    } catch (error) {
      this.sql`UPDATE tasks SET status = ${'failed'}, error = ${String(error)}, updated_at = ${Date.now()}
               WHERE id = ${taskId}`;
      this.#setGeneration({ status: 'failed', stage: '生成失败', pct: 0, detail: String(error) });
      return { ok: false, error: String(error) };
    }
  }

  /* ============================================================
     ws 协议：auth / patch / chat / revert / resync
     未认证连接只收 Agent State 同步（公开投影）
     ============================================================ */
  override async onMessage(connection: Connection, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(message) as Record<string, unknown>; } catch { return; }

    if (frame.type === 'auth') {
      const ok = await this.verifyEdit(String(frame.editRef ?? ''));
      if (!ok) { connection.send(JSON.stringify({ type: 'auth.fail' })); return; }
      this.#authed.add(connection.id);
      connection.send(JSON.stringify({ type: 'auth.ok' }));
      connection.send(JSON.stringify({ type: 'doc.full', doc: this.#currentDoc(), head: this.#headId() }));
      return;
    }

    if (!this.#authed.has(connection.id)) {
      connection.send(JSON.stringify({ type: 'error', code: 'unauthed', message: '先发送 auth 帧' }));
      return;
    }

    switch (frame.type) {
      case 'resync':
        connection.send(JSON.stringify({ type: 'doc.full', doc: this.#currentDoc(), head: this.#headId() }));
        return;
      case 'patch': {
        const outcome = this.#commit(frame.patch);
        if (!outcome.ok && outcome.error === 'conflict') {
          connection.send(JSON.stringify({ type: 'patch.conflict', head: outcome.head, doc: outcome.doc }));
        } else if (!outcome.ok) {
          connection.send(JSON.stringify({ type: 'error', code: outcome.error, message: 'message' in outcome ? outcome.message : outcome.error }));
        }
        return;                       // 成功路径由 #writeRevision 广播 doc.revision
      }
      case 'revert': {
        const target = this.#revisionById(String(frame.revisionId ?? ''));
        if (!target) { connection.send(JSON.stringify({ type: 'error', code: 'invalid', message: 'revision 不存在' })); return; }
        const doc = BoardDocumentV2.parse(JSON.parse(target.doc_json));
        this.#writeRevision({ kind: 'revert', doc, summary: `回滚到 ${target.id.slice(0, 12)}`, author: 'web', revertOf: target.id });
        return;
      }
      case 'chat': {
        const result = await this.chatRpcAuthedConnection(String(frame.text ?? ''));
        connection.send(JSON.stringify({ type: 'chat.done', ...result }));
        return;
      }
      default:
        connection.send(JSON.stringify({ type: 'error', code: 'unknown-frame', message: String(frame.type) }));
    }
  }

  /** ws 已认证连接的聊天路径：跳过 editKey 复核 */
  private async chatRpcAuthedConnection(message: string):
    Promise<{ reply: string; revisionId: string | null; summary: string | null }> {
    const now = Date.now();
    this.sql`INSERT INTO conversation (id, role, content, revision_id, created_at)
             VALUES (${`msg_${now}_u`}, ${'user'}, ${message}, ${null}, ${now})`;
    const doc = this.#currentDoc();
    const result = await createModelClient(this.env).reviseOps(doc, message);
    let revisionId: string | null = null;
    let reply = result.reply;
    if (result.ok) {
      const outcome = this.#commit({
        schemaVersion: 'patch.v1', boardId: doc.id, baseRevision: this.#headId(),
        ops: result.ops, summary: result.summary, author: { kind: 'agent' },
      });
      if (outcome.ok) revisionId = outcome.head;
      else reply = '这次指令我没能编译成合法修改，榜单保持原样。换个说法试试？';
    }
    this.sql`INSERT INTO conversation (id, role, content, revision_id, created_at)
             VALUES (${`msg_${now}_a`}, ${'assistant'}, ${reply}, ${revisionId}, ${Date.now()})`;
    return { reply, revisionId, summary: revisionId ? result.summary : null };
  }

  override async onClose(connection: Connection): Promise<void> {
    this.#authed.delete(connection.id);
  }

  #broadcastAuthed(frame: Record<string, unknown>): void {
    const payload = JSON.stringify(frame);
    for (const connection of this.getConnections()) {
      if (this.#authed.has(connection.id)) connection.send(payload);
    }
  }
}
