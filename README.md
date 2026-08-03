# 夯到拉 Hangtola

> 万物皆可排：**夯 → 顶级 → 人上人 → NPC → 拉完了**

在线使用：**[hangtola.app](https://hangtola.app)**

夯到拉是中文互联网的 tier list——给手机、游戏、奶茶、同事的代码……任何东西定档。
整个产品是**一个 HTML 文件**：零依赖、离线可用、双击即跑、发给谁都能打开。

## 特性

- **五档定档**：拖拽卡片入档；轻点 / 长按 / 右键卡片打开操作单（定档色块、改名、删除）
- **图片 + 文字混排**：上传或直接粘贴图片（保留原始比例压缩）；文字卡字号随字数自适应，可选 iOS 系统色底
- **统一卡片框**：图片卡（图上名下）与文字卡同框同高，混排严格对齐
- **深浅色模式**：☾/☀ 一键切换，导出跟随
- **干净导出**：透明底 PNG，3:4 / 4:3 / 16:9 三比例，无水印；标题可留空出纯网格
- **可编辑一切**：标题、档位名、底部声明条都能直接点击修改
- **自动保存**：改动留在本地浏览器；导出 / 导入 JSON 随时迁移

## AI Skill（Claude Code）

本仓库同时是一个 [Claude Code](https://claude.com/claude-code) 技能：AI 主动搜索条目资料、
和你确认排序维度、打分定档，生成注入好数据的 HTML 供你继续手调。

安装：把 [`hangtola/`](hangtola/) 目录放进 `~/.claude/skills/`，或直接使用
[`dist/hangtola.skill`](dist/hangtola.skill) 分发包。

对 AI 说「给 2026 的旗舰手机排个夯到拉」即可触发。维度与榜单数据会持久化在你项目的
`.hangtola/` 目录，下次续榜自动复用；在网页里改完的榜单「导出数据」交回 AI 也能接着排。

## 结构

```
hangtola/            # 技能真相源
├── SKILL.md         # AI 工作流：记忆 → 条目 → 维度 → 调研 → 定档 → 生成 → 写忆 → 交付
└── assets/
    └── template.html  # 唯一模板 = hangtola.app 部署的页面本体
dist/hangtola.skill  # 技能分发包
```

## 开发与部署

```bash
npm run build    # 复制模板到 site/index.html
npm run deploy   # 构建并部署到 Cloudflare Pages
```
