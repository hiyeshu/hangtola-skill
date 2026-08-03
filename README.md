# 夯到拉 Hangtola

> 万物皆可排：**夯 → 顶级 → 人上人 → NPC → 拉完了**

[![skills.sh](https://skills.sh/b/hiyeshu/hangtola-skill)](https://skills.sh/hiyeshu/hangtola-skill)

在线编辑：[hangtola.app](https://hangtola.app)

Hangtola 是一个开放 Agent Skill，也是一份零依赖、离线可运行的单文件 tier list 编辑器。用户可以一次上传很多图片、为图片和纯文字条目填写名称，再让 AI 按自定义维度定档和排序。

## 安装 Skill

通过 [skills.sh](https://skills.sh/) 使用的开放 `skills` CLI 安装：

```bash
npx skills add hiyeshu/hangtola-skill --skill hangtola
```

CLI 会把同一份 Skill 安装到 Codex、Claude Code、Cursor、GitHub Copilot、Gemini CLI 等受支持 Agent。无需下载仓库内的私有打包格式。

安装后可以直接说：

```text
用 $hangtola 把我上传的这些图片和文字备注排成夯到拉。
```

## 能力

- **多图直传**：一次多选、拖入或粘贴；异步压缩后仍保持图片与说明的输入顺序。
- **混合条目**：图片、图片配文和纯文字走同一套定档规则。
- **只显示名字**：图片卡与纯文字卡只公开展示稳定名称；评价和取舍保存在内部依据中，不进入卡片与 PNG。
- **AI 呈现参数**：纯文字背景色由 AI 按语义从受控调色板选择，模板自动保证前景可读。
- **可视化精排**：拖拽跨档定档，也能在同档内调整先后；轻点卡片改名。
- **跨端同构**：Web 与 minitool 共用“方图 + 单行名字”槽位和 3:4、4:3、16:9 铺满算法；图片嵌入 HTML，不依赖外链。
- **大榜自动保存**：榜单写入 IndexedDB，避免多图轻易撞上 localStorage 容量上限。

## 仓库结构

```text
skills/
└── hangtola/
    ├── SKILL.md                  # Agent 工作流与数据契约
    ├── agents/openai.yaml        # Agent UI 元数据
    ├── assets/template.html      # 独立编辑器与部署真相源
    ├── references/input-contract.md
    └── scripts/render-board.mjs  # JSON + 本地图片 → 独立 HTML
scripts/check.mjs                 # 仓库质量门
scripts/build-site.mjs            # 组合部署外壳，不修改 Skill 模板
site/                             # 带站点专属入口的构建产物，不入 Git
```

`skills.sh` 会从 GitHub 仓库发现 `SKILL.md`。首次有人运行上面的安装命令后，安装遥测会让该 Skill 自动进入目录；单 Skill 仓库不需要额外的 `skills.sh.json` 分组配置。

## 开发

```bash
npm run check   # 校验 Skill 文件、资源引用和模板 JavaScript
npm run build   # 从干净 Skill 模板组合 site/index.html
npm run deploy  # 构建并部署 Cloudflare Worker 静态资产
```

手工生成一份榜单：

```bash
node skills/hangtola/scripts/render-board.mjs board.json output.html
```
