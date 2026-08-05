/**
 * [INPUT]: 依赖 @cloudflare/workers-types 的 DO 命名空间类型与 ./agent/hangtola-agent 的类
 * [OUTPUT]: 对外提供 Worker Env 绑定契约（DO 命名空间 + 模型环境变量）
 * [POS]: workers/hangtola 的环境类型唯一出处，index 与 DO 共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { HangtolaAgent } from './agent/hangtola-agent.js';
import type { WorkerEnv } from './models/deepseek.js';

export interface Env extends WorkerEnv {
  HANGTOLA_AGENT: DurableObjectNamespace<HangtolaAgent>;
}
