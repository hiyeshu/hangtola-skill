/**
 * [INPUT]: 无外部依赖，常量与 skills/hangtola/scripts/render-board.js 的公开契约保持同源
 * [OUTPUT]: 对外提供 TIER_DEFS / TIER_KEYS / TEXT_COLORS 常量与 cleanText / clampWeight 归一化原语
 * [POS]: domain 的排名规则层，五档定义与受控调色板的唯一出处；codegen 与 schema 都从这里取值
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export const TIER_DEFS = [
  { key: 'hang', label: '夯', color: '#fb2018' },
  { key: 'top', label: '顶级', color: '#ffa640' },
  { key: 'upper', label: '人上人', color: '#fbf600' },
  { key: 'npc', label: 'NPC', color: '#fdf1c7' },
  { key: 'la', label: '拉完了', color: '#ffffff' },
] as const;

export type TierKey = (typeof TIER_DEFS)[number]['key'];
export const TIER_KEYS = TIER_DEFS.map((t) => t.key) as [TierKey, TierKey, TierKey, TierKey, TierKey];

/** 纯文字卡受控调色板（iOS 系统色）；图片卡 color 恒为 null */
export const TEXT_COLORS = [
  '#ffffff', '#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2',
] as const;

export const cleanText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** 维度权重限定 1..5，非数值回退 1（与 render-board 同构） */
export const clampWeight = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Math.min(5, Math.max(1, Number(value))) : 1;

export const isControlledColor = (value: string): boolean =>
  (TEXT_COLORS as readonly string[]).includes(value);
