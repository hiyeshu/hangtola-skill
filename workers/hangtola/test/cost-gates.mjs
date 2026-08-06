/**
 * [INPUT]: 依赖运行中的 wrangler dev（三档 ratelimits 绑定生效）与 Node 18+ fetch
 * [OUTPUT]: 对外提供成本闸验收：prepare 批量截断 / 上传体积双闸 / from-url 收紧 / 建榜限流
 * [POS]: workers/hangtola 的滥用防线回归执行器——闸值可调，闸的存在不可调；
 *        与 smoke.mjs 分离因其验的是「拒绝」而非「功能」，二者失败原因不应混淆
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
let failures = 0;

function check(name, condition, detail = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? '✓' : '✗'} ${name}${condition ? '' : `  ← ${detail}`}`);
}
const json = (res) => res.json();

/* 建榜须在耗尽 RL_BOARD 之前完成——限流用例放最后 */
const board = await json(await fetch(`${BASE}/api/boards`, { method: 'POST' }));
const auth = { 'X-Edit-Ref': board.editRef, 'Content-Type': 'application/json' };

/* ---- 1. prepare 批量截断：闸在 DO 内，HTTP 与 MCP 两路共守 ---- */
const many = await json(await fetch(`${BASE}/api/boards/${board.boardId}/assets/prepare`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ files: Array.from({ length: 120 }, (_, i) => ({ name: `f${i}.png`, mime: 'image/png' })) }),
}));
check('prepare 120 个被截断为 50', many.assets?.length === 50, `实得 ${many.assets?.length}`);

/* ---- 2. 体积闸 A：Content-Length 超限 → 读 body 之前即 413 ---- */
const oversize = new Uint8Array(7 * 1024 * 1024).fill(65);
const declared = await fetch(`${BASE}${many.assets[0].uploadUrl}`, { method: 'PUT', body: oversize });
check('7MB 直传 413（声明值先挡，body 未入内存）', declared.status === 413, `实得 ${declared.status}`);

/* ---- 3. 体积闸 B：分块上传无 Content-Length → 读后二次校验必须补位 ----
       这条用例证明双闸不是冗余：缺声明头时第一道闸完全失效 */
const chunked = new ReadableStream({
  start(ctrl) {
    ctrl.enqueue(new Uint8Array(4 * 1024 * 1024).fill(66));
    ctrl.enqueue(new Uint8Array(3 * 1024 * 1024).fill(66));
    ctrl.close();
  },
});
const streamed = await fetch(`${BASE}${many.assets[1].uploadUrl}`, {
  method: 'PUT', body: chunked, duplex: 'half',
});
check('7MB 分块上传 413（读后二次校验补位）', streamed.status === 413, `实得 ${streamed.status}`);

/* ---- 4. 闸不误伤正常负载 ---- */
const normal = await fetch(`${BASE}${many.assets[2].uploadUrl}`, {
  method: 'PUT', body: new Uint8Array(1024).fill(67),
});
check('1KB 正常上传放行 201', normal.status === 201, `实得 ${normal.status}`);

/* ---- 5. from-url：全仓唯一「服务器替调用方发请求」的出口 ---- */
const REJECTED = [
  ['http 明文', 'http://example.com/a.png'],
  ['localhost', 'https://localhost/a.png'],
  ['192.168 私网', 'https://192.168.1.1/a.png'],
  ['127. 回环', 'https://127.0.0.1/a.png'],
  ['169.254 元数据网段', 'https://169.254.169.254/latest/meta-data'],
  ['10. 私网', 'https://10.0.0.1/a.png'],
  ['172.16 私网', 'https://172.16.0.1/a.png'],
];
for (const [label, url] of REJECTED) {
  const res = await fetch(`${BASE}/api/boards/${board.boardId}/assets/from-url`, {
    method: 'POST', headers: auth, body: JSON.stringify({ url }),
  });
  const body = await json(res).catch(() => ({}));
  check(`from-url 拒斥 ${label}`, res.status === 400 && body.error === 'bad-url',
    `实得 ${res.status} ${JSON.stringify(body)}`);
}

/* ---- 6. 建榜限流（须最后跑：会打满本 colo 的 RL_BOARD 计数） ---- */
const codes = [];
for (let i = 0; i < 16; i += 1) {
  codes.push((await fetch(`${BASE}/api/boards`, { method: 'POST' })).status);
}
check('建榜连打 16 次触发 429', codes.includes(429),
  `429 计 ${codes.filter((c) => c === 429).length} 次，序列 ${codes.join(',')}`);

console.log(failures ? `\n✗ ${failures} 项未通过` : '\n★ 成本闸验收全部通过');
process.exit(failures ? 1 : 0);
