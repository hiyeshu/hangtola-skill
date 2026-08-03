/**
 * [INPUT]: 依赖 Node.js 标准库与 skills/hangtola/assets/template.html 的干净编辑器模板
 * [OUTPUT]: 对外生成 site/index.html，并仅为部署站点注入 GitHub 图标与 Skill 复制控件
 * [POS]: 仓库级部署适配器，在不污染可安装 Skill 资产的前提下组合 hangtola.app 产品外壳
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TEMPLATE_PATH = path.join(ROOT, 'skills/hangtola/assets/template.html');
const SITE_DIR = path.join(ROOT, 'site');
const OUTPUT_PATH = path.join(SITE_DIR, 'index.html');

const SITE_STYLES = `
/* ============================================================
   部署站点外壳：不进入 Skill 模板与生成榜单
   ============================================================ */
#site-meta {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  margin: -12px 0 20px; font-size: 13px; line-height: 1;
}
.site-meta-link, .site-meta-copy {
  min-height: 36px; display: inline-flex; align-items: center; gap: 8px;
  border-radius: 9999px; padding: 0 13px;
  background: var(--glass); color: var(--ink);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 4px 14px rgba(0, 0, 0, 0.07);
  backdrop-filter: blur(18px) saturate(1.8); -webkit-backdrop-filter: blur(18px) saturate(1.8);
  font: 600 13px/1 system-ui, -apple-system, "PingFang SC", sans-serif;
  text-decoration: none; white-space: nowrap;
  transition: background 160ms ease, color 160ms ease, transform 100ms ease;
}
.site-meta-link:hover, .site-meta-copy:hover { background: var(--panel-btn-h); }
.site-meta-link:focus-visible, .site-meta-copy:focus-visible {
  outline: 2px solid var(--accent-focus); outline-offset: 2px;
}
.site-meta-link svg, .site-meta-copy svg { width: 16px; height: 16px; flex: 0 0 auto; }
.site-meta-github { width: 36px; justify-content: center; padding: 0; }
.site-meta-copy { border: 0; cursor: pointer; }
.site-meta-copy:active { transform: scale(0.97); }
.site-meta-copy.is-copied { color: #248a3d; }
.site-meta-copy.is-error { color: #ff3b30; }
.site-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
@media (max-width: 520px) {
  #site-meta { flex-wrap: wrap; margin-top: -14px; }
  .site-meta-link, .site-meta-copy { min-height: 34px; padding: 0 11px; font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .site-meta-link, .site-meta-copy { transition: none; }
}
@media (prefers-reduced-transparency: reduce) {
  .site-meta-link, .site-meta-copy { background: var(--panel-bg); backdrop-filter: none; -webkit-backdrop-filter: none; }
}`;

const SITE_MARKUP = `
<nav id="site-meta" aria-label="Hangtola 项目与 Skill">
  <a class="site-meta-link site-meta-github" href="https://github.com/hiyeshu/hangtola-skill"
     target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 打开 hiyeshu/hangtola-skill">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.36-3.9-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.94 10.94 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/>
    </svg>
  </a>
  <button class="site-meta-copy" id="copy-skill" type="button"
          title="复制安装命令和提示词" aria-describedby="copy-skill-status">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2"/>
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
    </svg>
    <span data-copy-label>复制 Skill</span>
  </button>
  <span class="site-sr-only" id="copy-skill-status" aria-live="polite"></span>
</nav>`;

const SITE_SCRIPT = `
<script>
(() => {
  const button = document.querySelector('#copy-skill');
  if (!button) return;
  const label = button.querySelector('[data-copy-label]');
  const status = document.querySelector('#copy-skill-status');
  const usage = [
    'Hangtola Skill',
    'https://github.com/hiyeshu/hangtola-skill',
    '',
    '安装：',
    'npx skills add hiyeshu/hangtola-skill --skill hangtola',
    '',
    '提示词：',
    '用 $hangtola 把我上传的图片和备注排成夯到拉。'
  ].join('\\n');

  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('copy failed');
  }

  button.addEventListener('click', async () => {
    button.classList.remove('is-copied', 'is-error');
    try {
      await copyText(usage);
      label.textContent = '已复制';
      status.textContent = 'Skill 安装命令和提示词已复制';
      button.classList.add('is-copied');
    } catch {
      label.textContent = '复制失败';
      status.textContent = '复制失败，请打开 GitHub 查看安装方式';
      button.classList.add('is-error');
    }
    window.setTimeout(() => {
      label.textContent = '复制 Skill';
      button.classList.remove('is-copied', 'is-error');
    }, 1800);
  });
})();
</script>`;

function insertOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1 || first !== last) throw new Error(`${label} 注入点缺失或不唯一`);
  return source.replace(marker, replacement);
}

let html = await readFile(TEMPLATE_PATH, 'utf8');
html = insertOnce(html, '</style>', `${SITE_STYLES}\n</style>`, '站点样式');
html = insertOnce(html, '<body>', `<body>\n${SITE_MARKUP}`, '站点导航');
html = insertOnce(html, '</body>', `${SITE_SCRIPT}\n</body>`, '站点交互');

await rm(SITE_DIR, { recursive: true, force: true });
await mkdir(SITE_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, html);
console.log('站点构建完成：site/index.html（Skill 模板未修改）');
