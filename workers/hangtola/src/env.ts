/**
 * [INPUT]: 依赖 @cloudflare/workers-types 的 DO/R2/Workflow 类型与各模型客户端的环境契约
 * [OUTPUT]: 对外提供 Worker Env 绑定契约（DO 命名空间 + R2 资产桶 + 生成 Workflow + 模型环境变量）
 * [POS]: workers/hangtola 的环境类型唯一出处，index / DO / workflow 共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { HangtolaAgent } from './agent/hangtola-agent.js';
import type { WorkerEnv } from './models/deepseek.js';
import type { VisionEnv } from './models/seed-vision.js';
import type { SearchEnv } from './models/exa.js';

export interface Env extends WorkerEnv, VisionEnv, SearchEnv {
  HANGTOLA_AGENT: DurableObjectNamespace<HangtolaAgent>;
  ASSETS: R2Bucket;
  STATIC: Fetcher;
  GEN_WORKFLOW: Workflow;
}
