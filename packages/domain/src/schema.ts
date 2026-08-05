/**
 * [INPUT]: 依赖 zod 与 ./rank 的五档常量、受控调色板
 * [OUTPUT]: 对外提供 BoardDocumentV2 / BoardPatchV1 / Revision / Evidence / VisionObservation / EditCapability 的 Zod schema 与 TS 类型
 * [POS]: domain 的类型宪法，四端（Skill/网页/CLI/MCP）共用的结构化契约；云端文档禁 dataurl 由服务端写入路径另行强制
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { z } from 'zod';
import { TIER_KEYS, TEXT_COLORS } from './rank.js';

export const TierKeySchema = z.enum(TIER_KEYS);
export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/);
export const ControlledColor = z.enum(TEXT_COLORS);

export const ItemIdSchema = z.string().regex(/^itm_[0-9a-z]{16}$/);
export const AssetIdSchema = z.string().regex(/^ast_[0-9a-z]{16}$/);
export const RevisionIdSchema = z.string().regex(/^rev_[0-9a-z]{20}$/);

/* ============================================================
   证据与识图（内部字段，永不进入公开投影）
   ============================================================ */
export const EvidenceSource = z.object({
  url: z.string().url(),
  title: z.string(),
  snippet: z.string().default(''),
  publishedAt: z.string().optional(),
});
export const Evidence = z.object({
  claim: z.string(),
  sources: z.array(EvidenceSource),
  status: z.enum(['supported', 'insufficient']),
  confidence: z.number().min(0).max(1),
});

export const VisionObservation = z.object({
  assetIndex: z.number().int().nonnegative(),
  candidates: z.array(z.object({ name: z.string(), confidence: z.number().min(0).max(1) })),
  description: z.string(),
  ocr: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string()),
});

/* ============================================================
   文档 V2
   ============================================================ */
export const ItemImage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asset'), assetId: AssetIdSchema }),
  z.object({ kind: z.literal('dataurl'), dataUrl: z.string().startsWith('data:image/') }),
]);

export const ItemV2 = z.object({
  id: ItemIdSchema,
  text: z.string(),
  image: ItemImage.nullable(),
  note: z.string().default(''),
  color: ControlledColor.nullable().default(null),
  evidence: z.array(Evidence).default([]),
}).refine((it) => it.text !== '' || it.image !== null, { message: 'item 至少要有 text 或 image' })
  .refine((it) => it.image === null || it.color === null, { message: '图片卡 color 必须为 null' });

export const Dimension = z.object({ name: z.string().min(1), weight: z.number().min(1).max(5) });

export const TierV2 = z.object({
  key: TierKeySchema,
  label: z.string().min(1),
  color: HexColor,
  items: z.array(ItemV2),
});

export const BoardDocumentV2 = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  title: z.string().default(''),
  footnote: z.string().default(''),
  savedAt: z.number().int(),                       // epoch ms（legacy 为 ISO 字符串，迁移层转换）
  dimensions: z.array(Dimension),
  tiers: z.array(TierV2).length(5)
    .refine((ts) => ts.every((t, i) => t.key === TIER_KEYS[i]), { message: '五档顺序与 key 固定' }),
  pool: z.array(ItemV2),
});

/* ============================================================
   Patch V1：唯一修改语言
   ============================================================ */
export const PatchTarget = z.object({
  tier: z.union([TierKeySchema, z.literal('pool')]),
  index: z.number().int().nonnegative().optional(),
});

export const PatchOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('addItem'),
    item: z.object({
      id: ItemIdSchema.optional(),
      text: z.string(),
      image: ItemImage.nullable().default(null),
      note: z.string().default(''),
      color: ControlledColor.nullable().default(null),
      evidence: z.array(Evidence).default([]),
    }),
    target: PatchTarget,
  }),
  z.object({
    op: z.literal('updateItem'),
    itemId: ItemIdSchema,
    set: z.object({
      text: z.string().optional(),
      note: z.string().optional(),
      color: ControlledColor.nullable().optional(),
      image: ItemImage.nullable().optional(),
      evidence: z.array(Evidence).optional(),
    }),
  }),
  z.object({ op: z.literal('moveItem'), itemId: ItemIdSchema, to: PatchTarget.required({ index: true }) }),
  z.object({ op: z.literal('removeItem'), itemId: ItemIdSchema }),
  z.object({ op: z.literal('setDimensions'), dimensions: z.array(Dimension) }),
  z.object({
    op: z.literal('setMeta'),
    title: z.string().optional(),
    footnote: z.string().optional(),
    tierLabels: z.object({
      hang: z.string().min(1).optional(),
      top: z.string().min(1).optional(),
      upper: z.string().min(1).optional(),
      npc: z.string().min(1).optional(),
      la: z.string().min(1).optional(),
    }).optional(),
  }),
]);

export const PatchAuthor = z.object({ kind: z.enum(['agent', 'web', 'cli', 'mcp']) });

export const BoardPatchV1 = z.object({
  schemaVersion: z.literal('patch.v1'),
  boardId: z.string().min(1),
  baseRevision: RevisionIdSchema,
  ops: z.array(PatchOp).min(1),
  summary: z.string(),
  author: PatchAuthor,
});

/* ============================================================
   版本与能力
   ============================================================ */
export const Revision = z.object({
  id: RevisionIdSchema,
  boardId: z.string(),
  parentId: RevisionIdSchema.nullable(),
  kind: z.enum(['genesis', 'generate', 'patch', 'revert', 'import']),
  patch: BoardPatchV1.nullable(),
  revertOf: RevisionIdSchema.optional(),
  doc: BoardDocumentV2,
  summary: z.string(),
  author: PatchAuthor,
  createdAt: z.number().int(),
});

export const EditCapability = z.object({
  boardId: z.string(),
  keyHash: z.string().length(64),
  createdAt: z.number().int(),
  lastUsedAt: z.number().int().nullable(),
});

export type TierKeyT = z.infer<typeof TierKeySchema>;
export type ItemImageT = z.infer<typeof ItemImage>;
export type ItemV2T = z.infer<typeof ItemV2>;
export type DimensionT = z.infer<typeof Dimension>;
export type TierV2T = z.infer<typeof TierV2>;
export type BoardDocumentV2T = z.infer<typeof BoardDocumentV2>;
export type PatchOpT = z.infer<typeof PatchOp>;
export type BoardPatchV1T = z.infer<typeof BoardPatchV1>;
export type RevisionT = z.infer<typeof Revision>;
export type EvidenceT = z.infer<typeof Evidence>;
export type VisionObservationT = z.infer<typeof VisionObservation>;
export type EditCapabilityT = z.infer<typeof EditCapability>;
