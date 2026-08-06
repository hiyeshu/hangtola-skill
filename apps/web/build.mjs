/**
 * [INPUT]: 依赖 src/template/{head.html,styles.css,body.html,editor.js,tail.html} 源部件与 src/hosted/ 托管扩展
 * [OUTPUT]: 对外提供双目标构建：--offline 逐字节重组 skills/hangtola/assets/template.html；--hosted 产出 workers/hangtola/public/（单机版首页/云端榜单页/离线模板副本）
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
/* 主入口 = 单机版完整编辑器（build-site.mjs 再注入站点外壳与智能排入口） */
writeFileSync(path.join(PUBLIC_DIR, 'index.html'), offline);
/* 云端榜单页 = 完整编辑器 + 云适配器：UI 与单机版零分叉，只换持久化引擎 */
const cloudHead = T('head.html').replace(/<title>[^<]*<\/title>/, '<title>夯到拉榜单</title>');
writeFileSync(path.join(PUBLIC_DIR, 'board.html'),
  `${cloudHead}<style>\n${T('styles.css')}${readFileSync(path.join(ROOT, 'apps/web/src/hosted/cloud.css'), 'utf8')}</style>\n${T('body.html')}<script>\n${T('editor.js')}</script>\n<script>\n${readFileSync(path.join(ROOT, 'apps/web/src/hosted/image-shrink.js'), 'utf8')}</script>\n<script>\n${readFileSync(path.join(ROOT, 'apps/web/src/hosted/cloud-adapter.js'), 'utf8')}</script>${T('tail.html')}`);
copyFileSync(TEMPLATE_OUT, path.join(PUBLIC_DIR, 'template.html'));
console.log('已产出 workers/hangtola/public/{index(单机版),board,template}.html');
