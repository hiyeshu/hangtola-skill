/**
 * [INPUT]: 依赖 ./schema 的 BoardPatchV1 / BoardDocumentV2 契约与 ./ids 的条目工厂
 * [OUTPUT]: 对外提供纯函数 applyPatch 与类型化 PatchError；冲突检测（baseRevision）归调用方（DO）
 * [POS]: domain 的唯一修改语义：Agent/网页/CLI/MCP 的一切编辑都编译为 PatchOp 经此应用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import {
  BoardDocumentV2,
  type BoardDocumentV2T,
  type BoardPatchV1T,
  type ItemV2T,
  type PatchOpT,
} from './schema.js';

export type PatchErrorCode =
  | 'unknown-item'
  | 'bad-target'
  | 'color-on-image-card'
  | 'empty-item'
  | 'duplicate-id';

export class PatchError extends Error {
  constructor(public readonly code: PatchErrorCode, message: string, public readonly opIndex: number) {
    super(`ops[${opIndex}] ${code}: ${message}`);
    this.name = 'PatchError';
  }
}

interface ApplyDeps {
  newItemId: () => string;
  now?: () => number;
}

type Bucket = { tier: string; items: ItemV2T[] };

function buckets(doc: BoardDocumentV2T): Bucket[] {
  return [...doc.tiers.map((t) => ({ tier: t.key as string, items: t.items })), { tier: 'pool', items: doc.pool }];
}

function locate(doc: BoardDocumentV2T, itemId: string): { bucket: Bucket; index: number } | null {
  for (const bucket of buckets(doc)) {
    const index = bucket.items.findIndex((it) => it.id === itemId);
    if (index >= 0) return { bucket, index };
  }
  return null;
}

function targetBucket(doc: BoardDocumentV2T, tier: string): Bucket | null {
  return buckets(doc).find((b) => b.tier === tier) ?? null;
}

function applyOp(doc: BoardDocumentV2T, op: PatchOpT, opIndex: number, deps: ApplyDeps): void {
  switch (op.op) {
    case 'addItem': {
      const id = op.item.id ?? deps.newItemId();
      if (locate(doc, id)) throw new PatchError('duplicate-id', id, opIndex);
      if (!op.item.text.trim() && op.item.image === null) {
        throw new PatchError('empty-item', '至少要有 text 或 image', opIndex);
      }
      if (op.item.image !== null && op.item.color !== null) {
        throw new PatchError('color-on-image-card', id, opIndex);
      }
      const bucket = targetBucket(doc, op.target.tier);
      if (!bucket) throw new PatchError('bad-target', op.target.tier, opIndex);
      const item: ItemV2T = {
        id,
        text: op.item.text.trim(),
        image: op.item.image,
        note: op.item.note,
        color: op.item.color,
        evidence: op.item.evidence,
      };
      const index = op.target.index === undefined
        ? bucket.items.length
        : Math.min(Math.max(0, op.target.index), bucket.items.length);
      bucket.items.splice(index, 0, item);
      return;
    }
    case 'updateItem': {
      const found = locate(doc, op.itemId);
      if (!found) throw new PatchError('unknown-item', op.itemId, opIndex);
      const item = found.bucket.items[found.index]!;
      const next: ItemV2T = {
        ...item,
        ...(op.set.text !== undefined ? { text: op.set.text.trim() } : {}),
        ...(op.set.note !== undefined ? { note: op.set.note } : {}),
        ...(op.set.image !== undefined ? { image: op.set.image } : {}),
        ...(op.set.color !== undefined ? { color: op.set.color } : {}),
        ...(op.set.evidence !== undefined ? { evidence: op.set.evidence } : {}),
      };
      if (!next.text && next.image === null) {
        throw new PatchError('empty-item', op.itemId, opIndex);
      }
      if (next.image !== null && next.color !== null) {
        /* 图片卡不许带底色：显式设置视为非法，隐式遗留（换图未清色）自动归 null */
        if (op.set.color !== undefined && op.set.color !== null) {
          throw new PatchError('color-on-image-card', op.itemId, opIndex);
        }
        next.color = null;
      }
      found.bucket.items[found.index] = next;
      return;
    }
    case 'moveItem': {
      const found = locate(doc, op.itemId);
      if (!found) throw new PatchError('unknown-item', op.itemId, opIndex);
      const bucket = targetBucket(doc, op.to.tier);
      if (!bucket) throw new PatchError('bad-target', op.to.tier, opIndex);
      const [item] = found.bucket.items.splice(found.index, 1);
      const index = Math.min(Math.max(0, op.to.index), bucket.items.length);
      bucket.items.splice(index, 0, item!);
      return;
    }
    case 'removeItem': {
      const found = locate(doc, op.itemId);
      if (!found) throw new PatchError('unknown-item', op.itemId, opIndex);
      found.bucket.items.splice(found.index, 1);
      return;
    }
    case 'setDimensions': {
      doc.dimensions = op.dimensions.map((d) => ({ ...d }));
      return;
    }
    case 'setMeta': {
      if (op.title !== undefined) doc.title = op.title.trim();
      if (op.footnote !== undefined) doc.footnote = op.footnote.trim();
      if (op.tierLabels) {
        for (const tier of doc.tiers) {
          const label = op.tierLabels[tier.key];
          if (label !== undefined) tier.label = label.trim() || tier.label;
        }
      }
      return;
    }
  }
}

/** 纯函数：不修改入参；任何一个 op 失败即整体失败，不产生半应用状态 */
export function applyPatch(
  doc: BoardDocumentV2T,
  patch: BoardPatchV1T,
  deps: ApplyDeps,
): BoardDocumentV2T {
  const draft = structuredClone(doc);
  patch.ops.forEach((op, index) => applyOp(draft, op, index, deps));
  draft.savedAt = (deps.now ?? Date.now)();
  return BoardDocumentV2.parse(draft);
}
