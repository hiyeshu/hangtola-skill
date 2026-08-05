/**
 * [INPUT]: 依赖 Node 18+ fetch/fs、Hangtola HTTP API 与 skills/hangtola/scripts/render-board.js（本地确定性渲染）
 * [OUTPUT]: 对外提供 hangtola CLI：generate/revise（Agent 路径）与 get/apply/revert/render/export（确定性路径）
 * [POS]: packages/cli 的全部实现；editRef 落 ~/.hangtola/boards.json；--base 指向任意部署（默认 https://hangtola.app）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const STORE_DIR = path.join(os.homedir(), '.hangtola');
const STORE = path.join(STORE_DIR, 'boards.json');
const RENDERER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../skills/hangtola/scripts/render-board.js',
);

/* ---- 参数解析：位置参数 + --flag 值 ---- */
const [command = 'help', ...rest] = process.argv.slice(2);
const positional: string[] = [];
const flags = new Map<string, string[]>();
for (let i = 0; i < rest.length; i += 1) {
  const token = rest[i]!;
  const key = token.startsWith('--') ? token.slice(2)
    : (token.startsWith('-') && token.length === 2 ? token.slice(1) : null);
  if (key !== null) {
    const next = rest[i + 1];
    const value = next !== undefined && !next.startsWith('-') ? rest[(i += 1)]! : '';
    flags.set(key, [...(flags.get(key) ?? []), value]);
  } else {
    positional.push(token);
  }
}
const flag = (key: string): string | undefined => flags.get(key)?.at(-1);
const BASE = flag('base') ?? process.env.HANGTOLA_BASE ?? 'https://hangtola.app';

function store(): Record<string, string> {
  try { return JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, string>; } catch { return {}; }
}
function saveRef(boardId: string, editRef: string): void {
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE, JSON.stringify({ ...store(), [boardId]: editRef }, null, 2));
}
function refOf(boardId: string): string {
  const ref = flag('edit-ref') ?? store()[boardId];
  if (!ref) throw new Error(`没有 ${boardId} 的 editRef：用 --edit-ref 提供，或先用本机 generate 创建`);
  return ref;
}

async function api(pathname: string, init: RequestInit = {}, editRef?: string): Promise<Response> {
  return fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(editRef ? { 'X-Edit-Ref': editRef } : {}),
      ...(init.headers ?? {}),
    },
  });
}

const die = (message: string): never => { console.error(`✗ ${message}`); process.exit(1); };
const out = (value: unknown): void => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

async function waitDone(boardId: string): Promise<void> {
  for (;;) {
    const snapshot = await (await api(`/api/boards/${boardId}`)).json() as
      { generation: { status: string; stage: string; pct: number; detail?: string } };
    const gen = snapshot.generation;
    if (gen.status === 'done') { process.stderr.write('\n'); return; }
    if (gen.status === 'failed') die(`生成失败：${gen.detail ?? ''}`);
    process.stderr.write(`\r${gen.stage} ${gen.pct}%   `);
    await new Promise((r) => setTimeout(r, 800));
  }
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
};

async function main(): Promise<void> {
  switch (command) {
    case 'generate': {
      const topic = positional[0] ?? die('用法: hangtola generate "<主题>" [--extra "条目、条目"] [--image a.png]...');
      const created = await (await api('/api/boards', { method: 'POST' })).json() as
        { boardId: string; editRef: string; viewUrl: string; editUrl: string };
      saveRef(created.boardId, created.editRef);
      const images = flags.get('image')?.filter(Boolean) ?? [];
      if (images.length) {
        const files = images.map((file) => ({
          name: path.basename(file),
          mime: MIME[path.extname(file).toLowerCase()] ?? die(`不支持的图片格式: ${file}`),
        }));
        const prep = await (await api(`/api/boards/${created.boardId}/assets/prepare`, {
          method: 'POST', body: JSON.stringify({ files }),
        }, created.editRef)).json() as { assets: { uploadUrl: string }[] };
        for (let i = 0; i < prep.assets.length; i += 1) {          // 串行保序
          const bytes = readFileSync(images[i]!);
          const res = await fetch(`${BASE}${prep.assets[i]!.uploadUrl}`, { method: 'PUT', body: bytes });
          if (!res.ok) die(`上传失败 ${images[i]}: ${res.status}`);
          process.stderr.write(`\r上传 ${i + 1}/${images.length}  `);
        }
      }
      const extra = flag('extra');
      await api(`/api/boards/${created.boardId}/generate`, {
        method: 'POST', body: JSON.stringify({ topic, ...(extra ? { extraText: extra } : {}) }),
      }, created.editRef);
      await waitDone(created.boardId);
      out({ boardId: created.boardId, viewUrl: created.viewUrl, editUrl: created.editUrl });
      return;
    }
    case 'revise': {
      const [boardId, instruction] = positional;
      if (!boardId || !instruction) die('用法: hangtola revise <boardId> "<指令>"');
      const result = await (await api(`/api/boards/${boardId}/chat`, {
        method: 'POST', body: JSON.stringify({ message: instruction }),
      }, refOf(boardId!))).json();
      out(result);
      return;
    }
    case 'get': {
      const boardId = positional[0] ?? die('用法: hangtola get <boardId> [--full]');
      if (flags.has('full')) {
        const res = await api(`/api/boards/${boardId}/full`, {}, refOf(boardId));
        if (res.status === 403) die('editRef 无效');
        out(await res.json());
      } else {
        out(await (await api(`/api/boards/${boardId}`)).json());
      }
      return;
    }
    case 'apply': {
      const [boardId, patchFile] = positional;
      if (!boardId || !patchFile) die('用法: hangtola apply <boardId> <patch.json>');
      const res = await api(`/api/boards/${boardId}/patch`, {
        method: 'POST', body: readFileSync(patchFile!, 'utf8'),
      }, refOf(boardId!));
      const body = await res.json();
      if (res.status === 409) { console.error('✗ 版本冲突：以下为最新文档'); out(body); process.exit(2); }
      if (!res.ok) die(JSON.stringify(body));
      out(body);
      return;
    }
    case 'revert': {
      const [boardId, revisionId] = positional;
      if (!boardId || !revisionId) die('用法: hangtola revert <boardId> <revisionId>');
      out(await (await api(`/api/boards/${boardId}/revert`, {
        method: 'POST', body: JSON.stringify({ revisionId }),
      }, refOf(boardId!))).json());
      return;
    }
    case 'render': {
      const input = positional[0] ?? die('用法: hangtola render <board.json> -o out.html');
      const output = flag('o') ?? flag('output') ?? 'hangtola.html';
      if (!existsSync(RENDERER)) die('本地渲染器缺失（需在仓库内运行）');
      const result = spawnSync('node', [RENDERER, input!, output], { stdio: 'inherit' });
      process.exit(result.status ?? 1);
      return;
    }
    case 'export': {
      const boardId = positional[0] ?? die('用法: hangtola export <boardId> -o out.html|out.json');
      const output = flag('o') ?? `${boardId}.html`;
      const format = output.endsWith('.json') ? 'json' : 'html';
      const res = await api(`/api/boards/${boardId}/export?format=${format}`, {}, refOf(boardId));
      if (!res.ok) die(`导出失败: ${res.status}`);
      writeFileSync(output, Buffer.from(await res.arrayBuffer()));
      out(`已导出 ${output}`);
      return;
    }
    default:
      out([
        'hangtola — 夯到拉命令行',
        '',
        '  generate "<主题>" [--extra "条目、条目"] [--image a.png]...   创建并 AI 生成（保序上传）',
        '  revise <boardId> "<自然语言指令>"                             AI 修改',
        '  get <boardId> [--full]                                        读公开投影 / 完整文档',
        '  apply <boardId> <patch.json>                                  确定性结构化修改（409 打印最新文档）',
        '  revert <boardId> <revisionId>                                 回滚（写新版本）',
        '  render <board.json> -o out.html                               本地离线渲染（不联网不经模型）',
        '  export <boardId> -o out.html|out.json                         导出离线单文件 / 完整 JSON',
        '',
        '  通用: --base <url>（默认 https://hangtola.app）  --edit-ref <key>',
      ].join('\n'));
  }
}

main().catch((error) => die(error instanceof Error ? error.message : String(error)));
