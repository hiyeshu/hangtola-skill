# hangtola/
> L2 | 父级: ../../CLAUDE.md

成员清单

SKILL.md: 开放 Agent Skill 入口，编排多模态归一化、必要调研、定档、AI 呈现参数和确定性交付。
package.json: Skill 局部 Node 模块边界，把 RedSkill 可接收的 `.js` 显式解释为 ESM，避免继承安装目录配置。
agents/: Agent UI 元数据；只描述展示名、短说明与默认调用提示，不承载工作流。
assets/: 输出资产边界；template.html 是编辑器和线上站点的共同真相源。
references/: 按需加载的领域契约；多模态配对、稳定名称、内部依据和纯文字配色与主流程分离。
scripts/: 确定性执行边界；使用 RedSkill 接收的 `.js`，把 schema 校验、离线图片嵌入和安全注入从 Agent 推理中拿走。

法则: 成员完整·一行一成员·依赖单向·资源按需加载
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
