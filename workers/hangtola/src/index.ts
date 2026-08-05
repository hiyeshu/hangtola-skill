/**
 * [INPUT]: 依赖 hono 路由、agents SDK 的 getAgentByName/routeAgentRequest 与 ./agent/hangtola-agent 的 RPC 面
 * [OUTPUT]: 对外提供 HTTP API（/api/boards*）、Agent ws 路由与健康检查；编辑鉴权走 X-Edit-Ref 头
 * [POS]: workers/hangtola 的唯一入口：路由零业务逻辑，全部薄封装到 DO 方法（P5 的 MCP 复用同一面）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { Hono } from 'hono';
import { getAgentByName, routeAgentRequest } from 'agents';
import { newBoardId } from '@hangtola/domain';
import type { Env } from './env.js';
import { HangtolaAgent } from './agent/hangtola-agent.js';
import { GenerateBoardWorkflow } from './workflows/generate-board.js';

export { HangtolaAgent, GenerateBoardWorkflow };

const app = new Hono<{ Bindings: Env }>();

const editRef = (c: { req: { header: (name: string) => string | undefined } }): string =>
  c.req.header('X-Edit-Ref') ?? '';

const agentOf = (env: Env, boardId: string) => getAgentByName(env.HANGTOLA_AGENT, boardId);

/* ---- 建榜：返回 editRef（仅此一次）与两类链接 ---- */
app.post('/api/boards', async (c) => {
  const boardId = newBoardId();
  const agent = await agentOf(c.env, boardId);
  const result = await agent.ensureBoard(boardId);
  if (!result.created || !result.editKey) return c.json({ error: 'init-failed' }, 500);
  const origin = new URL(c.req.url).origin;
  return c.json({
    boardId,
    editRef: result.editKey,
    viewUrl: `${origin}/b/${boardId}`,
    editUrl: `${origin}/b/${boardId}#k=${result.editKey}`,
  }, 201);
});

/* ---- 公开投影 ---- */
app.get('/api/boards/:id', async (c) => {
  const agent = await agentOf(c.env, c.req.param('id'));
  const snapshot = await agent.getPublicSnapshot();
  if (!snapshot.exists) return c.json({ error: 'not-found' }, 404);
  return c.json(snapshot.state);
});

/* ---- 完整文档（编辑者） ---- */
app.get('/api/boards/:id/full', async (c) => {
  const agent = await agentOf(c.env, c.req.param('id'));
  const result = await agent.getFullSnapshot(editRef(c));
  if (!result.ok) return c.json({ error: 'forbidden' }, 403);
  return c.json(result);
});

/* ---- 结构化修改：冲突 409 + 最新文档 ---- */
app.post('/api/boards/:id/patch', async (c) => {
  const agent = await agentOf(c.env, c.req.param('id'));
  const outcome = await agent.commitPatchRpc(editRef(c), await c.req.json());
  if (outcome.ok) return c.json(outcome);
  if (outcome.error === 'forbidden') return c.json(outcome, 403);
  if (outcome.error === 'conflict') return c.json(outcome, 409);
  return c.json(outcome, 422);
});

/* ---- 回滚：撤销也是新版本 ---- */
app.post('/api/boards/:id/revert', async (c) => {
  const agent = await agentOf(c.env, c.req.param('id'));
  const { revisionId } = await c.req.json<{ revisionId: string }>();
  const outcome = await agent.revertRpc(editRef(c), revisionId);
  if (outcome.ok) return c.json(outcome);
  if (outcome.error === 'forbidden') return c.json(outcome, 403);
  return c.json(outcome, 422);
});

app.get('/api/boards/:id/revisions', async (c) => {
  const agent = await agentOf(c.env, c.req.param('id'));
  const result = await agent.listRevisionsRpc(editRef(c));
  if (!result.ok) return c.json({ error: 'forbidden' }, 403);
  return c.json(result);
});

/* ---- 自然语言修改 ---- */
app.post('/api/boards/:id/chat', async (c) => {
  const agent = await agentOf(c.env, c.req.param('id'));
  const { message } = await c.req.json<{ message: string }>();
  const result = await agent.chatRpc(editRef(c), message);
  if (!result.ok) return c.json({ error: 'forbidden' }, 403);
  return c.json(result);
});

/* ---- 主题生成（P2 文字管线；P3 换可恢复 Workflow） ---- */
app.post('/api/boards/:id/generate', async (c) => {
  const agent = await agentOf(c.env, c.req.param('id'));
  const input = await c.req.json<{ topic: string; extraText?: string }>();
  const result = await agent.generateRpc(editRef(c), input);
  if (!result.ok) return c.json(result, result.error === 'forbidden' ? 403 : 500);
  return c.json(result);
});

/* ---- 资产：DO 发一次性令牌 → Worker 中转写 R2 → 公开读透 ---- */
app.post('/api/boards/:id/assets/prepare', async (c) => {
  const boardId = c.req.param('id');
  const agent = await agentOf(c.env, boardId);
  const { files } = await c.req.json<{ files: { name: string; mime: string }[] }>();
  const result = await agent.prepareAssets(editRef(c), files ?? []);
  if (!result.ok) return c.json({ error: 'forbidden' }, 403);
  return c.json({
    assets: result.assets.map((a) => ({
      assetId: a.assetId,
      uploadUrl: `/api/uploads/${boardId}/${a.assetId}?token=${a.token}`,
    })),
  });
});

app.put('/api/uploads/:boardId/:assetId', async (c) => {
  const agent = await agentOf(c.env, c.req.param('boardId'));
  const verified = await agent.verifyAssetUpload(c.req.param('assetId'), c.req.query('token') ?? '');
  if (!verified.ok) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'empty-body' }, 400);
  await c.env.ASSETS.put(verified.r2Key, body, { httpMetadata: { contentType: verified.mime } });
  await agent.markAssetUploaded(c.req.param('assetId'));
  return c.json({ ok: true }, 201);
});

app.get('/assets/:boardId/:assetId', async (c) => {
  const key = `boards/${c.req.param('boardId')}/assets/${c.req.param('assetId')}`;
  const object = await c.env.ASSETS.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

app.get('/healthz', (c) => c.json({ ok: true }));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const routed = await routeAgentRequest(request, env);
    if (routed) return routed;
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
