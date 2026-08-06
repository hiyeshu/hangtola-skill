/**
 * [INPUT]: 依赖 agents 的 getAgentByName、@hangtola/domain 的 newBoardId 与 Env 绑定
 * [OUTPUT]: 对外提供 handleMcp：MCP streamable-HTTP（JSON-RPC）无状态处理器，八个工具全部薄封装 DO RPC（含 ingest_image_url 网图转资产）
 * [POS]: workers/hangtola 的外部 Agent 接口；自身零会话零状态，凭 boardId/editRef 路由到目标 DO
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { getAgentByName } from 'agents';
import { newBoardId } from '@hangtola/domain';
import type { Env } from '../env.js';
import { ingestImageFromUrl } from '../http/ingest.js';

interface JsonRpcRequest { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, unknown> }

const TOOLS = [
  {
    name: 'generate_board',
    description: '按主题（可带补充条目文字）创建夯到拉榜单并启动 AI 生成。返回 boardId、editRef（编辑密钥，务必保存）、viewUrl/editUrl；生成异步进行，用 get_board 轮询 generation.status。',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' }, extraText: { type: 'string' } }, required: ['topic'] },
  },
  {
    name: 'revise_board',
    description: '用自然语言修改已有榜单（如"把 A 移到 NPC、标题改成 X"）。合法则产生新版本并返回 revisionId 与变化摘要；无法编译为合法修改时零改动。',
    inputSchema: { type: 'object', properties: { boardId: { type: 'string' }, editRef: { type: 'string' }, instruction: { type: 'string' } }, required: ['boardId', 'editRef', 'instruction'] },
  },
  {
    name: 'get_board',
    description: '读取榜单。无 editRef 返回公开投影（名称/图/档位）；携带 editRef 返回完整文档（含内部依据与维度）与 head 版本号。',
    inputSchema: { type: 'object', properties: { boardId: { type: 'string' }, editRef: { type: 'string' } }, required: ['boardId'] },
  },
  {
    name: 'apply_board_patch',
    description: '提交结构化 BoardPatchV1（确定性修改，不经模型）。baseRevision 过期返回 conflict 与最新文档。',
    inputSchema: { type: 'object', properties: { boardId: { type: 'string' }, editRef: { type: 'string' }, patch: { type: 'object' } }, required: ['boardId', 'editRef', 'patch'] },
  },
  {
    name: 'revert_board',
    description: '回滚到指定 revision。撤销以新版本形式写入，历史不被改写。',
    inputSchema: { type: 'object', properties: { boardId: { type: 'string' }, editRef: { type: 'string' }, revisionId: { type: 'string' } }, required: ['boardId', 'editRef', 'revisionId'] },
  },
  {
    name: 'prepare_asset_upload',
    description: '为远程客户端准备图片上传：返回每张图的一次性 uploadUrl（PUT 原始字节）。上传顺序即榜单输入顺序。',
    inputSchema: { type: 'object', properties: { boardId: { type: 'string' }, editRef: { type: 'string' }, files: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, mime: { type: 'string' } }, required: ['name', 'mime'] } } }, required: ['boardId', 'editRef', 'files'] },
  },
  {
    name: 'ingest_image_url',
    description: '把网图 URL 转为榜单资产（服务器抓取校验：https、image/*、≤6MB）。返回 assetId；随后用 apply_board_patch 把 {"kind":"asset","assetId":...} 写进条目 image（addItem 或 updateItem）。禁止把外链 URL 直接写入文档。',
    inputSchema: { type: 'object', properties: { boardId: { type: 'string' }, editRef: { type: 'string' }, url: { type: 'string' }, name: { type: 'string' } }, required: ['boardId', 'editRef', 'url'] },
  },
  {
    name: 'export_board',
    description: '导出榜单：format=json 返回完整文档；format=html 返回可下载的离线单文件地址（携 editRef 请求 /api/boards/:id/export）。',
    inputSchema: { type: 'object', properties: { boardId: { type: 'string' }, editRef: { type: 'string' }, format: { type: 'string', enum: ['json', 'html'] } }, required: ['boardId', 'editRef'] },
  },
];

async function callTool(env: Env, origin: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const agentFor = (boardId: string) => getAgentByName(env.HANGTOLA_AGENT, boardId);
  const str = (key: string) => String(args[key] ?? '');

  switch (name) {
    case 'generate_board': {
      const boardId = newBoardId();
      const agent = await agentFor(boardId);
      const created = await agent.ensureBoard(boardId);
      if (!created.created || !created.editKey) throw new Error('init-failed');
      const fired = await agent.generateRpc(created.editKey, {
        topic: str('topic'),
        ...(args.extraText ? { extraText: str('extraText') } : {}),
      });
      return {
        boardId,
        editRef: created.editKey,
        viewUrl: `${origin}/b/${boardId}`,
        editUrl: `${origin}/b/${boardId}#k=${created.editKey}`,
        generation: fired,
      };
    }
    case 'revise_board': {
      const agent = await agentFor(str('boardId'));
      const result = await agent.chatRpc(str('editRef'), str('instruction'));
      if (!result.ok) throw new Error('forbidden');
      return result;
    }
    case 'get_board': {
      const agent = await agentFor(str('boardId'));
      if (args.editRef) {
        const full = await agent.getFullSnapshot(str('editRef'));
        if (!full.ok) throw new Error('forbidden');
        const pub = await agent.getPublicSnapshot();
        return { ...full, generation: pub.state.generation };
      }
      const snapshot = await agent.getPublicSnapshot();
      if (!snapshot.exists) throw new Error('not-found');
      return snapshot.state;
    }
    case 'apply_board_patch': {
      const agent = await agentFor(str('boardId'));
      return agent.commitPatchRpc(str('editRef'), args.patch);
    }
    case 'revert_board': {
      const agent = await agentFor(str('boardId'));
      return agent.revertRpc(str('editRef'), str('revisionId'));
    }
    case 'prepare_asset_upload': {
      const agent = await agentFor(str('boardId'));
      const result = await agent.prepareAssets(str('editRef'), (args.files as { name: string; mime: string }[]) ?? []);
      if (!result.ok) throw new Error('forbidden');
      return {
        assets: result.assets.map((a) => ({
          assetId: a.assetId,
          uploadUrl: `${origin}/api/uploads/${str('boardId')}/${a.assetId}?token=${a.token}`,
        })),
      };
    }
    case 'ingest_image_url': {
      const agent = await agentFor(str('boardId'));
      const result = await ingestImageFromUrl(env, agent, str('editRef'), str('url'), args.name ? str('name') : undefined);
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case 'export_board': {
      const agent = await agentFor(str('boardId'));
      const full = await agent.getFullSnapshot(str('editRef'));
      if (!full.ok) throw new Error('forbidden');
      if ((args.format ?? 'json') === 'json') return full.doc;
      return {
        downloadUrl: `${origin}/api/boards/${str('boardId')}/export?format=html`,
        note: '请求时携带 X-Edit-Ref 头',
      };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

/** MCP streamable-HTTP：单 POST 端点，无状态 JSON-RPC */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }
  let rpc: JsonRpcRequest;
  try {
    rpc = await request.json() as JsonRpcRequest;
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: rpc.id ?? null, result });
  const fail = (code: number, message: string) =>
    Response.json({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code, message } });

  switch (rpc.method) {
    case 'initialize':
      return reply({
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'hangtola', version: '1.0.0' },
      });
    case 'notifications/initialized':
      return new Response(null, { status: 202 });
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const params = rpc.params ?? {};
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(env, new URL(request.url).origin, name, args);
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (error) {
        return reply({ content: [{ type: 'text', text: `错误：${String(error instanceof Error ? error.message : error)}` }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${rpc.method}`);
  }
}
