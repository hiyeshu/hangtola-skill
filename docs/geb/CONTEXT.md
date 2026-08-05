# Hangtola 领域概念地图（CONTEXT）
> GEB 语义相总图 | 父级: ../../CLAUDE.md

The map IS the terrain. 本文回答"实体是什么、为何存在、与谁协作"——字段清单看 packages/domain/src/schema.ts，这里只写不变式。

## 六个实体

**Board（榜单文档，BoardDocumentV2）**
榜单事实的唯一形态。五档固定 key/color（label 可改）、条目带稳定 id、note/evidence 为内部字段。
不变式：真相永远是文档本身，不是模型上下文、不是聊天记录、不是任何端的界面状态。
云端文档中图片只能是 asset 引用（写入路径拒绝 dataurl）——revision 体积因此恒为 KB 级。

**Revision（版本）**
不可变、只追加的链。每次修改（无论来自 agent/web/cli/mcp）产生一个新节点，携带完整文档快照。
不变式：历史永不改写——撤销（revert）也是链上的新节点；rev_ id 前缀按时间可排序。

**Patch（修改语言，BoardPatchV1）**
四端唯一的修改表达：六种 op + baseRevision 前置条件 + 人话 summary。
不变式：apply 是纯函数、单 op 失败即整体失败；baseRevision ≠ head 一律 409 + 最新文档，绝不静默覆盖；
一切写入都经 DO 的 commitPatch 单一路径——没有第二条路。

**Evidence（证据）**
调研结论的内部记账：claim + 来源 + supported/insufficient。
不变式：证据只影响定档与 note，永不进入公开投影或导出图；搜索失败 = insufficient，不是编造。
无捏造由代码强制（enforceGrounding 押回 pool），提示词只是辅助。

**Asset（资产）**
用户图片的 R2 实体。DO 发一次性上传令牌（哈希落盘），Worker 中转写入，公开读透。
不变式：order_index 保上传序——顺序是输入配对信息，不是排名。

**EditCapability（编辑能力）**
匿名世界的所有权：128-bit 密钥只在创建时出现一次，服务端只存 SHA-256。
不变式：URL fragment 携带（不经服务器日志）；ws 首帧认证且状态存 connection state（跨 DO 休眠）；
公开 viewUrl 只能看到 toPublicView 的投影——名称/图/档位/展示色，仅此而已。

## 协作关系

```
用户/外部Agent ──HTTP/ws/MCP/CLI──▶ Worker(路由零逻辑) ──RPC──▶ HangtolaAgent DO(每榜一实例)
                                                              │  commitPatch 唯一写入 ─▶ Revision 链(SQLite)
                                                              │  Agent State ─▶ 公开投影广播
生成 ──▶ GenerateBoardWorkflow(可恢复) ──vision/evidence/synthesize──▶ commitGenerated(幂等)
离线世界：skills/hangtola（template.html 构建产物 + render-board.js）与云端共用 domain 经 codegen 镜像
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
