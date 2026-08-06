/**
 * [INPUT]: 依赖 cloudflare:workers 的 WorkflowEntrypoint、agents 的 getAgentByName、R2 资产、三个模型边界与 @hangtola/domain 的 enforceGrounding
 * [OUTPUT]: 对外提供 GenerateBoardWorkflow：parse → vision(每图一步) → curate(纯代码) → evidence(批次) → synthesize → commit 的可恢复生成管线
 * [POS]: 长任务的容错壳——步骤重试与断点续跑由平台保证；无捏造在 curate/enforceGrounding 代码层强制；进度经 DO 广播
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { getAgentByName } from 'agents';
import { enforceGrounding, type DraftShape } from '@hangtola/domain';
import type { Env } from '../env.js';
import { createVisionClient, type Observation } from '../models/vision.js';
import { createSearchClient } from '../models/exa.js';
import { createModelClient, type Candidate } from '../models/deepseek.js';

export interface GenerateParams {
  boardId: string;
  taskId: string;
  input: { topic: string; extraText?: string };
}

type ObsResult =
  | (Observation & { failed?: false; assetId: string; fileName: string })
  | { failed: true; assetId: string; fileName: string };

const RETRIES = { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' } } as const;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export class GenerateBoardWorkflow extends WorkflowEntrypoint<Env, GenerateParams> {
  override async run(event: WorkflowEvent<GenerateParams>, step: WorkflowStep): Promise<void> {
    const { boardId, taskId, input } = event.payload;
    const agent = await getAgentByName(this.env.HANGTOLA_AGENT, boardId);
    const progress = async (stage: string, pct: number) => {
      try { await agent.reportProgress(taskId, stage, pct); } catch { /* 进度尽力而为 */ }
    };

    try {
      await progress('整理输入', 5);
      const assets = await step.do('parse-input', async () => agent.listUploadedAssets());

      /* ---- 识图：每图一步，单图失败不倒全局 ---- */
      const observations: ObsResult[] = [];
      for (let i = 0; i < assets.length; i += 1) {
        const asset = assets[i]!;
        await progress(`识别图片 ${i + 1}/${assets.length}`, 10 + Math.round((25 * (i + 1)) / assets.length));
        try {
          const obs = await step.do(`vision-${i}`, RETRIES, async () => {
            const object = await this.env.ASSETS.get(asset.r2Key);
            if (!object) throw new Error(`asset ${asset.id} 不在 R2`);
            const dataUrl = `data:${asset.mime};base64,${toBase64(await object.arrayBuffer())}`;
            return createVisionClient(this.env).observe(dataUrl, asset.name);
          }) as Observation;
          observations.push({ ...obs, assetId: asset.id, fileName: asset.name });
        } catch {
          observations.push({ failed: true, assetId: asset.id, fileName: asset.name });
        }
      }

      /* ---- 汇总候选：纯代码，无捏造名单在此定型 ---- */
      await progress('汇总候选', 45);
      const curated = await step.do('curate', async () => {
        const forcePool: string[] = [];
        const imageByText: Record<string, string> = {};
        const candidates: Candidate[] = [];
        let unknownCount = 0;
        for (const obs of observations) {
          if (obs.failed || obs.confidence < 0.5 || obs.candidates.length === 0) {
            const clue = obs.failed ? '' : (obs.ocr[0] ?? obs.description);
            let name = clue.trim()
              ? `待确认：${clue.trim().slice(0, 12)}`
              : `未识别图片 ${(unknownCount += 1)}`;
            if (imageByText[name] !== undefined) {
              let suffix = 2;
              while (imageByText[`${name} ${suffix}`] !== undefined) suffix += 1;
              name = `${name} ${suffix}`;
            }
            forcePool.push(name);
            imageByText[name] = obs.assetId;
            candidates.push({
              text: name,
              note: obs.failed ? '识图失败' : `低置信：${obs.description}`,
              hasImage: true,
              evidence: 'insufficient',
            });
          } else {
            let name = obs.candidates[0]!.name;
            if (imageByText[name] !== undefined) {          // 同名图片各归其图，禁止后者覆盖前者
              let suffix = 2;
              while (imageByText[`${name} ${suffix}`] !== undefined) suffix += 1;
              name = `${name} ${suffix}`;
            }
            imageByText[name] = obs.assetId;
            candidates.push({ text: name, note: obs.description, hasImage: true, evidence: '' });
          }
        }
        for (const text of (input.extraText ?? '').split(/[,，、\n]+/).map((s) => s.trim()).filter(Boolean)) {
          if (!candidates.some((c) => c.text === text)) {
            candidates.push({ text, note: '', hasImage: false, evidence: '' });
          }
        }
        return { candidates, forcePool, imageByText };
      });

      let draft: DraftShape;
      if (curated.candidates.length === 0) {
        /* 纯主题：让模型自己找候选 */
        await progress('寻找候选', 60);
        draft = await step.do('draft', RETRIES, async () =>
          createModelClient(this.env).draftBoard(input)) as DraftShape;
      } else {
        /* ---- 证据：批次步；失败批 → insufficient，不臆造 ---- */
        const BATCH = 5;
        const enriched = [...curated.candidates];
        for (let start = 0; start < enriched.length; start += BATCH) {
          const batch = enriched.slice(start, start + BATCH);
          await progress(`查证据 ${Math.min(start + BATCH, enriched.length)}/${enriched.length}`, 55 + Math.round((20 * start) / enriched.length));
          try {
            const evidences = await step.do(`evidence-${start / BATCH}`, RETRIES, async () => {
              const search = createSearchClient(this.env);
              return Promise.all(batch.map((c) => search.research(`${input.topic} ${c.text}`)));
            });
            evidences.forEach((evidence, offset) => {
              const item = enriched[start + offset]!;
              if (item.evidence === 'insufficient') return;   // 识图阶段已定性
              item.evidence = evidence.status === 'supported'
                ? `supported: ${evidence.sources.map((s) => s.snippet).join(' / ').slice(0, 200)}`
                : 'insufficient';
            });
          } catch {
            batch.forEach((_, offset) => {
              const item = enriched[start + offset]!;
              if (item.evidence !== 'insufficient') item.evidence = 'insufficient';
            });
          }
        }

        /* ---- 合成定档 ---- */
        await progress('定档合成', 82);
        draft = await step.do('synthesize', RETRIES, async () =>
          createModelClient(this.env).synthesizeBoard({ topic: input.topic, candidates: enriched })) as DraftShape;

        /* 代码层兜底：模型丢弃/改名的候选补回 pool；强制名单押回 pool */
        const present = new Set([
          ...draft.tiers.flatMap((t) => t.items.map((i) => i.text)),
          ...draft.pool.map((i) => i.text),
        ]);
        for (const candidate of enriched) {
          if (!present.has(candidate.text)) {
            draft.pool.push({ text: candidate.text, note: candidate.note || '模型未定档，回收', color: null });
          }
        }
        draft = enforceGrounding(draft, new Set(curated.forcePool));
      }

      await progress('写入榜单', 95);
      await step.do('commit', async () => agent.commitGenerated(taskId, draft, curated.imageByText));
    } catch (error) {
      try { await agent.failTask(taskId, String(error)); } catch { /* 已尽力 */ }
      throw error;
    }
  }
}
