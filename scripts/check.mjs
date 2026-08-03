/**
 * [INPUT]: 依赖 Node.js 标准库、skills/hangtola 技能目录与 package.json 构建约定
 * [OUTPUT]: 对外提供 npm run check，校验 Skill 元数据、单名称 schema、三种同构导出比例、资源引用、模板语法、部署隔离与 skills.sh 可发现结构
 * [POS]: 仓库级质量门，保护 Skill 真相源不被短评死字段、导出布局漂移或部署站点外壳污染，并维持开放分发结构
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const SKILL_DIR = path.join(ROOT, 'skills/hangtola');
const REQUIRED_FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'assets/template.html',
  'references/input-contract.md',
  'scripts/render-board.mjs',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const relativePath of REQUIRED_FILES) {
  await access(path.join(SKILL_DIR, relativePath));
}

const skill = await readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
assert(skill.startsWith('---\n'), 'SKILL.md 缺少 YAML frontmatter');
assert(/^name:\s*hangtola$/m.test(skill), 'Skill name 必须是 hangtola');
assert(/^description:\s*>$/m.test(skill), 'Skill description 必须存在');
assert(skill.includes('references/input-contract.md'), 'SKILL.md 必须路由多模态输入契约');
assert(skill.includes('scripts/render-board.mjs'), 'SKILL.md 必须使用确定性渲染脚本');
assert(!skill.includes('caption'), 'SKILL.md 不得保留短评字段');

const template = await readFile(path.join(SKILL_DIR, 'assets/template.html'), 'utf8');
assert(template.includes('<script id="hangtola-data" type="application/json">{}</script>'), '模板注入点必须保持空对象');
assert(!template.includes('caption'), '模板不得保留短评字段');
assert(
  template.includes("const RATIOS = { '3:4': [1200, 1600], '4:3': [1600, 1200], '16:9': [1920, 1080] };"),
  '导出尺寸必须与 minitool 的 3:4、4:3、16:9 画幅同构',
);
assert(
  template.includes('const gap = 10 * u * kk, S = 150 * u * kk, capH = 32 * u * kk, slotH = S + capH;')
    && template.includes('for (let i = 0; i < 24; i++)')
    && template.includes('const extra = (availH - gridH) / rowHeights.length;'),
  '导出布局必须保留 minitool 的单行名字槽位、二分铺满与行高残差均摊',
);
assert(!template.includes('hiyeshu/hangtola-skill'), 'GitHub 部署入口不得进入 Skill 模板');
assert(!template.includes('copy-skill'), '部署站点控件不得进入 Skill 模板');
const scripts = [...template.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter((source) => source.trim() && source.trim() !== '{}');
for (const source of scripts) new vm.Script(source);

const inputContract = await readFile(path.join(SKILL_DIR, 'references/input-contract.md'), 'utf8');
const renderer = await readFile(path.join(SKILL_DIR, 'scripts/render-board.mjs'), 'utf8');
assert(!inputContract.includes('caption'), '输入契约不得保留短评字段');
assert(!renderer.includes('caption'), '确定性渲染器不得保留短评字段');

const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
assert(packageJson.scripts?.build === 'node scripts/build-site.mjs', '部署构建必须经过独立 build-site.mjs');

console.log(`检查通过：${REQUIRED_FILES.length} 个 Skill 文件、${scripts.length} 段模板脚本，部署外壳与 Skill 隔离。`);
