/**
 * [INPUT]: 无依赖；数值全部由 Cloudflare Workers 运行时约束推导
 * [OUTPUT]: 对外提供 MAX_ASSET_BYTES / VISION_CONCURRENCY / MAX_PREPARE_FILES / VISION_TIMEOUT_MS / INGEST_TIMEOUT_MS / REVISE_TIMEOUT_MS
 * [POS]: workers/hangtola 的限额唯一真相源——index(入境闸)、ingest(网图闸)、workflow(识图闸)、agent(批量闸) 共用同一组常量，
 *        使 L1「改任一处须重算另一处」从注释约束升级为结构约束：推导写在此处一次，改这里即全线同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/* 识图并发闸：Workers 单次调用最多 6 条连接同时等响应头，第 7 条只排队不报错。
   实测阿里 MaaS 侧 12 路零限流——瓶颈在 Workers，不在模型。加大无收益。 */
export const VISION_CONCURRENCY = 6;

/* 资产体积闸：单图在 base64 识图链路上的内存峰值约为自身 4~5 倍
   （arrayBuffer + binary string + base64 + dataUrl）。
   128MB isolate ÷ VISION_CONCURRENCY ÷ 5 ≈ 4.3MB，取 6MB 留给 Web 端已压到 1280 的常规负载。
   三条入境路径（直传 PUT / 网图 from-url / 识图读取）必须同闸，否则闸门形同虚设。 */
export const MAX_ASSET_BYTES = 6 * 1024 * 1024;

/* 单次 prepare 的文件数上限：每个文件落一行 DO SQLite。
   无上限时一次调用即可灌入任意行数——闸设在 DO 内（权威处），路由层不重复校验。 */
export const MAX_PREPARE_FILES = 50;

/* 识图止损：实测单次 3.4~5.1s（并发 1~12），25s 之外视为慢调用，交还 step 退避重试 */
export const VISION_TIMEOUT_MS = 25_000;

/* 网图抓取止损：外部站点不可信，不给它拖住 Worker 的机会 */
export const INGEST_TIMEOUT_MS = 15_000;

/* 改榜止损：reviseOps 是唯一跑在 DO 交互路径上的模型调用（用户在 ws 那头等），
   且自带「失败重来一次」，故最坏挂起 = 2×此值。draft/synthesize 不用它——
   那两条在 Workflow step 内，退避与超时归 step 独家管辖，同 vision 的重试权原则。
   V4-Flash 关思考实测中位 1.07s、最坏 1.23s（n=3），15s 是留足十倍余量的慢调用线；
   一旦此值被频繁触发，说明 reviseOps 的思考开关被误打开，而非模型变慢。 */
export const REVISE_TIMEOUT_MS = 15_000;
