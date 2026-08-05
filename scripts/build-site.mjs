/**
 * [INPUT]: 依赖 apps/web/build.mjs（离线模板重组 + 托管页产出）与其 public/index.html 产物
 * [OUTPUT]: 对外提供 npm run build：驱动 apps/web 双目标构建，并仅向托管首页注入 GitHub 图标与 Skill 复制控件
 * [POS]: 仓库级部署适配器——站点专属外壳只进 workers/hangtola/public，永不写回 Skill 模板与离线产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const HOME_PATH = path.join(ROOT, 'workers/hangtola/public/index.html');

const built = spawnSync('node', ['apps/web/build.mjs'], { cwd: ROOT, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const SITE_STYLES = `
/* ============================================================
   部署站点外壳：不进入 Skill 模板与离线产物
   ============================================================ */
#site-meta {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 14px 16px 0; font-size: 13px; line-height: 1;
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
.site-meta-link svg, .site-meta-copy svg { width: 16px; height: 16px; flex: 0 0 auto; }
.site-meta-github { width: 36px; justify-content: center; padding: 0; }
.site-meta-copy { border: 0; cursor: pointer; }
.site-meta-copy:active { transform: scale(0.97); }
.site-meta-copy.is-copied { color: #248a3d; }
.site-meta-copy.is-error { color: #ff3b30; }`;

const SITE_MARKUP = `
<nav id="site-meta" aria-label="Hangtola 项目与 Skill">
  <a class="site-meta-link site-meta-github" href="https://github.com/hiyeshu/hangtola-skill"
     target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 打开 hiyeshu/hangtola-skill">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.36-3.9-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.94 10.94 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/>
    </svg>
  </a>
  <button class="site-meta-copy" id="copy-skill" type="button" title="复制 Skill 安装命令">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2"/>
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
    </svg>
    <span data-copy-label>复制 Skill</span>
  </button>
</nav>`;

const SITE_SCRIPT = `
<script>
(() => {
  const button = document.querySelector('#copy-skill');
  if (!button) return;
  const label = button.querySelector('[data-copy-label]');
  const installCommand = 'npx skills add hiyeshu/hangtola-skill --skill hangtola';
  button.addEventListener('click', async () => {
    button.classList.remove('is-copied', 'is-error');
    try {
      await navigator.clipboard.writeText(installCommand);
      label.textContent = '已复制';
      button.classList.add('is-copied');
    } catch {
      label.textContent = '复制失败';
      button.classList.add('is-error');
    }
    setTimeout(() => {
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

let html = await readFile(HOME_PATH, 'utf8');
html = insertOnce(html, '</style>', `${SITE_STYLES}\n</style>`, '站点样式');
html = insertOnce(html, '<body>', `<body>${SITE_MARKUP}`, '站点导航');
html = insertOnce(html, '</body>', `${SITE_SCRIPT}\n</body>`, '站点交互');
await writeFile(HOME_PATH, html);
console.log('站点构建完成：workers/hangtola/public/index.html 已注入部署外壳（Skill 模板未修改）');
