/**
 * [INPUT]: 依赖运行中的 wrangler dev（MOCK_MODELS=1）与 Node 18+ fetch
 * [OUTPUT]: 对外提供 P2 验收冒烟：建榜/生成/隐私投影/NL修改/409冲突/revert链/胡话零revision/403
 * [POS]: workers/hangtola 的行为验收执行器，用确定性模型桩钉住 Agent 核心语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
let failures = 0;

function check(name, condition, detail = '') {
  const mark = condition ? '✓' : '✗';
  if (!condition) failures += 1;
  console.log(`${mark} ${name}${condition ? '' : `  ← ${detail}`}`);
}

const json = (res) => res.json();
const api = (path, options = {}) => fetch(`${BASE}${path}`, {
  ...options,
  headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
});

/* 1. 建榜 */
const created = await json(await api('/api/boards', { method: 'POST' }));
check('建榜返回 boardId + editRef + 双链接',
  !!created.boardId && !!created.editRef && created.editUrl.includes('#k='), JSON.stringify(created));
const { boardId, editRef } = created;
const auth = { 'X-Edit-Ref': editRef };

/* 2. 主题生成（Workflow 异步：轮询公开状态至 done） */
async function waitGeneration(id, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await json(await api(`/api/boards/${id}`));
    if (snapshot.generation.status === 'done') return snapshot;
    if (snapshot.generation.status === 'failed') throw new Error(`生成失败: ${snapshot.generation.detail}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('生成超时');
}
const gen = await json(await api(`/api/boards/${boardId}/generate`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ topic: '旗舰手机', extraText: '小米17、iPhone 17、三星S26、一加14、努比亚Z70' }),
}));
check('生成任务受理', gen.ok === true && !!gen.taskId, JSON.stringify(gen));
await waitGeneration(boardId);
check('Workflow 生成完成', true);

/* 3. 公开投影：无私有字段 */
const pub = await json(await api(`/api/boards/${boardId}`));
const banned = ['note', 'evidence', 'dimensions'];
let leaked = null;
(function walk(value) {
  if (Array.isArray(value)) return value.forEach(walk);
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (banned.includes(k)) leaked = k;
      walk(v);
    }
  }
})(pub);
check('公开投影不含 note/evidence/dimensions', leaked === null, `泄露字段 ${leaked}`);
check('公开投影包含条目', pub.publicDoc.tiers.some((t) => t.items.length > 0));

/* 4. 完整文档（编辑者可见内部依据） */
const full = await json(await api(`/api/boards/${boardId}/full`, { headers: auth }));
check('full 返回 head 与内部 note', full.ok && full.doc.tiers[0].items[0].note.length > 0);
const itemA = full.doc.tiers[0].items[0];

/* 5. NL 修改（mock 指令 → moveItem 到拉完了） */
const chat = await json(await api(`/api/boards/${boardId}/chat`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ message: `MOCK:{"ops":[{"op":"moveItem","itemId":"${itemA.id}","to":{"tier":"la","index":0}}],"summary":"把${itemA.text}贬到拉完了"}` }),
}));
check('NL 修改产出 revision + 摘要', !!chat.revisionId && chat.summary.includes(itemA.text), JSON.stringify(chat));
const afterChat = await json(await api(`/api/boards/${boardId}/full`, { headers: auth }));
check('moveItem 生效', afterChat.doc.tiers[4].items[0]?.id === itemA.id);

/* 6. 过期 baseRevision → 409 + 最新文档 */
const staleRes = await api(`/api/boards/${boardId}/patch`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    schemaVersion: 'patch.v1', boardId, baseRevision: 'rev_00000000000000000001',
    ops: [{ op: 'setMeta', title: '不应生效' }], summary: 'stale', author: { kind: 'cli' },
  }),
});
const stale = await json(staleRes);
check('过期 base → 409 + head + doc', staleRes.status === 409 && !!stale.head && !!stale.doc);

/* 7. 合法 patch */
const okPatch = await json(await api(`/api/boards/${boardId}/patch`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    schemaVersion: 'patch.v1', boardId, baseRevision: afterChat.head,
    ops: [{ op: 'setMeta', title: '2026 旗舰手机' }], summary: '设标题', author: { kind: 'cli' },
  }),
}));
check('合法 patch 提交成功', okPatch.ok === true, JSON.stringify(okPatch));

/* 8. 胡话指令 → 零新 revision */
const revsBefore = (await json(await api(`/api/boards/${boardId}/revisions`, { headers: auth }))).revisions.length;
const gibberish = await json(await api(`/api/boards/${boardId}/chat`, {
  method: 'POST', headers: auth, body: JSON.stringify({ message: '芜湖起飞随便改改' }),
}));
const revsAfter = (await json(await api(`/api/boards/${boardId}/revisions`, { headers: auth }))).revisions.length;
check('胡话零 revision + 婉拒回复', gibberish.revisionId === null && revsAfter === revsBefore);

/* 9. revert：撤销是新版本，历史完整 */
const revs = (await json(await api(`/api/boards/${boardId}/revisions`, { headers: auth }))).revisions;
const generateRev = revs.find((r) => r.kind === 'generate');
const reverted = await json(await api(`/api/boards/${boardId}/revert`, {
  method: 'POST', headers: auth, body: JSON.stringify({ revisionId: generateRev.id }),
}));
check('revert 成功', reverted.ok === true);
const revsFinal = (await json(await api(`/api/boards/${boardId}/revisions`, { headers: auth }))).revisions;
check('历史链完整：genesis→generate→patch×2→revert 全在',
  ['genesis', 'generate', 'patch', 'revert'].every((k) => revsFinal.some((r) => r.kind === k))
  && revsFinal.length === revs.length + 1);
const afterRevert = await json(await api(`/api/boards/${boardId}/full`, { headers: auth }));
check('revert 后文档回到 generate 状态（标题清空、条目归位）',
  afterRevert.doc.title === '' && afterRevert.doc.tiers[0].items[0]?.id === itemA.id);

/* 10. 无 editRef → 403 */
const forbidden = await api(`/api/boards/${boardId}/patch`, {
  method: 'POST',
  body: JSON.stringify({
    schemaVersion: 'patch.v1', boardId, baseRevision: afterRevert.head,
    ops: [{ op: 'setMeta', title: 'hack' }], summary: 'hack', author: { kind: 'cli' },
  }),
});
check('无 editRef 修改 → 403', forbidden.status === 403);

/* ============================================================
   P3：图片上传 → 识图 → 证据 → 定档（mock 全链路确定性）
   ============================================================ */
const b2 = await json(await api('/api/boards', { method: 'POST' }));
const auth2 = { 'X-Edit-Ref': b2.editRef };
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));

const prep = await json(await api(`/api/boards/${b2.boardId}/assets/prepare`, {
  method: 'POST', headers: auth2,
  body: JSON.stringify({ files: [
    { name: '小米17.png', mime: 'image/png' },
    { name: 'unknown-shot.png', mime: 'image/png' },
    { name: '三星S26.png', mime: 'image/png' },
  ] }),
}));
check('资产 prepare 返回 3 个上传地址', prep.assets?.length === 3, JSON.stringify(prep));
for (const asset of prep.assets) {
  const put = await fetch(`${BASE}${asset.uploadUrl}`, { method: 'PUT', body: PNG });
  check(`上传 ${asset.assetId} 成功`, put.status === 201, String(put.status));
}
const badToken = await fetch(`${BASE}${prep.assets[0].uploadUrl.replace(/token=.*/, 'token=bogus')}`, { method: 'PUT', body: PNG });
check('坏 token 上传被拒（已上传态同样拒绝）', badToken.status === 403);

const gen2 = await json(await api(`/api/boards/${b2.boardId}/generate`, {
  method: 'POST', headers: auth2, body: JSON.stringify({ topic: '旗舰手机' }),
}));
check('图片生成任务受理', gen2.ok === true, JSON.stringify(gen2));
const snap2 = await waitGeneration(b2.boardId);

const doc2 = snap2.publicDoc;
const flatTiered = doc2.tiers.flatMap((t) => t.items.map((i) => ({ ...i, tier: t.key })));
const xiaomi = flatTiered.find((i) => i.text === '小米17');
const samsung = flatTiered.find((i) => i.text === '三星S26');
check('识图候选按上传序入档（小米17 在 三星S26 之前）',
  !!xiaomi && !!samsung && flatTiered.indexOf(xiaomi) < flatTiered.indexOf(samsung),
  JSON.stringify(flatTiered.map((i) => i.text)));
check('图片条目携带资产 URL', xiaomi?.image?.startsWith('/assets/') === true, xiaomi?.image);
const unknownItem = doc2.pool.find((i) => i.text.startsWith('未识别图片') || i.text.startsWith('待确认：'));
check('识图失败项被强制押入 pool（名字只来自观察线索，不臆造）',
  !!unknownItem && unknownItem.image?.startsWith('/assets/'),
  JSON.stringify(doc2.pool));

const assetRes = await fetch(`${BASE}${xiaomi.image}`);
check('资产读透可访问且带 image/png', assetRes.status === 200 && assetRes.headers.get('content-type') === 'image/png');

console.log(failures === 0 ? '\n★ P2+P3 冒烟全部通过' : `\n✗ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
