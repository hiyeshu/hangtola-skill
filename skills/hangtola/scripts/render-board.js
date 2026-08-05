/**
 * [INPUT]: 依赖 Node.js 标准库、榜单 JSON、../assets/template.html、./board-validate.gen.js（domain 代码生成的契约镜像）与 JSON 中可选的本地图片路径
 * [OUTPUT]: 对外提供 CLI，将校验并归一化后的榜单和离线图片安全嵌入独立 HTML
 * [POS]: hangtola 技能的 RedSkill 兼容确定性生成边界，模块语义由上级 package.json 固定，替代 Agent 手工拼接 HTML 与 base64；形状规则真相在 packages/domain
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndNormalizeBoard } from './board-validate.gen.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = path.resolve(SCRIPT_DIR, '../assets/template.html');
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
    '用法: node render-board.js <board.json> <output.html> [--template <template.html>]',
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

function escapeEmbeddedJson(value) {
  return JSON.stringify(value)
    .replaceAll('</script', '<\\/script')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
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
  const baseDirectory = path.dirname(options.input);
  const board = await validateAndNormalizeBoard(parsed, {
    embedImage: (value) => embedImage(value, baseDirectory),
  });
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
