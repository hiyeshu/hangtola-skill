# scripts/
> L2 | 父级: ../CLAUDE.md

成员清单

build-site.mjs: 部署站点组合器，从干净 Skill 模板生成 site/index.html，并注入仅属于 hangtola.app 的 GitHub 图标与 Skill 复制入口。
check.mjs: 仓库级零依赖质量门，验证 Skill 结构、RedSkill 扩展名与局部 ESM 边界、单名称 schema、三种导出画幅的光学比例、关键资源引用、模板 JavaScript 语法与部署外壳隔离。

此目录只负责仓库维护，不进入安装后的 Skill 工作流。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
