/**
 * [INPUT]: 依赖 ai（generateObject）与 @ai-sdk/openai-compatible（任意 openai 兼容视觉端点，当前阿里 MaaS Qwen 3.7 Flash）
 * [OUTPUT]: 对外提供 createVisionClient：observe(dataUrl, hint) → 结构化识图；MOCK 桩按文件名确定性产出/失败
 * [POS]: workers/hangtola 的识图边界，供应商可换（VISION_* 三变量）；失败由上层降级（入 pool），不臆造
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { generateObject } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

export interface VisionEnv {
  MOCK_MODELS?: string;
  VISION_API_KEY?: string;
  VISION_BASE_URL?: string;
  VISION_MODEL?: string;
}

const ObservationSchema = z.object({
  candidates: z.array(z.object({ name: z.string(), confidence: z.number().min(0).max(1) })).max(5),
  description: z.string(),
  ocr: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string()),
});
export type Observation = z.infer<typeof ObservationSchema>;

export interface VisionClient {
  observe(imageDataUrl: string, hint: string): Promise<Observation>;
}

function realClient(env: VisionEnv): VisionClient {
  const provider = createOpenAICompatible({
    name: 'vision',
    baseURL: env.VISION_BASE_URL ?? '',
    apiKey: env.VISION_API_KEY ?? '',
  });
  const model = provider(env.VISION_MODEL ?? 'qwen3.7-flash');
  return {
    async observe(imageDataUrl, hint) {
      const { object } = await generateObject({
        model,
        mode: 'json',
        providerOptions: { vision: { enable_thinking: false } },
        schema: ObservationSchema,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', image: imageDataUrl },
            {
              type: 'text',
              text: [
                '识别这张图的主体，给出候选名称（最多 5 个，带 0~1 置信度）、一句话画面描述、图内文字（OCR）、总体置信度与不确定项。',
                '只报告看得到与认得出的，认不出就用低置信度与 uncertainties 说明，严禁编造。',
                hint ? `上下文提示：${hint}` : '',
              ].filter(Boolean).join('\n'),
            },
          ],
        }],
      });
      return object;
    },
  };
}

/** MOCK：文件名主干即候选名；文件名含 unknown/未知 → 低置信失败形态 */
function mockClient(): VisionClient {
  return {
    async observe(_imageDataUrl, hint) {
      const stem = hint.replace(/\.[^.]+$/, '').trim() || '未知主体';
      if (/unknown|未知/i.test(stem)) {
        return {
          candidates: [], description: '无法辨认的画面', ocr: [],
          confidence: 0.1, uncertainties: ['主体不可辨认'],
        };
      }
      return {
        candidates: [{ name: stem, confidence: 0.92 }],
        description: `mock 识别：${stem}`, ocr: [stem],
        confidence: 0.92, uncertainties: [],
      };
    },
  };
}

export function createVisionClient(env: VisionEnv): VisionClient {
  if (env.MOCK_MODELS === '1' || !env.VISION_API_KEY || !env.VISION_BASE_URL) return mockClient();
  return realClient(env);
}
