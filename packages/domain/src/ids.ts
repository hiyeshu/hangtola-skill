/**
 * [INPUT]: 依赖运行时全局 crypto（Node 18+ / Workers / 浏览器同源）
 * [OUTPUT]: 对外提供 newItemId / newAssetId / newRevisionId / newBoardId / newEditKey / hashEditKey 稳定标识工厂
 * [POS]: domain 的标识层，revision id 前缀按时间 base36 可排序，editKey 只以 SHA-256 哈希落盘
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBase36(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += BASE36[b % 36];
  return out;
}

export const newItemId = (): string => `itm_${randomBase36(16)}`;
export const newAssetId = (): string => `ast_${randomBase36(16)}`;
export const newBoardId = (): string => `brd_${randomBase36(12)}`;

/** 前 9 位为毫秒时间戳 base36（可排序），后 11 位随机 */
export const newRevisionId = (now: number = Date.now()): string =>
  `rev_${now.toString(36).padStart(9, '0')}${randomBase36(11)}`;

/** 128-bit 编辑能力密钥，base64url；只应展示一次 */
export function newEditKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** 服务端仅存哈希；恒定内容→恒定 hex64 */
export async function hashEditKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
