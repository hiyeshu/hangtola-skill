/**
 * [INPUT]: 依赖 Node.js 标准库、榜单 JSON、../assets/template.html 与 JSON 中可选的本地图片路径
 * [OUTPUT]: 对外提供 CLI，将校验并归一化后的榜单和离线图片安全嵌入独立 HTML
 * [POS]: hangtola 技能的确定性生成边界，替代 Agent 手工拼接 HTML 与 base64
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = path.resolve(SCRIPT_DIR, '../assets/template.html');
const TIER_DEFS = [
  { key: 'hang', label: '夯', color: '#fb2018' },
  { key: 'top', label: '顶级', color: '#ffa640' },
  { key: 'upper', label: '人上人', color: '#fbf600' },
  { key: 'npc', label: 'NPC', color: '#fdf1c7' },
  { key: 'la', label: '拉完了', color: '#ffffff' },
];
const TEXT_COLORS = new Set([
  '#ffffff', '#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2',
]);
const MIME_BY_EXTENSION = new Map([
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function usage() {
  return [
    '用法: node render-board.mjs <board.json> <output.html> [--template <template.html>]',
    '',
    'image 字段可使用 data: URL、相对 board.json 的图片路径或绝对路径。',
    'HTTP(S) 图片会被拒绝，确保生成物可离线运行。',
  ].join('\n');
}

function parseArguments(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    process.exit(0);
  }

  const positional = [];
  let template = DEFAULT_TEMPLATE;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--template') {
      template = path.resolve(argv[index + 1] || '');
      index += 1;
      continue;
    }
    positional.push(argument);
  }

  if (positional.length !== 2) {
    throw new Error(usage());
  }

  return {
    input: path.resolve(positional[0]),
    output: path.resolve(positional[1]),
    template,
  };
}

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

async function embedImage(value, baseDirectory) {
  const image = cleanText(value);
  if (!image) return null;
  if (image.startsWith('data:image/')) return image;
  if (/^https?:\/\//i.test(image)) {
    throw new Error(`图片必须离线嵌入，不能使用远程 URL: ${image}`);
  }

  const imagePath = path.isAbsolute(image) ? image : path.resolve(baseDirectory, image);
  const extension = path.extname(imagePath).toLowerCase();
  const mime = MIME_BY_EXTENSION.get(extension);
  if (!mime) {
    throw new Error(`不支持的图片格式: ${imagePath}`);
  }
  const bytes = await readFile(imagePath);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function normalizeItem(value, baseDirectory, location) {
  const text = cleanText(value?.text);
  const caption = cleanText(value?.caption);
  const note = cleanText(value?.note);
  const image = await embedImage(value?.image, baseDirectory);
  if (!text && !image) {
    throw new Error(`${location} 至少要有 text 或 image`);
  }

  return {
    text,
    image,
    caption: image ? caption : '',
    note,
    color: !image && TEXT_COLORS.has(cleanText(value?.color).toLowerCase())
      ? cleanText(value.color).toLowerCase()
      : null,
  };
}

async function normalizeItems(value, baseDirectory, location) {
  if (!Array.isArray(value)) return [];
  return Promise.all(value.map((item, index) =>
    normalizeItem(item, baseDirectory, `${location}[${index}]`)));
}

async function normalizeBoard(value, baseDirectory) {
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
      items: await normalizeItems(source.items, baseDirectory, `tiers.${definition.key}.items`),
    });
  }

  return {
    id: cleanText(value.id) || `hangtola-${Date.now()}`,
    title: cleanText(value.title),
    footnote: cleanText(value.footnote),
    savedAt: new Date().toISOString(),
    dimensions: normalizeDimensions(value.dimensions),
    tiers,
    pool: await normalizeItems(value.pool, baseDirectory, 'pool'),
  };
}

function escapeEmbeddedJson(value) {
  return JSON.stringify(value)
    .replaceAll('</script', '<\\/script')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function injectBoard(template, board) {
  const marker = /(<script id="hangtola-data" type="application\/json">)[\s\S]*?(<\/script>)/;
  if (!marker.test(template)) {
    throw new Error('模板缺少 #hangtola-data 注入点');
  }
  return template.replace(marker, `$1${escapeEmbeddedJson(board)}$2`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [source, template] = await Promise.all([
    readFile(options.input, 'utf8'),
    readFile(options.template, 'utf8'),
  ]);
  const parsed = JSON.parse(source);
  const board = await normalizeBoard(parsed, path.dirname(options.input));
  const html = injectBoard(template, board);
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, html, 'utf8');

  const rankedCount = board.tiers.reduce((sum, tier) => sum + tier.items.length, 0);
  const imageCount = [...board.tiers.flatMap((tier) => tier.items), ...board.pool]
    .filter((item) => item.image).length;
  console.log(`已生成 ${options.output}：${rankedCount} 个已定档条目，${board.pool.length} 个待定，${imageCount} 张图片。`);
}

main().catch((error) => {
  console.error(`生成失败：${error.message}`);
  process.exitCode = 1;
});
