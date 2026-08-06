/**
 * [INPUT]: 依赖 @cloudflare/workers-types 的 DO/R2/Workflow/RateLimit 类型与各模型客户端的环境契约
 * [OUTPUT]: 对外提供 Worker Env 绑定契约（DO 命名空间 + R2 资产桶 + 生成 Workflow + 三档限流器 + 模型环境变量）
 * [POS]: workers/hangtola 的环境类型唯一出处，index / DO / workflow 共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { HangtolaAgent } from './agent/hangtola-agent.js';
import type { WorkerEnv } from './models/deepseek.js';
import type { VisionEnv } from './models/vision.js';
import type { SearchEnv } from './models/exa.js';

export interface Env extends WorkerEnv, VisionEnv, SearchEnv {
  HANGTOLA_AGENT: DurableObjectNamespace<HangtolaAgent>;
  ASSETS: R2Bucket;
  STATIC: Fetcher;
  GEN_WORKFLOW: Workflow;
  /* 三档限流按成本量级分类而非按端点分类：建榜造 DO 实例、模型烧真金、资产吃存储，
     三者单位成本相差两个数量级，同闸必然要么挡不住贵的、要么误伤便宜的 */
  RL_BOARD: RateLimit;
  RL_MODEL: RateLimit;
  RL_ASSET: RateLimit;
}
