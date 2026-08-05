# packages/domain/
> L2 | 父级: ../../CLAUDE.md

四端（Skill/网页/CLI/MCP）共享的唯一领域真相：类型宪法、修改语言与版本边界都只在这里定义，任何一端不得私设规则。

成员清单
src/ids.ts: 标识工厂，itm_/ast_/brd_ 随机 base36，rev_ 前 9 位时间戳 base36 可排序；editKey 128-bit base64url 且只以 SHA-256 哈希落盘
src/rank.ts: 五档 TIER_DEFS 与受控调色板 TEXT_COLORS 的唯一出处，cleanText/clampWeight 归一化原语与 render-board 同构
src/schema.ts: Zod 类型宪法——BoardDocumentV2（五档定序、图片卡禁底色、text/image 至少其一）、BoardPatchV1 六种 op、Revision（含 revert-as-new-revision）、Evidence/VisionObservation 内部字段、EditCapability
src/migrate.ts: 版本三桥——migrateLegacyToV2（宽松进严格出，未内嵌图片拒入云端）、toLegacyBoard（喂 template/render-board 的唯一出口）、toPublicView（viewUrl 可见的一切：名称/图/档位/展示色，note/evidence/dimensions 不可达）
src/patch.ts: applyPatch 纯函数与类型化 PatchError；单 op 失败即整体失败，索引越界钳制，换图未清色自动归 null；baseRevision 冲突检测归 DO
src/index.ts: 包唯一出口
scripts/emit-skill-validator.ts: 单向代码生成桥，从 rank 常量产出 skills/hangtola/scripts/board-validate.gen.js（零依赖纯 JS），--check 校验新鲜度
test/migrate.test.ts: 迁移回环、隐私投影禁字段遍历、domain ↔ 生成校验器交叉一致性
test/patch.test.ts: 修改语言行为契约（合法链路/纯函数/类型化拒绝/钳制）
test/fixtures/: 金样输入（board.v1.json 覆盖幽灵档/非法色/权重钳制边界 + red.png）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
