/**
 * [INPUT]: 依赖浏览器 createImageBitmap 与 canvas 编码；无项目内依赖
 * [OUTPUT]: 对外提供 globalThis.hangtolaShrinkImage(file) → File：长边压至 1280，实测 alpha 决定 PNG/JPEG
 * [POS]: apps/web/hosted 的上传前置闸——识图 token 与 Worker isolate 内存的源头治理，home.js 与 cloud-adapter.js 共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/* 1280 长边：卡片显示与导出放大都够用，而识图 prompt_tokens 从 2609 降到 ~400。
   压不动就原样返回——宁可慢，不可坏图。 */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.85;
const SMALL_ENOUGH = 512 * 1024;

/** 逐像素验 alpha：截图存 PNG 极常见，全不透明就该走 JPEG 省一个数量级 */
function hasAlpha(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

globalThis.hangtolaShrinkImage = async function hangtolaShrinkImage(source) {
  const type = source?.type ?? '';
  /* 动图与矢量重编码即损坏语义，直接放行 */
  if (!type.startsWith('image/') || /^image\/(gif|svg\+xml)$/.test(type)) return source;

  let bitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    return source;                                   // 解不开就别碰
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && source.size <= SMALL_ENOUGH) {
    bitmap.close?.();
    return source;                                   // 已经够小，重编码只会掉质量
  }

  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const keepAlpha = hasAlpha(ctx, w, h);
  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, keepAlpha ? 'image/png' : 'image/jpeg', JPEG_QUALITY);
  });
  if (!blob || blob.size >= source.size) return source;   // 压完更大就认输

  const stem = (source.name ?? '图片').replace(/\.[^.]+$/, '');
  return new File([blob], `${stem}${keepAlpha ? '.png' : '.jpg'}`, { type: blob.type });
};
