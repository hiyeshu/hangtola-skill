# scripts/
> L2 | 父级: ../CLAUDE.md

成员清单

build-site.mjs: 部署适配器。驱动 apps/web 双目标构建，再向 workers/hangtola/public 的两张托管页注入站点外壳（GitHub 图标 + Skill 复制）——榜单页是被生成、被分享、被围观的那一页，回流入口必须在场；AI 输入条与升舱脚本只进单机首页，榜单页自带云端 ai-bar。外壳永不写回 Skill 模板与离线产物。
check.mjs: 仓库级零依赖质量门，验证 Skill 结构、RedSkill 扩展名与局部 ESM 边界、单名称 schema、费曼文案面板、三种导出画幅的光学比例、模板 JavaScript 语法与部署外壳隔离。

此目录只负责仓库维护，不进入安装后的 Skill 工作流。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
