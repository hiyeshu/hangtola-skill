/**
 * [INPUT]: 依赖 Exa REST API（x-api-key）与全局 fetch
 * [OUTPUT]: 对外提供 createSearchClient：research(query) → EvidenceT（来源+摘要+support/insufficient）；MOCK 桩确定性产出
 * [POS]: workers/hangtola 的公开网络调研边界；无 key 或失败 → insufficient，由领域层保证不臆造
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { EvidenceT } from '@hangtola/domain';

export interface SearchEnv {
  MOCK_MODELS?: string;
  EXA_API_KEY?: string;
}

export interface SearchClient {
  research(query: string): Promise<EvidenceT>;
}

const insufficient = (claim: string): EvidenceT => ({
  claim, sources: [], status: 'insufficient', confidence: 0,
});

function realClient(apiKey: string): SearchClient {
  return {
    async research(query) {
      try {
        const response = await fetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            query, numResults: 3, type: 'auto',
            contents: { text: { maxCharacters: 400 } },
          }),
        });
        if (!response.ok) return insufficient(query);
        const data = await response.json() as { results?: { url: string; title?: string; text?: string; publishedDate?: string }[] };
        const sources = (data.results ?? [])
          .filter((r) => r.url)
          .map((r) => ({
            url: r.url,
            title: r.title ?? r.url,
            snippet: (r.text ?? '').slice(0, 300),
            ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}),
          }));
        if (sources.length === 0) return insufficient(query);
        return { claim: query, sources, status: 'supported', confidence: Math.min(1, sources.length / 3) };
      } catch {
        return insufficient(query);
      }
    },
  };
}

/** MOCK：名称含「冷门」→ insufficient，其余 supported（来源可溯到 example.com） */
function mockClient(): SearchClient {
  return {
    async research(query) {
      if (query.includes('冷门')) return insufficient(query);
      return {
        claim: query,
        sources: [{ url: `https://example.com/${encodeURIComponent(query)}`, title: `${query} 资料`, snippet: `mock 证据：${query}` }],
        status: 'supported',
        confidence: 0.67,
      };
    },
  };
}

export function createSearchClient(env: SearchEnv): SearchClient {
  if (env.MOCK_MODELS === '1' || !env.EXA_API_KEY) return mockClient();
  return realClient(env.EXA_API_KEY);
}
