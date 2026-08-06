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
import { DDL, type RevisionRow, type AssetRow } from './sql.js';
import { createModelClient } from '../models/deepseek.js';
import { createVisionClient } from '../models/vision.js';
import { createSearchClient } from '../models/exa.js';
import { MAX_PREPARE_FILES } from '../limits.js';
import { draftToV2, type DraftShape } from '@hangtola/domain';

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

export class HangtolaAgent extends Agent<Env, PublicState> {
  override initialState: PublicState = { publicDoc: null, head: null, generation: IDLE };

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
    const boardId = this.#metaGet('board_id') ?? input.doc.id;
    this.setState({
      publicDoc: toPublicView(input.doc, (assetId) => `/assets/${boardId}/${assetId}`),
      head: id,
      generation: this.state.generation,
    });
    this.#broadcastAuthed({
      type: 'doc.revision',
      revision: { id, kind: input.kind, summary: input.summary, author: input.author, parentId: parent },
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

  /** P3：生成走可恢复 Workflow；本方法只建任务并点火 */
  async generateRpc(editKey: string, input: { topic: string; extraText?: string }):
    Promise<{ ok: false; error: string } | { ok: true; taskId: string }> {
    if (!(await this.verifyEdit(editKey))) return { ok: false, error: 'forbidden' };
    const boardId = this.#metaGet('board_id')!;
    const taskId = `task_${Date.now()}_${newRevisionId().slice(-6)}`;
    this.sql`INSERT INTO tasks (id, kind, status, progress_json, input_json, error, created_at, updated_at)
             VALUES (${taskId}, ${'generate'}, ${'running'}, ${'{}'}, ${JSON.stringify(input)}, ${null}, ${Date.now()}, ${Date.now()})`;
    this.#setGeneration({ status: 'running', stage: '排队中', pct: 2 });
    await this.env.GEN_WORKFLOW.create({ id: taskId, params: { boardId, taskId, input } });
    return { ok: true, taskId };
  }

  /* ---- Workflow 回调面（仅 Worker 内部 RPC 可达，不经 HTTP 暴露） ---- */

  reportProgress(taskId: string, stage: string, pct: number): void {
    this.#setGeneration({ status: 'running', stage, pct });
    this.sql`UPDATE tasks SET progress_json = ${JSON.stringify({ stage, pct })}, updated_at = ${Date.now()}
             WHERE id = ${taskId}`;
  }

  /** 幂等：Workflow 重放 commit 步骤时返回既有 head，不产生重复 revision */
  commitGenerated(taskId: string, draft: DraftShape, imageByText: Record<string, string>):
    { ok: true; head: string } {
    const rows = this.sql`SELECT status FROM tasks WHERE id = ${taskId}` as { status: string }[];
    if (rows[0]?.status === 'done') return { ok: true, head: this.#headId()! };
    const boardId = this.#metaGet('board_id')!;
    const doc = draftToV2(draft, imageByText, { boardId, newItemId });

    /* 合并语义：任意状态双方可介入——生成期间的人工痕迹不被整版覆盖。
       base 中生成结果未涵盖的条目原档位保留；人工标题/声明/档位名优先 */
    const base = this.#currentDoc();
    const generatedTexts = new Set([
      ...doc.tiers.flatMap((t) => t.items.map((i) => i.text)),
      ...doc.pool.map((i) => i.text),
    ]);
    let kept = 0;
    doc.tiers.forEach((tier, i) => {
      tier.label = base.tiers[i]!.label;
      for (const item of base.tiers[i]!.items) {
        if (!generatedTexts.has(item.text)) { tier.items.push(item); kept += 1; }
      }
    });
    for (const item of base.pool) {
      if (!generatedTexts.has(item.text)) { doc.pool.push(item); kept += 1; }
    }
    if (!doc.title && base.title) doc.title = base.title;
    if (base.footnote) doc.footnote = base.footnote;

    const head = this.#writeRevision({
      kind: 'generate', doc: BoardDocumentV2.parse(doc),
      summary: kept ? `生成榜单（保留你新加的 ${kept} 个条目）` : '生成榜单',
      author: 'agent',
    });
    this.sql`UPDATE tasks SET status = ${'done'}, updated_at = ${Date.now()} WHERE id = ${taskId}`;
    this.#setGeneration({ status: 'done', stage: '完成', pct: 100 });
    return { ok: true, head };
  }

  failTask(taskId: string, error: string): void {
    this.sql`UPDATE tasks SET status = ${'failed'}, error = ${error}, updated_at = ${Date.now()}
             WHERE id = ${taskId}`;
    this.#setGeneration({ status: 'failed', stage: '生成失败', pct: 0, detail: error });
  }

  /* ---- 资产：DO 发一次性上传令牌，Worker 中转写 R2 ---- */

  async prepareAssets(editKey: string, files: { name: string; mime: string }[]):
    Promise<{ ok: false } | { ok: true; assets: { assetId: string; token: string }[] }> {
    if (!(await this.verifyEdit(editKey))) return { ok: false };
    /* 批量闸设在 DO 内而非路由层：DO 是资产态的唯一权威，MCP 与 HTTP 两条路径都必经此处。
       无闸时一次调用即可灌入任意行数 SQLite——超出的部分静默丢弃，不为越界请求扩容。 */
    const accepted = files.slice(0, MAX_PREPARE_FILES);
    const boardId = this.#metaGet('board_id')!;
    const maxRows = this.sql`SELECT COALESCE(MAX(order_index), -1) AS max_index FROM assets` as { max_index: number }[];
    let orderIndex = (maxRows[0]?.max_index ?? -1) + 1;
    const assets: { assetId: string; token: string }[] = [];
    for (const file of accepted) {
      if (!file.mime.startsWith('image/')) continue;
      const assetId = `ast_${newRevisionId().slice(4)}`.slice(0, 20);
      const token = newEditKey();
      this.sql`INSERT INTO assets (id, r2_key, mime, name, order_index, state, upload_token_hash, created_at)
               VALUES (${assetId}, ${`boards/${boardId}/assets/${assetId}`}, ${file.mime}, ${file.name},
                       ${orderIndex}, ${'pending'}, ${await hashEditKey(token)}, ${Date.now()})`;
      assets.push({ assetId, token });
      orderIndex += 1;
    }
    return { ok: true, assets };
  }

  async verifyAssetUpload(assetId: string, token: string):
    Promise<{ ok: false } | { ok: true; r2Key: string; mime: string }> {
    const rows = this.sql`SELECT * FROM assets WHERE id = ${assetId}` as unknown as AssetRow[];
    const row = rows[0];
    if (!row || row.state !== 'pending') return { ok: false };
    if ((await hashEditKey(token)) !== row.upload_token_hash) return { ok: false };
    return { ok: true, r2Key: row.r2_key, mime: row.mime };
  }

  markAssetUploaded(assetId: string): void {
    this.sql`UPDATE assets SET state = ${'uploaded'} WHERE id = ${assetId}`;
  }

  listUploadedAssets(): { id: string; r2Key: string; mime: string; name: string; orderIndex: number }[] {
    const rows = this.sql`SELECT * FROM assets WHERE state = ${'uploaded'} ORDER BY order_index ASC` as unknown as AssetRow[];
    return rows.map((r) => ({ id: r.id, r2Key: r.r2_key, mime: r.mime, name: r.name, orderIndex: r.order_index }));
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
      connection.setState({ authed: true });          // 存连接态：跨 DO 休眠持久
      connection.send(JSON.stringify({ type: 'auth.ok' }));
      connection.send(JSON.stringify({ type: 'doc.full', doc: this.#currentDoc(), head: this.#headId() }));
      return;
    }

    if (!(connection.state as { authed?: boolean } | null)?.authed) {
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
      case 'rankPool': {
        const result = await this.#rankPool();
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

  /** 增量定档：对备选区条目补识图/补证据，编译成只动这些条目的 move/update patch */
  async #rankPool(): Promise<{ reply: string; revisionId: string | null; summary: string | null }> {
    const doc = this.#currentDoc();
    if (doc.pool.length === 0) {
      return { reply: '备选区是空的，没什么可排。', revisionId: null, summary: null };
    }
    const vision = createVisionClient(this.env);
    const search = createSearchClient(this.env);
    const targets: { id: string; text: string; observation: string; evidence: string }[] = [];
    for (const item of doc.pool) {
      /* 识图补观察：仅对无内部依据的带图条目（失败降级为空，不臆造） */
      let observation = item.note || '';
      if (!observation && item.image?.kind === 'asset') {
        try {
          const rows = this.sql`SELECT r2_key, mime FROM assets WHERE id = ${item.image.assetId}` as unknown as
            { r2_key: string; mime: string }[];
          const object = rows[0] ? await this.env.ASSETS.get(rows[0].r2_key) : null;
          if (object) {
            const bytes = new Uint8Array(await object.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            }
            const obs = await vision.observe(`data:${rows[0]!.mime};base64,${btoa(binary)}`, item.text);
            observation = obs.candidates[0]?.name
              ? `${obs.candidates[0].name}：${obs.description}`
              : obs.description;
          }
        } catch { /* 识图失败：无观察即无观察 */ }
      }
      let evidence = 'insufficient';
      try {
        const ev = await search.research(`${doc.title || ''} ${item.text}`.trim());
        if (ev.status === 'supported') {
          evidence = ev.sources.map((src) => src.snippet).join(' / ').slice(0, 150);
        }
      } catch { /* 证据不足如实标注 */ }
      targets.push({ id: item.id, text: item.text, observation, evidence });
    }

    const instruction = `RANK_POOL:${JSON.stringify(targets.map((t) => ({ id: t.id, text: t.text })))}\n`
      + '请把以下备选区条目定档进五档。只允许对这些 itemId 使用 moveItem 与 updateItem，'
      + '禁止新增/删除/触碰其他条目。定档纪律照旧：夯是稀缺的，拉完了要有硬伤；'
      + 'evidence 为 insufficient 的靠常识判断并在 note 注明证据不足。'
      + '每个条目用 updateItem 补一句 note 定档依据。条目与线索：\n'
      + JSON.stringify(targets);
    const result = await createModelClient(this.env).reviseOps(doc, instruction);
    if (!result.ok) return { reply: result.reply, revisionId: null, summary: null };

    /* 白名单收口：越权 op 一律剔除 */
    const allowed = new Set(targets.map((t) => t.id));
    const ops = result.ops.filter((op) =>
      (op.op === 'moveItem' || op.op === 'updateItem') && allowed.has(op.itemId));
    if (ops.length === 0) {
      return { reply: '这次没排成，条目还在备选区，再试一次？', revisionId: null, summary: null };
    }
    const summary = result.summary || `把 ${targets.length} 个备选排进榜单`;
    const outcome = this.#commit({
      schemaVersion: 'patch.v1', boardId: doc.id, baseRevision: this.#headId(),
      ops, summary, author: { kind: 'agent' },
    });
    if (!outcome.ok) return { reply: '排档时撞上了新版本，请再点一次。', revisionId: null, summary: null };
    const now = Date.now();
    this.sql`INSERT INTO conversation (id, role, content, revision_id, created_at)
             VALUES (${`msg_${now}_a`}, ${'assistant'}, ${summary}, ${outcome.head}, ${now})`;
    return { reply: summary, revisionId: outcome.head, summary };
  }

  #broadcastAuthed(frame: Record<string, unknown>): void {
    const payload = JSON.stringify(frame);
    for (const connection of this.getConnections()) {
      if ((connection.state as { authed?: boolean } | null)?.authed) connection.send(payload);
    }
  }
}
