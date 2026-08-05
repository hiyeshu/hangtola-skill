/**
 * [INPUT]: 依赖 Node.js 标准库、skills/hangtola 技能目录、Skill 局部 ESM 声明与根 package.json 构建约定
 * [OUTPUT]: 对外提供 npm run check，校验 Skill 元数据、RedSkill 扩展名、模块语义、费曼文案面板、导出光学比例与部署隔离
 * [POS]: 仓库级质量门，阻止不兼容脚本、数据契约、交互文案或跨画幅视觉尺度漂移进入公开 Skill 真相源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SKILL_DIR = path.join(ROOT, 'skills/hangtola');
const REQUIRED_FILES = [
  'SKILL.md',
  'package.json',
  'agents/openai.yaml',
  'assets/template.html',
  'references/input-contract.md',
  'scripts/render-board.js',
  'scripts/board-validate.gen.js',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const relativePath of REQUIRED_FILES) {
  await access(path.join(SKILL_DIR, relativePath));
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

const skillFiles = await listFiles(SKILL_DIR);
assert(!skillFiles.some((file) => file.endsWith('.mjs')), '公开 Skill 包不得包含 RedSkill 不接收的 .mjs 文件');

const skill = await readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
assert(skill.startsWith('---\n'), 'SKILL.md 缺少 YAML frontmatter');
assert(/^name:\s*hangtola$/m.test(skill), 'Skill name 必须是 hangtola');
assert(/^description:\s*>$/m.test(skill), 'Skill description 必须存在');
assert(skill.includes('references/input-contract.md'), 'SKILL.md 必须路由多模态输入契约');
assert(skill.includes('scripts/render-board.js'), 'SKILL.md 必须使用 RedSkill 兼容的确定性渲染脚本');
assert(!skill.includes('caption'), 'SKILL.md 不得保留短评字段');

const skillPackageJson = JSON.parse(await readFile(path.join(SKILL_DIR, 'package.json'), 'utf8'));
assert(skillPackageJson.private === true, 'Skill 局部 package.json 必须保持 private');
assert(skillPackageJson.type === 'module', 'Skill 局部 package.json 必须显式声明 ESM，避免 .js 被误判为 CommonJS');

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
assert(
  template.includes('const frameScale = Math.min(W, H) / 1200;')
    && template.includes('clampNumber(rowHeight * 0.18, 32 * frameScale, 52 * frameScale)')
    && template.includes('fitTierLabel(ctx, t.label, labelW - 24 * frameScale, rh, frameScale, FONT)')
    && template.includes('clampNumber(measuredLabelW, gridW * 0.15, gridW * 0.22)'),
  '档位文字与标签列必须按短边和真实行高保持跨画幅光学比例',
);
assert(!template.includes('hiyeshu/hangtola-skill'), 'GitHub 部署入口不得进入 Skill 模板');
assert(!template.includes('copy-skill'), '部署站点控件不得进入 Skill 模板');
assert(
  template.includes('content: "点击添加标题"')
    && template.includes('<h3 class="panel-title">添加文字</h3>')
    && template.includes('<h3 class="panel-title">导出图片</h3>')
    && template.includes('>导出榜单数据</button>')
    && template.includes('>导入榜单数据</button>')
    && template.includes('<h3 class="panel-title">底部声明</h3>')
    && template.includes('>使用默认文案</button>')
    && template.includes('class="panel-actions"')
    && template.includes('<p>点击、拖动卡片即可排序。</p>')
    && template.includes('<p>图片支持一次多选、拖入或直接粘贴。记录自动保存在当前设备</p>'),
  '编辑器必须保持动作优先的费曼文案与统一表单操作栏',
);
assert(
  !template.includes('导出干净榜单图 · 选择比例')
    && !template.includes('导出数据（JSON，可交给 AI 续榜）')
    && !template.includes('底部声明 · 留空则不显示')
    && !template.includes('填入默认声明')
    && !template.includes('恢复默认声明')
    && !template.includes('添加文字条目'),
  '编辑器不得恢复技术实现导向或说明书式旧文案',
);
const scripts = [...template.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter((source) => source.trim() && source.trim() !== '{}');
for (const source of scripts) new vm.Script(source);

const inputContract = await readFile(path.join(SKILL_DIR, 'references/input-contract.md'), 'utf8');
const renderer = await readFile(path.join(SKILL_DIR, 'scripts/render-board.js'), 'utf8');
assert(!inputContract.includes('caption'), '输入契约不得保留短评字段');
assert(!renderer.includes('caption'), '确定性渲染器不得保留短评字段');

const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
assert(packageJson.scripts?.build === 'node scripts/build-site.mjs', '部署构建必须经过独立 build-site.mjs');

/* ============================================================
   领域模块门禁：codegen 新鲜度 → 类型检查 → 测试
   ============================================================ */
function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  assert(result.status === 0, `${label} 未通过`);
}
run('codegen 新鲜度', 'npx', ['tsx', 'packages/domain/scripts/emit-skill-validator.ts', '--check']);
run('离线模板零漂移', 'node', ['apps/web/build.mjs', '--check']);
run('领域类型检查', 'npx', ['tsc', '--build', 'packages/domain']);
run('Worker 类型检查', 'npx', ['tsc', '--noEmit', '-p', 'workers/hangtola/tsconfig.json']);
run('领域测试', 'npx', ['vitest', 'run', '--silent']);

console.log(`检查通过：${REQUIRED_FILES.length} 个 Skill 文件、${scripts.length} 段模板脚本，领域门禁全绿，部署外壳与 Skill 隔离。`);
