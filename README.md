# 夯到拉 Hangtola

> 万物皆可排：**夯 → 顶级 → 人上人 → NPC → 拉完了**

[![skills.sh](https://skills.sh/b/hiyeshu/hangtola-skill)](https://skills.sh/hiyeshu/hangtola-skill)

**[hangtola.app](https://hangtola.app)** — 打开就能用：输入主题、丢一批图，自有 Agent 识图、搜证据、定维度、排榜单；接着说"把 A 降到 NPC"继续改，拖拽精排，一键撤销。

Hangtola 同时是四样东西，共用一套领域规则：

| 入口 | 给谁用 |
|---|---|
| 网站 hangtola.app | 普通用户：统一输入 → 实时进度 → 可拖拽榜单 + 聊天改榜 |
| `$hangtola` Skill | Claude Code / Codex 等 Agent：在本机排完，产出独立 HTML |
| `hangtola` CLI | 终端与脚本：生成/修改/结构化操作/本地渲染 |
| Remote MCP `hangtola.app/mcp` | 外部 Agent：七个工具操作同一块榜单 |

## 核心设计

- **Agent 是入口，不是真相**：榜单事实 = `BoardDocument` + 不可变 Revision 链（每榜一个 Durable Object，SQLite 落盘）。任何修改（AI/网页/CLI/MCP）都编译为同一种 `BoardPatchV1`，经唯一写入路径提交；过期版本 409 冲突，绝不静默覆盖；撤销也是新版本，历史永不改写。
- **无捏造是代码强制的**：识图失败/低置信的图片押入备选区、名字只来自观察线索；搜索失败标"证据不足"——由 `enforceGrounding` 在代码层兜底，不依赖提示词。
- **匿名但有主**：公开 `viewUrl` 只见名称/图/档位；编辑密钥只在创建时出现一次（URL fragment 携带，服务端只存哈希），内部依据与对话仅编辑者可见。
- **离线永远可用**：单文件编辑器（零依赖、双击即跑）是构建产物持续交付；云端榜单可随时导出为离线 HTML 或 JSON。

## Agent Skill

```bash
npx skills add hiyeshu/hangtola-skill --skill hangtola
```

装进 Claude Code、Codex、Cursor 等 Agent 后，直接说「给 2026 的旗舰手机排个夯到拉」。维度与榜单记忆存于项目 `.hangtola/`；HTML 生成必须经 `skills/hangtola/scripts/render-board.js`（校验 schema、内嵌本地图片、安全注入），产物是一份能双击打开的独立文件。

## CLI

```bash
hangtola generate "2026 旗舰手机" --extra "红米K90、真我GT8" --image a.png --image b.png
hangtola revise <boardId> "把索尼升到 NPC，标题改成 XX"
hangtola get <boardId> [--full]
hangtola apply <boardId> patch.json     # 结构化修改；版本冲突打印最新文档，退出码 2
hangtola revert <boardId> <revisionId>
hangtola render board.json -o out.html  # 纯本地，不联网不经模型
hangtola export <boardId> -o out.html
```

editRef 自动存于 `~/.hangtola/boards.json`；`--base` 可指向任意部署。

## Remote MCP

端点 `https://hangtola.app/mcp`（streamable HTTP，无状态）。工具：`generate_board` / `revise_board` / `get_board` / `apply_board_patch` / `revert_board` / `prepare_asset_upload` / `export_board`。无 editRef 只能读公开投影。

## 仓库结构

```text
packages/domain/     # 四端共享领域真相：Zod schema、迁移桥、patch 应用器、无捏造强制
packages/cli/        # hangtola 命令行
workers/hangtola/    # Cloudflare Worker：HangtolaAgent DO + HTTP + MCP + 可恢复生成 Workflow + 托管页
apps/web/            # 前端源：离线编辑器五部件（template.html 是构建产物）+ 托管站点模块
skills/hangtola/     # 开放 Skill：SKILL.md + 模板 + render-board.js + domain 代码生成的校验镜像
docs/geb/CONTEXT.md  # 领域概念地图（Board/Revision/Patch/Evidence/Asset/EditCapability）
```

## 开发

```bash
npm install
npm run check    # codegen 新鲜度 + 模板零漂移 + 类型 + 测试 + Skill 契约门禁
npm run build    # 重组离线模板 + 产出托管页 + 注入站点外壳
npm run deploy   # 构建并部署 Cloudflare Worker（hangtola.app）
cd workers/hangtola && npx wrangler dev    # 本地全功能（MOCK_MODELS=1 确定性模型桩）
node workers/hangtola/test/smoke.mjs       # 25 项行为验收
```
