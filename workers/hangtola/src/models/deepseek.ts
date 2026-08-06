/**
 * [INPUT]: 依赖 ai（generateObject）、@ai-sdk/openai-compatible（DeepSeek 端点）、@hangtola/domain 的 schema 与常量
 * [OUTPUT]: 对外提供 createModelClient：draftBoard（主题→旧形状草稿）与 reviseOps（自然语言→PatchOp[]，一次修复），及确定性 MOCK 桩
 * [POS]: workers/hangtola 的模型边界：DO 只面向此接口，真模型与桩可切换；无捏造由上层 domain 兜底
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { generateObject } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import {
  PatchOp,
  TIER_DEFS,
  TEXT_COLORS,
  type BoardDocumentV2T,
  type PatchOpT,
} from '@hangtola/domain';

export interface WorkerEnv {
  MOCK_MODELS?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
}

/** 模型产出的草稿采用旧形状（纯文字条目），由 domain 迁移层升 V2 */
export interface LegacyDraft {
  title: string;
  dimensions: { name: string; weight: number }[];
  tiers: { key: string; label?: string; items: { text: string; note: string; color: string | null }[] }[];
  pool: { text: string; note: string; color: string | null }[];
}

export interface ReviseResult {
  ok: boolean;
  ops: PatchOpT[];
  summary: string;
  reply: string;
}

/** 生成管线喂给合成步骤的候选（识图与文字来源已在工作流侧归一） */
export interface Candidate {
  text: string;
  note: string;
  hasImage: boolean;
  evidence: string;                 // 'supported' | 'insufficient' + 摘要拼接，供模型参考
}

export interface ModelClient {
  draftBoard(input: { topic: string; extraText?: string }): Promise<LegacyDraft>;
  synthesizeBoard(input: { topic: string; candidates: Candidate[] }): Promise<LegacyDraft>;
  reviseOps(doc: BoardDocumentV2T, instruction: string): Promise<ReviseResult>;
}

/* ============================================================
   结构化输出 schema（喂给 generateObject）
   ============================================================ */
const DraftSchema = z.object({
  title: z.string().describe('榜单标题，用户未要求时留空字符串'),
  dimensions: z.array(z.object({
    name: z.string(),
    weight: z.number().min(1).max(5),
  })).min(1).max(5),
  tiers: z.array(z.object({
    key: z.enum(['hang', 'top', 'upper', 'npc', 'la']),
    items: z.array(z.object({
      text: z.string().min(1).describe('稳定条目名称，公开显示'),
      note: z.string().describe('内部定档依据，不公开'),
      color: z.string().nullable().describe(`纯文字卡底色，仅可取 ${TEXT_COLORS.join('/')} 或 null`),
    })),
  })).length(5),
  pool: z.array(z.object({
    text: z.string().min(1),
    note: z.string(),
    color: z.string().nullable(),
  })).describe('证据不足或无法定档的候选'),
});

const ReviseSchema = z.object({
  ops: z.array(PatchOp).min(1),
  summary: z.string().describe('一句话变化摘要，中文'),
});

/* ============================================================
   真实客户端：DeepSeek via openai 兼容端点
   ============================================================ */
function realClient(env: WorkerEnv): ModelClient {
  const provider = createOpenAICompatible({
    name: 'deepseek',
    baseURL: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
    apiKey: env.DEEPSEEK_API_KEY ?? '',
  });
  const model = provider(env.DEEPSEEK_MODEL ?? 'deepseek-chat');

  return {
    async draftBoard({ topic, extraText }) {
      const { object } = await generateObject({
        model,
        schema: DraftSchema,
        prompt: [
          `你是"夯到拉"排行榜（中文梗版 tier list）的定档专家。五档从强到弱：夯（超神，稀缺≤20%）、顶级、人上人、NPC（平庸）、拉完了（有明确硬伤）。`,
          `主题：${topic}`,
          extraText ? `补充条目/线索：${extraText}` : '',
          `要求：给出 8~16 个真实存在的候选条目；先设计 3~5 个带权重的评价维度；再按加权判断定档。`,
          `note 写一句内部定档依据；把没把握的候选放 pool 并在 note 说明不确定性，严禁编造事实。`,
          `纯文字卡可按语义从受控调色板选 color，形不成稳定语义就用 null。`,
        ].filter(Boolean).join('\n'),
      });
      return object as LegacyDraft;
    },

    async synthesizeBoard({ topic, candidates }) {
      const { object } = await generateObject({
        model,
        schema: DraftSchema,
        prompt: [
          `你是"夯到拉"排行榜的定档专家。五档从强到弱：夯（超神，稀缺≤20%）、顶级、人上人、NPC（平庸）、拉完了（有明确硬伤）。`,
          `主题：${topic}`,
          `候选条目（含内部线索与证据状态，禁止新增或改名，逐一定档或放 pool）：`,
          JSON.stringify(candidates),
          `要求：先设计 3~5 个带权重的评价维度，再按加权判断把每个候选放入五档或 pool；`,
          `evidence 为 insufficient 的候选靠常识判断并在 note 注明证据不足；note 写一句内部定档依据；`,
          `纯文字候选（hasImage=false）可按语义选受控色，带图候选 color 一律 null。`,
        ].join('\n'),
      });
      return object as LegacyDraft;
    },

    async reviseOps(doc, instruction) {
      const prompt = (hint: string) => [
        `你在修改一块"夯到拉"榜单。当前文档（BoardDocumentV2）：`,
        JSON.stringify(doc),
        `用户指令：${instruction}`,
        `把指令编译为 BoardPatchV1 的 ops 数组（addItem/updateItem/moveItem/removeItem/setDimensions/setMeta），`,
        `itemId 必须来自当前文档，档位 key 只能是 hang/top/upper/npc/la/pool；moveItem 必须带 index。`,
        `summary 用一句中文概括改动。只做指令要求的事，不夹带私货。`,
        hint,
      ].filter(Boolean).join('\n');

      const attempt = async (hint = ''): Promise<ReviseResult> => {
        const { object } = await generateObject({ model, schema: ReviseSchema, prompt: prompt(hint) });
        return { ok: true, ops: object.ops, summary: object.summary, reply: object.summary };
      };
      try {
        return await attempt();
      } catch (first) {
        try {
          return await attempt(`上一次输出未通过校验：${String(first)}。请严格按 schema 重来。`);
        } catch {
          return { ok: false, ops: [], summary: '', reply: '这次指令我没能编译成合法修改，榜单保持原样。换个说法试试？' };
        }
      }
    },
  };
}

/* ============================================================
   确定性桩：MOCK_MODELS=1（开发/测试），行为可预言
   - draftBoard：主题按顿号/逗号拆条目，轮转分档
   - reviseOps：指令形如 MOCK:{...json ops...} 时原样返回；否则视为无法编译
   ============================================================ */
function mockClient(): ModelClient {
  return {
    async draftBoard({ topic, extraText }) {
      const names = (extraText || topic).split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
      const items = (names.length >= 2 ? names : [`${topic}甲`, `${topic}乙`, `${topic}丙`, `${topic}丁`])
        .map((text, i) => ({ text, note: `mock 依据 ${i + 1}`, color: null }));
      const tiers = TIER_DEFS.map((def) => ({ key: def.key, items: [] as LegacyDraft['pool'] }));
      items.forEach((item, i) => tiers[i % 4]!.items.push(item));   // 拉完了留空，验证空档合法
      return {
        title: '',
        dimensions: [{ name: '综合', weight: 3 }],
        tiers,
        pool: [{ text: `${topic}·待定`, note: '证据不足', color: null }],
      };
    },

    async synthesizeBoard({ candidates }) {
      const tiers = TIER_DEFS.map((def) => ({ key: def.key, items: [] as LegacyDraft['pool'] }));
      candidates.forEach((c, i) => {
        tiers[i % 4]!.items.push({ text: c.text, note: c.note || `mock 定档 ${i + 1}`, color: null });
      });
      return {
        title: '',
        dimensions: [{ name: '综合', weight: 3 }],
        tiers,
        pool: [],
      };
    },

    async reviseOps(_doc, instruction) {
      /* RANK_POOL 前缀 = 增量定档指令（真实模型当普通文本理解；桩确定性轮转入档） */
      const rank = instruction.match(/^RANK_POOL:(\[[\s\S]*?\])\n/);
      if (rank) {
        try {
          const targets = JSON.parse(rank[1]!) as { id: string; text: string }[];
          const keys = ['hang', 'top', 'upper', 'npc'] as const;
          const ops = targets.map((t, i) => PatchOp.parse({
            op: 'moveItem', itemId: t.id, to: { tier: keys[i % 4], index: 0 },
          }));
          const summary = `把 ${targets.length} 个备选排进榜单`;
          return { ok: true, ops, summary, reply: summary };
        } catch {
          return { ok: false, ops: [], summary: '', reply: '备选定档失败，条目保持在备选区。' };
        }
      }
      const match = instruction.match(/^MOCK:(.*)$/s);
      if (!match) {
        return { ok: false, ops: [], summary: '', reply: '这次指令我没能编译成合法修改，榜单保持原样。换个说法试试？' };
      }
      try {
        const parsed = JSON.parse(match[1]!) as { ops: unknown[]; summary?: string };
        const ops = parsed.ops.map((op) => PatchOp.parse(op));
        const summary = parsed.summary ?? 'mock 修改';
        return { ok: true, ops, summary, reply: summary };
      } catch {
        return { ok: false, ops: [], summary: '', reply: '这次指令我没能编译成合法修改，榜单保持原样。换个说法试试？' };
      }
    },
  };
}

export function createModelClient(env: WorkerEnv): ModelClient {
  if (env.MOCK_MODELS === '1' || !env.DEEPSEEK_API_KEY) return mockClient();
  return realClient(env);
}
