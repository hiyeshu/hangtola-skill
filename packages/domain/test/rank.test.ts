/**
 * [INPUT]: 依赖 vitest 与 ../src/rank 的 enforceGrounding
 * [OUTPUT]: 对外提供无捏造强制的行为契约测试：强制项必入 pool、打标、顺序与其余项不受扰动
 * [POS]: P3 降级矩阵的领域层验收
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { describe, expect, it } from 'vitest';
import { enforceGrounding, type DraftShape } from '../src/rank.js';

const draft = (): DraftShape => ({
  title: '',
  dimensions: [{ name: '综合', weight: 3 }],
  tiers: [
    { key: 'hang', items: [{ text: 'A', note: 'a', color: null }, { text: '幽灵机', note: '', color: null }] },
    { key: 'top', items: [{ text: 'B', note: 'b', color: null }] },
    { key: 'upper', items: [] },
    { key: 'npc', items: [] },
    { key: 'la', items: [] },
  ],
  pool: [{ text: 'C', note: 'c', color: null }],
});

describe('enforceGrounding', () => {
  it('强制项无论被排到哪档都押回 pool 并打标；其余原样', () => {
    const out = enforceGrounding(draft(), new Set(['幽灵机']));
    expect(out.tiers[0]!.items.map((i) => i.text)).toEqual(['A']);
    expect(out.pool.map((i) => i.text)).toEqual(['C', '幽灵机']);
    expect(out.pool[1]!.note).toBe('证据不足，未定档');
    expect(out.tiers[1]!.items[0]!.text).toBe('B');
  });

  it('已有 note 的追加打标；空集合零改动', () => {
    const base = draft();
    base.tiers[0]!.items[0] = { text: 'A', note: '原依据', color: null };
    const out = enforceGrounding(base, new Set(['A']));
    expect(out.pool.at(-1)!.note).toBe('原依据（证据不足，未定档）');
    expect(enforceGrounding(draft(), new Set())).toEqual(draft());
  });
});
