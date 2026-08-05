# workers/hangtola/
> L2 | 父级: ../../CLAUDE.md

Hangtola 自有 Agent 的运行时：每块榜单一个 Durable Object 实例，Agent 是能力入口而非数据真相——真相是 DO SQLite 里的不可变 revision 链，Agent State 只承载公开投影。

成员清单
wrangler.toml: Worker 配置真相源——DO SQLite 迁移（new_sqlite_classes）、nodejs_compat、MOCK_MODELS 开发默认；密钥经 .dev.vars（本地，git 忽略）与 wrangler secret（生产）注入，永不入库
src/index.ts: 唯一入口。Hono 路由零业务逻辑全部薄封装到 DO RPC；routeAgentRequest 先行接管 ws；X-Edit-Ref 头承载编辑能力；冲突 409、非法 422、越权 403 的映射只在这里
src/env.ts: Env 绑定契约（DO 命名空间 + 模型环境变量）唯一出处
src/agent/hangtola-agent.ts: DO 本体。#commit 是全部修改的唯一写入路径（校验 baseRevision → applyPatch → 写 revision → 广播）；revert 写新版本不改历史；chatRpc 模型编译失败零 revision；generateRpc P2 为内联分阶段执行（P3 迁 Workflow）；ws 帧 auth/patch/chat/revert/resync，未认证只收 State 同步；#authed 按连接 id 收窄广播
src/agent/sql.ts: 存储契约——meta/revisions/conversation/tasks 建表 DDL 与行类型（assets 表 P3 加入）
src/models/deepseek.ts: 模型边界。DeepSeek via openai 兼容端点 + generateObject 结构化输出，修复一次仍败即放弃；MOCK_MODELS=1 时换确定性桩（MOCK:{ops} 指令原样编译，其余婉拒），让验收不依赖网络与模型
test/smoke.mjs: P2 验收执行器——十项行为断言（隐私投影遍历/409/零revision/历史链/403）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
