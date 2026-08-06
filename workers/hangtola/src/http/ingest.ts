/**
 * [INPUT]: 依赖 Env 的 R2 绑定与 HangtolaAgent 的资产三步 RPC（prepare/verify/mark）
 * [OUTPUT]: 对外提供 ingestImageFromUrl：外链图片入境——服务器抓取、校验（https/image/≤6MB/15s 止损）、转 R2 资产
 * [POS]: 「URL 是来源不是存储」宪法的执行器；HTTP 路由与 MCP 工具共用，文档与导出因此永远无外链
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { Env } from '../env.js';
import type { HangtolaAgent } from '../agent/hangtola-agent.js';

/* 与批量识图的体积闸一致：128MB isolate ÷ 并发 ÷ base64 膨胀的推论值 */
const MAX_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export type IngestResult =
  | { ok: true; assetId: string; mime: string; bytes: number }
  | { ok: false; error: 'bad-url' | 'fetch-failed' | 'not-image' | 'too-large' | 'forbidden' | 'ingest-failed' };

export async function ingestImageFromUrl(
  env: Env,
  agent: DurableObjectStub<HangtolaAgent>,
  editRef: string,
  url: string,
  name?: string,
): Promise<IngestResult> {
  let target: URL;
  try { target = new URL(url); } catch { return { ok: false, error: 'bad-url' }; }
  if (!/^https?:$/.test(target.protocol)) return { ok: false, error: 'bad-url' };

  const response = await fetch(target, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'hangtola-ingest/1 (+https://hangtola.app)' },
  }).catch(() => null);
  if (!response || !response.ok) return { ok: false, error: 'fetch-failed' };

  const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!mime.startsWith('image/')) return { ok: false, error: 'not-image' };
  const body = await response.arrayBuffer();
  if (body.byteLength === 0) return { ok: false, error: 'fetch-failed' };
  if (body.byteLength > MAX_BYTES) return { ok: false, error: 'too-large' };

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
