---
name: hangtola
description: >
  Turn batches of uploaded images, image-plus-text notes, plain-text items, or mixed inputs into a researched and editable Chinese meme tier list with five ranks: 夯 / 顶级 / 人上人 / NPC / 拉完了. Use when the user mentions “夯到拉”, “夯榜”, “tier list”, “排行榜”, “排个档”, asks to rank a set of items, or uploads many images and wants them identified, named, ordered, and exported as a standalone HTML or PNG board.
---

# Hangtola 夯到拉

把用户给出的图片和文字整理为有依据、有态度、可继续编辑的五档榜单，并交付独立 HTML。

## 核心原则

- 接受图片、图片配文、纯文字或三者混合输入，不要求用户先整理成表格。
- 把附件顺序当作输入顺序，不当作排名；先保持图片与说明的配对，再按维度定档。
- 把 `text` 与 `note` 分开：名称是卡片唯一公开文案，依据只用于内部记忆。
- 让 AI 根据语义填写合理参数；不要把所有可选字段机械地留空。
- 只在缺少的信息会实质改变定档时提问。能够从图片、文件名、上下文或调研判断时直接完成。

处理多图、混合输入或智能配色时，先读 [references/input-contract.md](references/input-contract.md)。

## 工作流

### 1. 读取历史

在当前工作目录查找 `.hangtola/`：

```text
.hangtola/
├── dimensions.json
└── boards/<slug>.json
```

- 同主题历史存在时，复用已确认的维度和稳定条目名；用户明确要求重排时再覆盖。
- 用户提供从网页导出的 JSON 时，把它视为最新真相。

### 2. 归一化输入

按消息中的附件和文字顺序建立临时清单，给每项分配稳定编号。逐项得到：

- `text`：稳定、可识别的条目名称。
- `image`：本地图片路径或 `data:` URL；没有图片时为 `null`。
- `note`：定档依据和不确定性，仅写入数据，不显示在导出图。
- `color`：纯文字卡背景色。根据语义从受控调色板选择；图片卡必须为 `null`。

用户给出“图片 1 是 A、图片 2 是 B”或逐图备注时，严格保持对应关系。无法可靠识别且会影响排名时，只集中询问未识别项。

### 3. 确认维度

- 用户已给排序标准时直接采用。
- 否则根据主题提出 3–5 个维度及 1–5 权重；历史中有同主题维度时优先复用。
- 用户只想按主观感觉排时，允许使用一个明确命名的主维度，不制造伪精确。

### 4. 必要调研

- 用户给定的图片和说明足够时，不为“显得认真”而搜索。
- 事实会影响定档时，使用可用的网络搜索工具核对参数、口碑或背景。
- 把证据摘要写入 `note`，不要把研究结论混进公开名称。

### 5. 定档与排序

- 每维度按 0–10 分乘权重，使用加权结果辅助定档。
- “夯”保持稀缺，通常不超过 20%；“拉完了”必须有明确硬伤；允许空档。
- 同档内从强到弱排列。附件原顺序只用于保证输入配对，不覆盖判断结果。
- 在对话中给出文字版榜单和每项一句理由；用户明确要求直接出榜时可省略确认。

### 6. 填写呈现参数

- 图片卡和纯文字卡都只公开显示 `text`；名称保持稳定可识别，不追加评价文案。
- 纯文字卡 `color` 按语义选择，颜色只承担补充表达，不重复档位含义。无法形成稳定语义时用 `null`。
- `title` 和 `footnote` 默认留空；只有用户明确要求才显示。
- 五档 `key` 和 `color` 固定，`label` 可编辑。

### 7. 生成 HTML

先把榜单数据写成 JSON，再运行技能自带脚本：

```bash
node <skill-directory>/scripts/render-board.js board.json 夯到拉-主题.html
```

脚本会校验 schema、把本地图片嵌入为 `data:` URL，并安全注入 `assets/template.html`。不要手工拼接 base64 或替换 `<script>`。

### 8. 保存与交付

- 合并维度到 `.hangtola/dimensions.json`，按主题保存更新时间。
- 保存最终数据到 `.hangtola/boards/<slug>.json`，同一榜单迭代时保持 `id` 不变并刷新 `savedAt`。
- 在浏览器中打开 HTML，确认图片、名称、纯文字颜色、档内顺序和三种导出比例均正常。
- 告知用户可拖拽精排、轻点卡片改名、批量上传或粘贴图片、导出 PNG/JSON。

## 数据契约

```json
{
  "id": "phones-2026",
  "title": "",
  "footnote": "",
  "savedAt": "2026-08-03T12:00:00.000Z",
  "dimensions": [{ "name": "性能", "weight": 3 }],
  "tiers": [
    {
      "key": "hang",
      "label": "夯",
      "color": "#fb2018",
      "items": [
        {
          "text": "示例条目",
          "image": "/absolute/path/to/example.jpg",
          "note": "内部定档依据，不公开显示",
          "color": null
        }
      ]
    },
    { "key": "top", "label": "顶级", "color": "#ffa640", "items": [] },
    { "key": "upper", "label": "人上人", "color": "#fbf600", "items": [] },
    { "key": "npc", "label": "NPC", "color": "#fdf1c7", "items": [] },
    { "key": "la", "label": "拉完了", "color": "#ffffff", "items": [] }
  ],
  "pool": [
    { "text": "纯文字候选", "image": null, "note": "", "color": "#0a84ff" }
  ]
}
```

`image` 只允许本地路径或 `data:` URL，禁止外链。`pool` 保存未定档项，不进入导出图。
