/**
 * [INPUT]: 依赖 ./schema 的 V2 契约、./rank 的常量与归一化原语、./ids 的条目标识工厂
 * [OUTPUT]: 对外提供 migrateLegacyToV2 / toLegacyBoard / toPublicView 三座桥与 LegacyBoard 类型、MigrationError
 * [POS]: domain 的版本边界：旧 JSON（网页导出/Skill 契约）与 V2 云文档、公开投影之间的唯一转换层
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import {
  BoardDocumentV2,
  type BoardDocumentV2T,
  type ItemV2T,
} from './schema.js';
import { TIER_DEFS, cleanText, clampWeight, isControlledColor } from './rank.js';

/* ============================================================
   Legacy（v1）形状：与 render-board.js / template.html 契约同构
   ============================================================ */
export interface LegacyItem {
  text: string;
  image: string | null;          // data: URL（云侧）或本地路径（仅 Skill 渲染场景）
  note: string;
  color: string | null;
}
export interface LegacyTier {
  key: string;
  label: string;
  color: string;
  items: LegacyItem[];
}
export interface LegacyBoard {
  id: string;
  title: string;
  footnote: string;
  savedAt: string;               // ISO 字符串
  dimensions: { name: string; weight: number }[];
  tiers: LegacyTier[];
  pool: LegacyItem[];
}

export class MigrationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'MigrationError';
  }
}

interface MigrateOptions {
  newItemId: () => string;
  now?: () => number;
}

function migrateItem(raw: unknown, path: string, opts: MigrateOptions): ItemV2T {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = cleanText(source.text);
  const imageRaw = cleanText(source.image);
  let image: ItemV2T['image'] = null;
  if (imageRaw) {
    if (!imageRaw.startsWith('data:image/')) {
      throw new MigrationError(path, '云端文档要求图片已内嵌为 data:image/*，本地路径请先经渲染/上传管线');
    }
    image = { kind: 'dataurl', dataUrl: imageRaw };
  }
  if (!text && !image) throw new MigrationError(path, '至少要有 text 或 image');
  const colorRaw = cleanText(source.color).toLowerCase();
  return {
    id: opts.newItemId(),
    text,
    image,
    note: cleanText(source.note),
    color: !image && isControlledColor(colorRaw) ? (colorRaw as ItemV2T['color']) : null,
    evidence: [],
  };
}

/** 旧 JSON（宽松）→ V2（严格）；分配稳定条目 id，保持档内与 pool 顺序 */
export function migrateLegacyToV2(legacy: unknown, opts: MigrateOptions): BoardDocumentV2T {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    throw new MigrationError('$', '榜单 JSON 顶层必须是对象');
  }
  const source = legacy as Record<string, unknown>;
  const provided = new Map(
    (Array.isArray(source.tiers) ? source.tiers : [])
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t) => [t.key, t]),
  );
  const now = opts.now ?? Date.now;
  const savedAtRaw = Date.parse(cleanText(source.savedAt));
  const doc: BoardDocumentV2T = {
    schemaVersion: 2,
    id: cleanText(source.id) || `hangtola-${now()}`,
    title: cleanText(source.title),
    footnote: cleanText(source.footnote),
    savedAt: Number.isFinite(savedAtRaw) ? savedAtRaw : now(),
    dimensions: (Array.isArray(source.dimensions) ? source.dimensions : [])
      .map((d) => ({
        name: cleanText((d as Record<string, unknown>)?.name),
        weight: clampWeight((d as Record<string, unknown>)?.weight),
      }))
      .filter((d) => d.name),
    tiers: TIER_DEFS.map((def) => {
      const tier = provided.get(def.key) ?? {};
      const items = Array.isArray((tier as Record<string, unknown>).items)
        ? ((tier as Record<string, unknown>).items as unknown[])
        : [];
      return {
        key: def.key,
        label: cleanText((tier as Record<string, unknown>).label) || def.label,
        color: def.color,
        items: items.map((item, index) => migrateItem(item, `tiers.${def.key}.items[${index}]`, opts)),
      };
    }),
    pool: (Array.isArray(source.pool) ? source.pool : [])
      .map((item, index) => migrateItem(item, `pool[${index}]`, opts)),
  };
  return BoardDocumentV2.parse(doc);
}

/* ============================================================
   V2 → Legacy：喂给 template.html / render-board.js 的唯一出口
   ============================================================ */
export async function toLegacyBoard(
  doc: BoardDocumentV2T,
  resolveAsset: (assetId: string) => Promise<string>,
): Promise<LegacyBoard> {
  const toLegacyItem = async (item: ItemV2T): Promise<LegacyItem> => ({
    text: item.text,
    image: item.image === null
      ? null
      : item.image.kind === 'dataurl'
        ? item.image.dataUrl
        : await resolveAsset(item.image.assetId),
    note: item.note,
    color: item.color,
  });
  return {
    id: doc.id,
    title: doc.title,
    footnote: doc.footnote,
    savedAt: new Date(doc.savedAt).toISOString(),
    dimensions: doc.dimensions.map((d) => ({ ...d })),
    tiers: await Promise.all(doc.tiers.map(async (tier) => ({
      key: tier.key,
      label: tier.label,
      color: tier.color,
      items: await Promise.all(tier.items.map(toLegacyItem)),
    }))),
    pool: await Promise.all(doc.pool.map(toLegacyItem)),
  };
}

/* ============================================================
   草稿 → V2：生成管线出口（图片经 assetId 关联，不走 legacy 桥）
   ============================================================ */
import { TIER_KEYS, isControlledColor as isCtrl, type DraftShape } from './rank.js';

export function draftToV2(
  draft: DraftShape,
  imageByText: Record<string, string>,      // 条目名 → assetId
  opts: { boardId: string; newItemId: () => string; now?: () => number },
): BoardDocumentV2T {
  const now = opts.now ?? Date.now;
  const toItem = (item: { text: string; note: string; color: string | null }): ItemV2T => {
    const assetId = imageByText[item.text];
    const image = assetId ? ({ kind: 'asset', assetId } as const) : null;
    const colorRaw = (item.color ?? '').toLowerCase();
    return {
      id: opts.newItemId(),
      text: item.text,
      image,
      note: item.note,
      color: !image && isCtrl(colorRaw) ? (colorRaw as ItemV2T['color']) : null,
      evidence: [],
    };
  };
  const byKey = new Map(draft.tiers.map((t) => [t.key, t.items]));
  return BoardDocumentV2.parse({
    schemaVersion: 2,
    id: opts.boardId,
    title: cleanText(draft.title),
    footnote: '',
    savedAt: now(),
    dimensions: draft.dimensions
      .map((d) => ({ name: cleanText(d.name), weight: clampWeight(d.weight) }))
      .filter((d) => d.name),
    tiers: TIER_DEFS.map((def, i) => ({
      key: def.key,
      label: def.label,
      color: def.color,
      items: (byKey.get(TIER_KEYS[i]!) ?? []).map(toItem),
    })),
    pool: draft.pool.map(toItem),
  });
}

/* ============================================================
   V2 → 公开投影：viewUrl 能看到的一切，仅此而已
   ============================================================ */
export interface PublicItem { id: string; text: string; image: string | null; color: string | null }
export interface PublicTier { key: string; label: string; color: string; items: PublicItem[] }
export interface PublicBoardView {
  id: string;
  title: string;
  footnote: string;
  tiers: PublicTier[];
  pool: PublicItem[];
}

export function toPublicView(
  doc: BoardDocumentV2T,
  assetUrl: (assetId: string) => string,
): PublicBoardView {
  const project = (item: ItemV2T): PublicItem => ({
    id: item.id,
    text: item.text,
    image: item.image === null
      ? null
      : item.image.kind === 'dataurl'
        ? item.image.dataUrl
        : assetUrl(item.image.assetId),
    color: item.color,               // 渲染可见属性，非隐私；隐私边界是 note/evidence/dimensions
  });
  return {
    id: doc.id,
    title: doc.title,
    footnote: doc.footnote,
    tiers: doc.tiers.map((tier) => ({
      key: tier.key, label: tier.label, color: tier.color, items: tier.items.map(project),
    })),
    pool: doc.pool.map(project),
  };
}
