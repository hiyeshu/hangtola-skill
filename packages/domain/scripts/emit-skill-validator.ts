/**
 * [INPUT]: 依赖 ../src/rank 的 TIER_DEFS / TEXT_COLORS 常量与 Node fs/path
 * [OUTPUT]: 对外提供代码生成 CLI：产出 skills/hangtola/scripts/board-validate.gen.js（零依赖纯 JS 校验器）；--check 校验新鲜度
 * [POS]: domain 与公开 Skill 之间的单向桥：Skill 目录不引入运行时依赖，规则真相只在 domain
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIER_DEFS, TEXT_COLORS } from '../src/rank.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(SCRIPT_DIR, '../../../skills/hangtola/scripts/board-validate.gen.js');

const tierDefsLiteral = TIER_DEFS
  .map((t) => `  { key: '${t.key}', label: '${t.label}', color: '${t.color}' },`)
  .join('\n');
const textColorsLiteral = TEXT_COLORS.map((c) => `'${c}'`).join(', ');

const generated = `/**
 * [INPUT]: 无运行时依赖；常量与规则由 packages/domain 代码生成（emit-skill-validator.ts）
 * [OUTPUT]: 对外提供 validateAndNormalizeBoard 与 TIER_DEFS / TEXT_COLORS，供 render-board.js 消费
 * [POS]: hangtola 技能内的领域契约镜像——请勿手改，运行 npm run codegen 重新生成
 * [PROTOCOL]: 本文件为生成产物；修改规则请改 packages/domain 后重新生成
 */

export const TIER_DEFS = [
${tierDefsLiteral}
];

export const TEXT_COLORS = new Set([
  ${textColorsLiteral},
]);

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDimensions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((dimension) => ({
      name: cleanText(dimension?.name),
      weight: Number.isFinite(Number(dimension?.weight))
        ? Math.min(5, Math.max(1, Number(dimension.weight)))
        : 1,
    }))
    .filter((dimension) => dimension.name);
}

async function normalizeItem(value, embedImage, location) {
  const text = cleanText(value?.text);
  const note = cleanText(value?.note);
  const image = await embedImage(value?.image);
  if (!text && !image) {
    throw new Error(\`\${location} 至少要有 text 或 image\`);
  }

  return {
    text,
    image,
    note,
    color: !image && TEXT_COLORS.has(cleanText(value?.color).toLowerCase())
      ? cleanText(value.color).toLowerCase()
      : null,
  };
}

async function normalizeItems(value, embedImage, location) {
  if (!Array.isArray(value)) return [];
  return Promise.all(value.map((item, index) =>
    normalizeItem(item, embedImage, \`\${location}[\${index}]\`)));
}

/**
 * 校验并归一化榜单 JSON。embedImage(rawImageValue) 由调用方注入，
 * 负责把本地路径变成 data: URL（或对 data:/空值直接返回），保持 IO 在调用方。
 */
export async function validateAndNormalizeBoard(value, { embedImage }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('榜单 JSON 顶层必须是对象');
  }

  const providedTiers = new Map(
    (Array.isArray(value.tiers) ? value.tiers : [])
      .filter((tier) => tier && typeof tier === 'object')
      .map((tier) => [tier.key, tier]),
  );
  const tiers = [];
  for (const definition of TIER_DEFS) {
    const source = providedTiers.get(definition.key) || {};
    tiers.push({
      ...definition,
      label: cleanText(source.label) || definition.label,
      items: await normalizeItems(source.items, embedImage, \`tiers.\${definition.key}.items\`),
    });
  }

  return {
    id: cleanText(value.id) || \`hangtola-\${Date.now()}\`,
    title: cleanText(value.title),
    footnote: cleanText(value.footnote),
    savedAt: new Date().toISOString(),
    dimensions: normalizeDimensions(value.dimensions),
    tiers,
    pool: await normalizeItems(value.pool, embedImage, 'pool'),
  };
}
`;

const checkMode = process.argv.includes('--check');
let existing = null;
try { existing = readFileSync(TARGET, 'utf8'); } catch { /* 尚未生成 */ }

if (checkMode) {
  if (existing !== generated) {
    console.error('board-validate.gen.js 已过期：请运行 npm run codegen 重新生成');
    process.exit(1);
  }
  console.log('codegen 新鲜度检查通过');
} else {
  mkdirSync(path.dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, generated, 'utf8');
  console.log(`已生成 ${path.relative(process.cwd(), TARGET)}`);
}
