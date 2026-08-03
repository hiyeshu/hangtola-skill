# hangtola-skill - 夯到拉排行榜生成技能工作区
纯静态 HTML/CSS/JS + Claude Code Skill 规范 + Cloudflare Pages

<directory>
hangtola/ - 技能真相源（软链至 ~/.claude/skills/hangtola），含 SKILL.md 工作流与 assets/template.html 独立编辑器模板
dist/ - package_skill.py 产出的 .skill 分发包（随仓库分发）
site/ - npm run build 的部署产物（template.html → index.html），gitignore，Cloudflare Pages 部署目录
</directory>

<config>
hangtola/SKILL.md - 技能入口：触发描述 + 八步工作流（记忆→条目→维度→调研→定档→生成→写忆→交付）+ 数据 schema
hangtola/assets/template.html - 零依赖单文件编辑器 = hangtola.app 页面本体：经典黑框网格榜单（导出即所见，透明底 PNG）+ Apple 设计系统外壳 + 底部悬浮 touch bar；指针拖拽定档（鼠标/触屏统一），轻点/长按/右键同源卡片操作单（定档色块/底色圆点/改名/删除）；统一竖版卡片框；字号自适应；深浅色双模式；标题与声明条可选
README.md - GitHub 主入口（hiyeshu/hangtola-skill）：产品说明、hangtola.app 在线地址、技能安装、结构与部署
package.json - 构建边界：build 复制模板为 site/index.html；deploy 走 wrangler pages（项目名 hangtola，域名 hangtola.app）
.gitignore - 忽略 site/ 构建产物、.DS_Store、node_modules、.wrangler 缓存
</config>

架构决策:
真相源放本工作区、技能库只挂软链——开发与分发解耦，Git 化不污染 ~/.claude。
一份模板三种身份：技能资产、hangtola.app 页面、.skill 包内容——site/ 只是复制品，永不手改。
榜单本体与外壳分层：网格视觉锁定经典 tier list 样式（用户参考图为准），外壳独立遵循 Apple token（#f5f5f7/#0066cc/毛玻璃胶囊），互不侵染。
模板离线自足：数据经 #hangtola-data 内嵌 JSON 注入，图片一律 base64 禁外链；
localStorage 按榜单 id 隔离自动保存，与内嵌数据比 savedAt 时间新者胜。
note（定档理由）只存数据供 AI 续榜；标题与声明条皆可选——导出图的干净是产品底线。
维度记忆落在使用方项目的 .hangtola/ 目录（属运行时产物，不在本仓库）。

变更日志:
2026-08-03 - 产品化：透明 PNG、统一卡片框、文字卡底色与自适应字号、标题可选、声明条表格化；上 GitHub（hiyeshu/hangtola-skill）并部署 hangtola.app。
2026-08-03 - 交互重构：废顶部按钮改底部 touch bar；Pointer Events 替代 HTML5 DnD 根治移动端；参考图定型经典网格；Apple 设计系统外壳；深浅色模式。
2026-08-03 - 初版：技能骨架 + 模板 + 打包。

法则: 极简·稳定·导航·版本精确
