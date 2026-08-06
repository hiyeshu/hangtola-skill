/**
 * [INPUT]: 依赖 Env 的 R2 绑定、HangtolaAgent 的资产三步 RPC（prepare/verify/mark）与 ../limits 的共享闸值
 * [OUTPUT]: 对外提供 ingestImageFromUrl：外链图片入境——服务器抓取、校验（https 单轨/非私网/image/声明与实测双闸 ≤MAX_ASSET_BYTES/超时止损）、转 R2 资产
 * [POS]: 「URL 是来源不是存储」宪法的执行器；HTTP 路由与 MCP 工具共用，文档与导出因此永远无外链。
 *        本函数是唯一「服务器替调用方发请求」的出口，故 SSRF 与体积的责任只在此处收口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { Env } from '../env.js';
import type { HangtolaAgent } from '../agent/hangtola-agent.js';
import { MAX_ASSET_BYTES, INGEST_TIMEOUT_MS } from '../limits.js';

export type IngestResult =
  | { ok: true; assetId: string; mime: string; bytes: number }
  | { ok: false; error: 'bad-url' | 'fetch-failed' | 'not-image' | 'too-large' | 'forbidden' | 'ingest-failed' };

/* 私网与回环字面量：外链抓取是「让服务器替你发请求」，不设限即成 SSRF 跳板。
   域名解析后的私网地址挡不住（Workers 拿不到解析结果），此处只封字面量——
   够挡掉顺手的探测，不自称完备。 */
const PRIVATE_HOST = /^(localhost|\[?::1\]?|0\.0\.0\.0|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export async function ingestImageFromUrl(
  env: Env,
  agent: DurableObjectStub<HangtolaAgent>,
  editRef: string,
  url: string,
  name?: string,
): Promise<IngestResult> {
  let target: URL;
  try { target = new URL(url); } catch { return { ok: false, error: 'bad-url' }; }
  /* https 单轨：明文抓取既暴露抓取行为也允许中间人换图，图片入境没有理由降级 */
  if (target.protocol !== 'https:') return { ok: false, error: 'bad-url' };
  if (PRIVATE_HOST.test(target.hostname)) return { ok: false, error: 'bad-url' };

  const response = await fetch(target, {
    signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    headers: { 'User-Agent': 'hangtola-ingest/1 (+https://hangtola.app)' },
  }).catch(() => null);
  if (!response || !response.ok) return { ok: false, error: 'fetch-failed' };

  const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!mime.startsWith('image/')) return { ok: false, error: 'not-image' };
  /* 声明值先挡：远端完全不可信，等 arrayBuffer() 读完再判断时内存已经被它决定了 */
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_ASSET_BYTES) return { ok: false, error: 'too-large' };
  const body = await response.arrayBuffer();
  if (body.byteLength === 0) return { ok: false, error: 'fetch-failed' };
  if (body.byteLength > MAX_ASSET_BYTES) return { ok: false, error: 'too-large' };

  const fileName = name?.trim()
    || decodeURIComponent(target.pathname.split('/').pop() || '') || '网图';
  const prep = await agent.prepareAssets(editRef, [{ name: fileName, mime }]);
  if (!prep.ok) return { ok: false, error: 'forbidden' };
  const asset = prep.assets[0]!;
  const verified = await agent.verifyAssetUpload(asset.assetId, asset.token);
  if (!verified.ok) return { ok: false, error: 'ingest-failed' };
  await env.ASSETS.put(verified.r2Key, body, { httpMetadata: { contentType: verified.mime } });
  await agent.markAssetUploaded(asset.assetId);
  return { ok: true, assetId: asset.assetId, mime, bytes: body.byteLength };
}
