# workers/hangtola/
> L2 | 父级: ../../CLAUDE.md

Hangtola 自有 Agent 的运行时：每块榜单一个 Durable Object 实例，Agent 是能力入口而非数据真相——真相是 DO SQLite 里的不可变 revision 链，Agent State 只承载公开投影。

成员清单
wrangler.toml: Worker 配置真相源——DO SQLite 迁移（new_sqlite_classes）、nodejs_compat、MOCK_MODELS 开发默认；密钥经 .dev.vars（本地，git 忽略）与 wrangler secret（生产）注入，永不入库
src/index.ts: 唯一入口。Hono 路由零业务逻辑全部薄封装到 DO RPC；routeAgentRequest 先行接管 ws；X-Edit-Ref 头承载编辑能力；冲突 409、非法 422、越权 403 的映射只在这里；/b/:id 服务托管榜单壳、/api/boards/:id/export 出 JSON 或离线单文件（注入转义与 render-board 同构）；静态资产经 [assets] STATIC 绑定（public/ 由 apps/web 构建产出）；三档成本限流按 cf-connecting-ip 设在成本发生处（建榜 RL_BOARD / 生成聊天 RL_MODEL / 资产三口 RL_ASSET），取不到 IP 退回共享严桶而非放行；上传口 Content-Length 先挡后读、读后二次校验（声明可伪造，全量入内存则 isolate 已受害）
src/env.ts: Env 绑定契约（DO 命名空间 + R2 + Workflow + 三档限流器 + 模型环境变量）唯一出处
src/limits.ts: 限额唯一真相源。MAX_ASSET_BYTES/VISION_CONCURRENCY/MAX_PREPARE_FILES 与三个超时的推导过程写在此处一次；index(入境闸)/ingest(网图闸)/workflow(识图闸)/agent(批量闸) 共用，使 L1「改任一处须重算另一处」从注释约束升级为结构约束。前两个超时由 Workers 运行时约束推导，REVISE_TIMEOUT_MS 例外——它由实测延迟定的产品耐心线，专守 DO 交互路径
src/agent/hangtola-agent.ts:（含 #rankPool 增量定档：备选区条目补识图/补证据→RANK_POOL 指令→白名单 move/update→commit） DO 本体。#commit 是全部修改的唯一写入路径（校验 baseRevision → applyPatch → 写 revision → 广播）；revert 写新版本不改历史；chatRpc 模型编译失败零 revision；generateRpc 建任务并点火 Workflow；reportProgress/commitGenerated(幂等)/failTask 为 Workflow 回调面（仅 Worker 内 RPC 可达）；prepareAssets 发一次性上传令牌（哈希落盘，单次受 MAX_PREPARE_FILES 截断——批量闸设在 DO 内因其为资产态唯一权威，HTTP 与 MCP 两路必经）、verifyAssetUpload/markAssetUploaded/listUploadedAssets 守资产态；ws 帧 auth/patch/chat/revert/resync，未认证只收 State 同步；鉴权态存 connection state（跨 DO 休眠持久），广播按连接态收窄
src/agent/sql.ts: 存储契约——meta/revisions/conversation/tasks/assets 建表 DDL 与行类型；assets 按 order_index 保上传序
src/models/deepseek.ts: DeepSeek 边界（draftBoard 纯主题 / synthesizeBoard 候选定档 / reviseOps NL→ops），结构化输出修复一次仍败即放弃；MOCK 桩确定性可预言。模型 deepseek-v4-flash——旧别名 deepseek-chat 2026-07-24 停用，它指向的正是本模型的非思考模式，故迁移行为等价。三条链路显式关思考，与 vision.ts 同范式：实测定档 3.5s→43s、改榜 1.07s→14s 而 JSON 通过率不变，reasoning_effort 的 low 档反比 high 慢故不采信该维度；定档质量由 workflow 侧 enforceGrounding 与 pool 回收兜底，不押注模型独自沉思。仅 reviseOps 带 REVISE_TIMEOUT_MS 止损——它是唯一跑在 DO 交互路径上的模型调用，draft/synthesize 的超时权归 Workflow step 独家管辖
src/models/vision.ts: 通用视觉边界（VISION_* 三变量可换供应商，现 Qwen3.7-Flash @ 阿里 MaaS，json 模式+关思考），observe(dataUrl)→结构化观察；单次实测 3.4~5.1s 故设 25s abortSignal 止损；maxRetries=0 把重试权全交 Workflow step，杜绝 SDK×step 双层退避相乘（否则单图最坏 9 次调用）；MOCK 按文件名产出、unknown 前缀模拟失败
src/models/exa.ts: Exa 调研边界；无 key/失败一律 insufficient（降级不臆造）；MOCK 名称含「冷门」触发 insufficient
src/workflows/generate-board.ts: 可恢复生成管线 parse→vision每图一步→curate纯代码→evidence批次→synthesize→commit；识图 6 路并发（= Workers 同时等响应头的连接上限，非经验值），步名按资产下标固定保重放缓存确定性，结果按下标回填与 order_index 严格同构；体积闸取自 limits 的 MAX_ASSET_BYTES（与入境两口同闸，否则闸门形同虚设）；单图失败不倒全局；候选丢失代码补回 pool；enforceGrounding 押回强制名单；commit 幂等防重放
src/http/ingest.ts: 网图入境执行器（URL 是来源不是存储）：抓取校验转 R2 资产，HTTP 路由与 MCP 工具共用。全仓唯一「服务器替调用方发请求」的出口，故 SSRF 与体积责任在此收口：https 单轨、私网字面量拒斥（域名解析后的私网挡不住，不自称完备）、Content-Length 先挡后读再二次校验
src/mcp/tools.ts: Remote MCP（无状态 streamable-HTTP JSON-RPC）：七工具全部薄封装 DO RPC，零会话零独立逻辑；无 editRef 只见公开投影
test/smoke.mjs: P2+P3 验收执行器——25 项行为断言（隐私投影/409/零revision/历史链/403/资产令牌/上传序/强制入pool/读透）
test/cost-gates.mjs: 滥用防线回归执行器——12 项拒绝断言（prepare 截断/体积双闸含分块补位/from-url 七类拒斥/建榜 429）。与 smoke 分离因其验的是「拒绝」而非「功能」；闸值可调，闸的存在不可调，无此测试则闸会被后人静默删除

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
