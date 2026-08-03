/**
 * [INPUT]: 依赖 Node.js 标准库、skills/hangtola 技能目录与 package.json 构建约定
 * [OUTPUT]: 对外提供 npm run check，校验 Skill 元数据、资源引用、模板语法与 skills.sh 可发现结构
 * [POS]: 仓库级质量门，连接 Skill 真相源、部署模板与开放分发结构
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

const template = await readFile(path.join(SKILL_DIR, 'assets/template.html'), 'utf8');
assert(template.includes('<script id="hangtola-data" type="application/json">{}</script>'), '模板注入点必须保持空对象');
const scripts = [...template.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter((source) => source.trim() && source.trim() !== '{}');
for (const source of scripts) new vm.Script(source);

console.log(`检查通过：${REQUIRED_FILES.length} 个 Skill 文件、${scripts.length} 段模板脚本。`);
