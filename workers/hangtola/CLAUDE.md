# workers/hangtola/
> L2 | 父级: ../../CLAUDE.md

Hangtola 自有 Agent 的运行时：每块榜单一个 Durable Object 实例，Agent 是能力入口而非数据真相——真相是 DO SQLite 里的不可变 revision 链，Agent State 只承载公开投影。

成员清单
wrangler.toml: Worker 配置真相源——DO SQLite 迁移（new_sqlite_classes）、nodejs_compat、MOCK_MODELS 开发默认；密钥经 .dev.vars（本地，git 忽略）与 wrangler secret（生产）注入，永不入库
src/index.ts: 唯一入口。Hono 路由零业务逻辑全部薄封装到 DO RPC；routeAgentRequest 先行接管 ws；X-Edit-Ref 头承载编辑能力；冲突 409、非法 422、越权 403 的映射只在这里
src/env.ts: Env 绑定契约（DO 命名空间 + 模型环境变量）唯一出处
src/agent/hangtola-agent.ts: DO 本体。#commit 是全部修改的唯一写入路径（校验 baseRevision → applyPatch → 写 revision → 广播）；revert 写新版本不改历史；chatRpc 模型编译失败零 revision；generateRpc 建任务并点火 Workflow；reportProgress/commitGenerated(幂等)/failTask 为 Workflow 回调面（仅 Worker 内 RPC 可达）；prepareAssets 发一次性上传令牌（哈希落盘）、verifyAssetUpload/markAssetUploaded/listUploadedAssets 守资产态；ws 帧 auth/patch/chat/revert/resync，未认证只收 State 同步；#authed 按连接 id 收窄广播
src/agent/sql.ts: 存储契约——meta/revisions/conversation/tasks/assets 建表 DDL 与行类型；assets 按 order_index 保上传序
src/models/deepseek.ts: DeepSeek 边界（draftBoard 纯主题 / synthesizeBoard 候选定档 / reviseOps NL→ops），结构化输出修复一次仍败即放弃；MOCK 桩确定性可预言
src/models/seed-vision.ts: Seed 2.0 Lite 识图边界（方舟 openai 兼容），observe(dataUrl)→结构化观察；MOCK 按文件名产出、unknown 前缀模拟失败
src/models/exa.ts: Exa 调研边界；无 key/失败一律 insufficient（降级不臆造）；MOCK 名称含「冷门」触发 insufficient
src/workflows/generate-board.ts: 可恢复生成管线 parse→vision每图一步→curate纯代码→evidence批次→synthesize→commit；单图失败不倒全局；候选丢失代码补回 pool；enforceGrounding 押回强制名单；commit 幂等防重放
test/smoke.mjs: P2+P3 验收执行器——25 项行为断言（隐私投影/409/零revision/历史链/403/资产令牌/上传序/强制入pool/读透）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
