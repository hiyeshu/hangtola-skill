/**
 * [INPUT]: 依赖 src/template/{head.html,styles.css,body.html,editor.js,tail.html} 源部件与 src/hosted/ 托管扩展
 * [OUTPUT]: 对外提供双目标构建：--offline 逐字节重组 skills/hangtola/assets/template.html；--hosted 产出 workers/hangtola/public/（首页/榜单页/离线模板副本）
 * [POS]: apps/web 的唯一构建入口——离线单文件是构建产物、模块是源；--check 校验离线产物零漂移
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T = (name) => readFileSync(path.join(ROOT, 'apps/web/src/template', name), 'utf8');
const TEMPLATE_OUT = path.join(ROOT, 'skills/hangtola/assets/template.html');
const PUBLIC_DIR = path.join(ROOT, 'workers/hangtola/public');

/** 离线单文件：五部件按固定语法逐字节重组 */
function buildOffline() {
  return `${T('head.html')}<style>\n${T('styles.css')}</style>\n${T('body.html')}<script>\n${T('editor.js')}</script>${T('tail.html')}`;
}

/** 托管页共用外壳：同一套样式 + 附加托管模块 */
function hostedPage({ title, body, scripts }) {
  const head = T('head.html')
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  return `${head}<style>\n${T('styles.css')}${readFileSync(path.join(ROOT, 'apps/web/src/hosted/hosted.css'), 'utf8')}</style>\n</head>\n<body>\n${body}\n${scripts.map((s) => `<script type="module">\n${readFileSync(path.join(ROOT, 'apps/web/src/hosted', s), 'utf8')}</script>`).join('\n')}\n</body>\n</html>\n`;
}

const mode = process.argv[2] ?? '--all';
const offline = buildOffline();

if (mode === '--check') {
  const current = readFileSync(TEMPLATE_OUT, 'utf8');
  if (current !== offline) {
    console.error('template.html 与 apps/web/src/template 源部件不一致：请编辑源部件后运行 node apps/web/build.mjs');
    process.exit(1);
  }
  console.log('离线模板零漂移 ✓');
  process.exit(0);
}

writeFileSync(TEMPLATE_OUT, offline);
console.log('已重组 skills/hangtola/assets/template.html');

mkdirSync(PUBLIC_DIR, { recursive: true });
writeFileSync(path.join(PUBLIC_DIR, 'index.html'), hostedPage({
  title: '夯到拉 Hangtola — 万物皆可排',
  body: readFileSync(path.join(ROOT, 'apps/web/src/hosted/home.html'), 'utf8'),
  scripts: ['home.js'],
}));
writeFileSync(path.join(PUBLIC_DIR, 'board.html'), hostedPage({
  title: '夯到拉榜单',
  body: readFileSync(path.join(ROOT, 'apps/web/src/hosted/board.html'), 'utf8'),
  scripts: ['board.js'],
}));
copyFileSync(TEMPLATE_OUT, path.join(PUBLIC_DIR, 'template.html'));
console.log('已产出 workers/hangtola/public/{index,board,template}.html');
