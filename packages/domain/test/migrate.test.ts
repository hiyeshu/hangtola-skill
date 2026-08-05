/**
 * [INPUT]: 依赖 vitest、../src 领域 API、fixtures/board.v1.json 与 skills 生成校验器
 * [OUTPUT]: 对外提供迁移三桥的回环与隐私投影测试，以及 domain ↔ 生成校验器的交叉一致性验证
 * [POS]: P1 验收的机器化形态：旧 JSON 兼容与公开投影边界在此被钉死
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  migrateLegacyToV2,
  toLegacyBoard,
  toPublicView,
  MigrationError,
  TIER_DEFS,
} from '../src/index.js';
// @ts-expect-error 生成产物为纯 JS，无类型声明——交叉验证有意直接消费它
import { validateAndNormalizeBoard } from '../../../skills/hangtola/scripts/board-validate.gen.js';

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const legacyFixture = JSON.parse(
  readFileSync(path.join(FIXTURE_DIR, 'fixtures/board.v1.json'), 'utf8'),
);

const RED_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** fixture 里的本地路径在纯领域测试中statically替换为 dataURL */
function withEmbeddedImages(board: unknown): unknown {
  return JSON.parse(JSON.stringify(board).replaceAll('"red.png"', JSON.stringify(RED_DATAURL)));
}

let seq = 0;
const deps = { newItemId: () => `itm_${String(++seq).padStart(16, '0')}` };

describe('migrateLegacyToV2', () => {
  it('宽松旧 JSON 迁出严格 V2：幽灵档丢弃、非法色归零、权重钳制、空名维度过滤', () => {
    const doc = migrateLegacyToV2(withEmbeddedImages(legacyFixture), deps);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.tiers.map((t) => t.key)).toEqual(TIER_DEFS.map((t) => t.key));
    expect(doc.tiers[0]!.label).toBe('夯');                        // 空 label 回退默认
    expect(doc.tiers[1]!.label).toBe('自定义顶级');
    expect(doc.dimensions).toEqual([{ name: '性能', weight: 3 }, { name: '口碑', weight: 1 }]);
    const flat = [...doc.tiers.flatMap((t) => t.items), ...doc.pool];
    expect(flat.every((it) => /^itm_[0-9a-z_]{16}$/.test(it.id) || /^itm_\d{16}$/.test(it.id))).toBe(true);
    expect(flat.find((it) => it.text === '条目A')!.color).toBeNull();   // 图片卡强制无色
    expect(flat.find((it) => it.text === '纯文字B')!.color).toBe('#0a84ff');
    expect(flat.find((it) => it.text === '条目C')!.color).toBeNull();   // 非受控色
    expect(flat.find((it) => it.text === '不应出现')).toBeUndefined();  // 幽灵档
  });

  it('拒绝未内嵌图片进入云端文档', () => {
    expect(() => migrateLegacyToV2(legacyFixture, deps)).toThrowError(MigrationError);
  });

  it('与生成校验器交叉一致：gen.js 归一化结果可无损迁入 V2', async () => {
    const normalized = await validateAndNormalizeBoard(legacyFixture, {
      embedImage: async (v: unknown) =>
        typeof v === 'string' && v.trim() ? RED_DATAURL : null,
    });
    const doc = migrateLegacyToV2(normalized, deps);
    const back = await toLegacyBoard(doc, async () => RED_DATAURL);
    expect(back.tiers.map((t) => ({ ...t, items: t.items }))).toEqual(normalized.tiers);
    expect(back.pool).toEqual(normalized.pool);
    expect(back.id).toBe(normalized.id);
    expect(back.title).toBe(normalized.title);
    expect(back.footnote).toBe(normalized.footnote);
    expect(back.dimensions).toEqual(normalized.dimensions);
  });
});

describe('toPublicView', () => {
  it('公开投影只含名称/图/档位/展示属性，note/evidence/dimensions 全部不可达', () => {
    const doc = migrateLegacyToV2(withEmbeddedImages(legacyFixture), deps);
    doc.tiers[0]!.items[0]!.evidence = [{
      claim: '内部证据', sources: [{ url: 'https://example.com', title: 't', snippet: '' }],
      status: 'supported', confidence: 0.9,
    }];
    const view = toPublicView(doc, (assetId) => `/assets/x/${assetId}`);
    const banned = ['note', 'evidence', 'dimensions', 'savedAt'];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          expect(banned).not.toContain(k);
          walk(v);
        }
      }
    };
    walk(view);
    expect(view.tiers[0]!.items[0]!.text).toBe('条目A');
    expect(view.pool[0]!.text).toBe('备选D');
  });
});
