/**
 * [INPUT]: 依赖 vitest 与 ../src 的 applyPatch / schema / 迁移工厂
 * [OUTPUT]: 对外提供 patch 应用器的合法操作、非法拒绝、纯函数与钳制语义测试
 * [POS]: 唯一修改语言的行为契约：任何一端（Agent/网页/CLI/MCP）背离此语义即为回归
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  PatchError,
  BoardPatchV1,
  type BoardDocumentV2T,
  type BoardPatchV1T,
} from '../src/index.js';

let seq = 100;
const deps = {
  newItemId: () => `itm_${String(++seq).padStart(16, '0')}`,
  now: () => 1_754_400_000_000,
};

function baseDoc(): BoardDocumentV2T {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '',
    footnote: '',
    savedAt: 1_754_000_000_000,
    dimensions: [{ name: '性能', weight: 3 }],
    tiers: [
      { key: 'hang', label: '夯', color: '#fb2018', items: [
        { id: 'itm_aaaaaaaaaaaaaaaa', text: 'A', image: null, note: 'n', color: '#0a84ff', evidence: [] },
      ] },
      { key: 'top', label: '顶级', color: '#ffa640', items: [] },
      { key: 'upper', label: '人上人', color: '#fbf600', items: [] },
      { key: 'npc', label: 'NPC', color: '#fdf1c7', items: [] },
      { key: 'la', label: '拉完了', color: '#ffffff', items: [] },
    ],
    pool: [
      { id: 'itm_bbbbbbbbbbbbbbbb', text: 'B', image: { kind: 'dataurl', dataUrl: 'data:image/png;base64,x' }, note: '', color: null, evidence: [] },
    ],
  };
}

function patchOf(ops: BoardPatchV1T['ops']): BoardPatchV1T {
  return BoardPatchV1.parse({
    schemaVersion: 'patch.v1',
    boardId: 'board-1',
    baseRevision: 'rev_00000000000000000001',
    ops,
    summary: 'test',
    author: { kind: 'web' },
  });
}

describe('applyPatch', () => {
  it('add / move / update / remove / setMeta / setDimensions 全链路', () => {
    const doc = baseDoc();
    const out = applyPatch(doc, patchOf([
      { op: 'addItem', item: { text: 'C', image: null, note: '', color: null, evidence: [] }, target: { tier: 'npc' } },
      { op: 'moveItem', itemId: 'itm_bbbbbbbbbbbbbbbb', to: { tier: 'hang', index: 0 } },
      { op: 'updateItem', itemId: 'itm_aaaaaaaaaaaaaaaa', set: { text: 'A+', note: '改' } },
      { op: 'setMeta', title: '新标题', tierLabels: { la: '摆烂' } },
      { op: 'setDimensions', dimensions: [{ name: '手感', weight: 5 }] },
    ]), deps);

    expect(out.tiers[0]!.items.map((i) => i.id)).toEqual(['itm_bbbbbbbbbbbbbbbb', 'itm_aaaaaaaaaaaaaaaa']);
    expect(out.tiers[0]!.items[1]!.text).toBe('A+');
    expect(out.tiers[3]!.items[0]!.text).toBe('C');
    expect(out.pool).toHaveLength(0);
    expect(out.title).toBe('新标题');
    expect(out.tiers[4]!.label).toBe('摆烂');
    expect(out.dimensions).toEqual([{ name: '手感', weight: 5 }]);
    expect(out.savedAt).toBe(1_754_400_000_000);
  });

  it('纯函数：入参文档不被修改；单个 op 失败即整体失败', () => {
    const doc = baseDoc();
    const snapshot = structuredClone(doc);
    expect(() => applyPatch(doc, patchOf([
      { op: 'setMeta', title: '先改这个' },
      { op: 'removeItem', itemId: 'itm_zzzzzzzzzzzzzzzz' },
    ]), deps)).toThrowError(PatchError);
    expect(doc).toEqual(snapshot);
  });

  it('图片卡设底色被拒；换图未清色自动归 null', () => {
    expect(() => applyPatch(baseDoc(), patchOf([
      { op: 'updateItem', itemId: 'itm_bbbbbbbbbbbbbbbb', set: { color: '#ff453a' } },
    ]), deps)).toThrowError(/color-on-image-card/);

    const out = applyPatch(baseDoc(), patchOf([
      { op: 'updateItem', itemId: 'itm_aaaaaaaaaaaaaaaa',
        set: { image: { kind: 'dataurl', dataUrl: 'data:image/png;base64,y' } } },
    ]), deps);
    expect(out.tiers[0]!.items[0]!.color).toBeNull();
  });

  it('移动索引越界钳制到桶尾；未知目标与重复 id 报类型化错误', () => {
    const out = applyPatch(baseDoc(), patchOf([
      { op: 'moveItem', itemId: 'itm_bbbbbbbbbbbbbbbb', to: { tier: 'la', index: 99 } },
    ]), deps);
    expect(out.tiers[4]!.items.map((i) => i.id)).toEqual(['itm_bbbbbbbbbbbbbbbb']);

    expect(() => applyPatch(baseDoc(), patchOf([
      { op: 'addItem', item: { id: 'itm_aaaaaaaaaaaaaaaa', text: 'dup', image: null, note: '', color: null, evidence: [] }, target: { tier: 'pool' } },
    ]), deps)).toThrowError(/duplicate-id/);

    expect(() => applyPatch(baseDoc(), patchOf([
      { op: 'addItem', item: { text: '', image: null, note: '', color: null, evidence: [] }, target: { tier: 'pool' } },
    ]), deps)).toThrowError(/empty-item/);
  });
});
