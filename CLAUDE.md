# hangtola-skill - 多模态夯到拉榜单 Skill 与离线编辑器
Agent Skills 开放规范 + 原生 HTML/CSS/JavaScript + Node.js CLI + Cloudflare Workers 静态资产

<directory>
skills/ - skills.sh 可发现的 Skill 集合；当前仅含 hangtola
scripts/ - 仓库级检查工具，不进入 Skill 运行时工作流
site/ - npm run build 生成的部署副本，永不手改且不入 Git
</directory>

<config>
skills/hangtola/SKILL.md - Skill 入口：多模态输入归一化、维度、调研、定档、呈现参数、生成与交付
skills/hangtola/assets/template.html - hangtola.app 与生成 HTML 的唯一模板真相源
skills/hangtola/scripts/render-board.mjs - 校验榜单 JSON、嵌入本地图片并安全注入模板
README.md - GitHub 与 skills.sh 用户入口、通用安装命令和开发说明
package.json - check/build/deploy 边界；build 只复制模板到 site/index.html
wrangler.toml - assets-only Worker「hangtola」与 hangtola.app 自定义域配置
.gitignore - 忽略 site、node_modules、Wrangler 缓存与系统文件
</config>

架构决策:
开放分发只认 `skills/hangtola/` 真相源；不维护私有 `.skill` 二进制副本，避免双重版本。
数据模型分离 `text` 稳定名称、`caption` 公开短评、`note` 内部依据；图片和纯文字共享定档模型。
纯文字 `color` 由 AI 从受控调色板按语义选择；图片卡颜色固定为空，拒绝无效参数。
HTML 生成必须经过 render-board.mjs，禁止 Agent 手工拼 base64 或替换 JSON script。
批量图片异步压缩必须保持输入顺序；用户拖拽决定档位与档内次序。
大图榜单用 IndexedDB 自动保存，localStorage 只保留旧数据与能力降级回退。
模板离线自足，图片只能是本地路径或 data URL；site 只是部署副本。
维度与榜单记忆落在使用方项目 `.hangtola/`，不进入本仓库。

变更日志:
2026-08-03 - 迁移至 skills.sh 兼容目录；加入多图输入、公开短评、纯文字智能配色、确定性渲染脚本与 IndexedDB。
2026-08-03 - 同步 minitool-build 通用改进：软键盘上浮、安全区、无刷新重置、满幅比例导出。
2026-08-03 - 产品化并部署 hangtola.app：透明 PNG、统一卡片框、深浅色与可编辑标题/声明。

法则: 极简·稳定·导航·版本精确
