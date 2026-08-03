# hangtola-skill - 多模态夯到拉榜单 Skill 与离线编辑器
Agent Skills 开放规范 + 原生 HTML/CSS/JavaScript + Node.js CLI + Cloudflare Workers 静态资产

<directory>
skills/ - skills.sh 可发现的 Skill 集合；当前仅含 hangtola
scripts/ - 仓库级检查与站点组合工具，不进入 Skill 运行时工作流
site/ - npm run build 生成的部署产物，含站点专属外壳，永不手改且不入 Git
</directory>

<config>
skills/hangtola/SKILL.md - Skill 入口：多模态输入归一化、维度、调研、定档、呈现参数、生成与交付
skills/hangtola/assets/template.html - Skill 生成 HTML 的干净编辑器模板真相源，不含部署站点推广控件
skills/hangtola/package.json - 将公开 Skill 内 `.js` 显式限定为 ESM，隔离宿主或祖先目录的 Node 模块模式
skills/hangtola/scripts/render-board.js - RedSkill 兼容的渲染 CLI，校验榜单 JSON、嵌入本地图片并安全注入模板
scripts/build-site.mjs - 从干净模板组合 hangtola.app，注入 GitHub 图标与 Skill 复制入口
README.md - GitHub 与 skills.sh 用户入口、通用安装命令和开发说明
package.json - check/build/deploy 边界；build 经站点组合器生成 site/index.html
wrangler.toml - assets-only Worker「hangtola」与 hangtola.app 自定义域配置
.gitignore - 忽略 site、node_modules、Wrangler 缓存与系统文件
</config>

架构决策:
开放分发只认 `skills/hangtola/` 真相源；不维护私有 `.skill` 二进制副本，避免双重版本。
数据模型只保留 `text` 稳定名称与 `note` 内部依据；卡片只公开显示名字，图片和纯文字共享定档模型。
纯文字 `color` 由 AI 从受控调色板按语义选择；图片卡颜色固定为空，拒绝无效参数。
HTML 生成必须经过 render-board.js，禁止 Agent 手工拼 base64 或替换 JSON script。
公开 Skill 包禁止 `.mjs`；Skill 局部 package.json 固定 ESM 语义，仓库级构建与检查脚本仍可使用 `.mjs`。
批量图片异步压缩必须保持输入顺序；用户拖拽决定档位与档内次序。
大图榜单用 IndexedDB 自动保存，localStorage 只保留旧数据与能力降级回退。
模板离线自足，图片只能是本地路径或 data URL；部署外壳由根级脚本组合，禁止写回 Skill 模板。
导出画框按画布短边缩放；卡片按内容尺度铺满，档位文字从真实行高取 18% 并测量拟合，禁止再以画布宽度单独缩放。
维度与榜单记忆落在使用方项目 `.hangtola/`，不进入本仓库。

变更日志:
2026-08-03 - 迁移至 skills.sh 兼容目录；加入多图输入、纯文字智能配色、确定性渲染脚本与 IndexedDB。
2026-08-03 - 同步 minitool-build 通用改进：软键盘上浮、安全区、无刷新重置、满幅比例导出。
2026-08-03 - 产品化并部署 hangtola.app：透明 PNG、统一卡片框、深浅色与可编辑标题/声明。
2026-08-03 - 分离部署站点外壳：右上角 GitHub 图标与 Skill 复制仅注入 hangtola.app，Skill 模板保持干净。
2026-08-03 - Web 与 minitool 业务模型同构：移除短评字段，卡片只显示名字，三种导出比例共用单行名字槽位算法。
2026-08-03 - 公开 Skill 渲染器迁移为 RedSkill 白名单内的 `.js`，并用局部 package.json 显式固定 ESM。
2026-08-03 - 修复 3:4 导出光学比例：标签列内容驱动，档位文字随行高拟合，标题与声明按短边保持可读。

法则: 极简·稳定·导航·版本精确
