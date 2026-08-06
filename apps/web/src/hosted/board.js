/**
 * [INPUT]: 依赖公开投影 API、编辑者 ws 协议（auth/doc.full/doc.revision/chat/revert）与编辑器同款 CSS 类
 * [OUTPUT]: 对外提供榜单页：只读实时渲染；持 editRef 者获得聊天改榜、变化摘要 + 一键撤销、离线版/JSON 导出
 * [POS]: apps/web 托管层的榜单体验；渲染复用 .tier/.card-item 视觉，V2 与公开投影统一降维为显示模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const $ = (sel) => document.querySelector(sel);
const boardId = location.pathname.split('/').filter(Boolean).pop();
const editKey = new URLSearchParams(location.hash.replace(/^#/, '')).get('k')
  || localStorage.getItem(`hangtola-edit:${boardId}`);
if (editKey) localStorage.setItem(`hangtola-edit:${boardId}`, editKey);

let latestDoc = null;          // 编辑者：完整 V2；围观者：公开投影
let latestHead = null;

/* ---- 显示模型：V2 条目与公开条目统一成 {text, imageUrl, color} ---- */
function displayImage(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (image.kind === 'dataurl') return image.dataUrl;
  return `/assets/${boardId}/${image.assetId}`;
}

function fsClass(t) { const n = t.length; return n <= 2 ? 'fs-xl' : n <= 4 ? 'fs-l' : n <= 8 ? 'fs-m' : 'fs-s'; }

function render(doc) {
  $('#hosted-title').textContent = doc.title ?? '';
  const board = $('#board');
  board.innerHTML = '';
  for (const tier of doc.tiers) {
    const row = document.createElement('div');
    row.className = 'tier';
    const label = document.createElement('div');
    label.className = 'tier-label';
    label.style.background = tier.color;
    label.textContent = tier.label;
    const items = document.createElement('div');
    items.className = 'tier-items';
    for (const item of tier.items) items.appendChild(card(item));
    row.append(label, items);
    board.appendChild(row);
  }
  $('#board-footnote').textContent = doc.footnote ?? '';
  const pool = doc.pool ?? [];
  $('#pool-section').hidden = pool.length === 0;
  const poolBox = $('#pool-items');
  poolBox.innerHTML = '';
  for (const item of pool) poolBox.appendChild(card(item));
}

function card(item) {
  const el = document.createElement('div');
  if (item.id) { el.dataset.itemId = item.id; el.dataset.itemText = item.text ?? ''; }
  const imageUrl = displayImage(item.image);
  if (imageUrl) {
    el.className = 'card-item is-img';
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.src = imageUrl;
    thumb.appendChild(img);
    el.appendChild(thumb);
    if (item.text) {
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = item.text;
      el.appendChild(name);
    }
  } else {
    el.className = 'card-item is-txt';
    const txt = document.createElement('div');
    txt.className = `txt ${fsClass(item.text ?? '')}`;
    txt.textContent = item.text ?? '';
    if (item.color) {
      el.style.background = item.color;
      const n = parseInt(item.color.slice(1), 16);
      const lum = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
      txt.style.color = lum > 0.62 ? '#111213' : '#fff';
    }
    el.appendChild(txt);
  }
  return el;
}

/* ---- 进度（直链进入生成中的榜单时） ---- */
async function pollPublic() {
  const snapshot = await (await fetch(`/api/boards/${boardId}`)).json();
  if (snapshot.error) { $('#hosted-title').textContent = '榜单不存在'; return null; }
  const gen = snapshot.generation;
  const running = gen.status === 'running';
  $('#progress').hidden = !running;
  if (running) {
    $('#progress-stage').textContent = gen.stage;
    $('#progress-fill').style.width = `${gen.pct}%`;
  }
  if (snapshot.publicDoc && !editKey) render(snapshot.publicDoc);
  return snapshot;
}

/* ---- 编辑者：ws 实时 + 聊天 + 撤销 + 导出 ---- */
let activeSocket = null;

function connectEditor() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${proto}://${location.host}/agents/hangtola-agent/${boardId}`);
  activeSocket = socket;
  let undoTarget = null;

  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', editRef: editKey })));
  socket.addEventListener('message', (event) => {
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }
    switch (frame.type) {
      case 'auth.ok':
        $('#chat-dock').hidden = false;
        $('#export-html').hidden = false;
        $('#export-json').hidden = false;
        $('#add-text-btn').hidden = false;
        $('#add-image-btn').hidden = false;
        break;
      case 'auth.fail':
        localStorage.removeItem(`hangtola-edit:${boardId}`);
        break;
      case 'doc.full':
        latestDoc = frame.doc; latestHead = frame.head;
        render(frame.doc);
        break;
      case 'doc.revision':
        latestDoc = frame.doc; latestHead = frame.revision.id;
        render(frame.doc);
        if (frame.revision.kind === 'patch' && frame.revision.parentId) {
          undoTarget = frame.revision.parentId;
          $('#toast-text').textContent = frame.revision.summary;
          $('#toast').hidden = false;
          clearTimeout(window.__toastTimer);
          window.__toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 8000);
        }
        break;
      case 'chat.done':
        $('#chat-send').disabled = false;
        if (!frame.revisionId) {
          $('#toast-text').textContent = frame.reply;
          $('#toast').hidden = false;
          clearTimeout(window.__toastTimer);
          window.__toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
        }
        break;
      case 'patch.conflict':
        latestDoc = frame.doc; latestHead = frame.head;
        render(frame.doc);
        $('#toast-text').textContent = '榜单有新版本，已同步最新状态';
        $('#toast').hidden = false;
        clearTimeout(window.__toastTimer);
        window.__toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
        break;
      default:
        break;
    }
  });
  socket.addEventListener('close', () => {
    $('#chat-send').disabled = false;               // 防按钮卡死
    setTimeout(connectEditor, 1500);                // 断线重连 + 服务端 doc.full 恢复
  });

  $('#chat-send').addEventListener('click', () => {
    const text = $('#chat-input').value.trim();
    if (!text || socket.readyState !== WebSocket.OPEN) return;
    $('#chat-input').value = '';
    $('#chat-send').disabled = true;
    socket.send(JSON.stringify({ type: 'chat', text }));
  });
  $('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#chat-send').click(); });
  $('#toast-undo').addEventListener('click', () => {
    if (undoTarget) socket.send(JSON.stringify({ type: 'revert', revisionId: undoTarget }));
    $('#toast').hidden = true;
  });
}

$('#export-json').addEventListener('click', () => {
  if (!latestDoc) return;
  const blob = new Blob([JSON.stringify(latestDoc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${latestDoc.title || boardId}.json`;
  a.click();
});
$('#export-html').addEventListener('click', async () => {
  const res = await fetch(`/api/boards/${boardId}/export?format=html`, { headers: { 'X-Edit-Ref': editKey } });
  if (!res.ok) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = `${latestDoc?.title || boardId}.html`;
  a.click();
});

/* ============================================================
   编辑者添加条目：文字批量 / 图片保序上传，都编译为 addItem Patch
   （与离线编辑器同一套入口语义：云端版进备选区，拖拽定档）
   ============================================================ */
function sendOps(ops, summary) {
  if (!latestDoc || !latestHead || activeSocket?.readyState !== WebSocket.OPEN) return;
  activeSocket.send(JSON.stringify({
    type: 'patch',
    patch: {
      schemaVersion: 'patch.v1', boardId: latestDoc.id, baseRevision: latestHead,
      ops, summary, author: { kind: 'web' },
    },
  }));
}

/* 文件名"像人话"才当名字（与离线编辑器同源启发式） */
function guessName(filename) {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  if (!base || base.length > 14) return '';
  if (/^(IMG|DSC|DCIM|Screenshot|Snipaste|WeChat|Pasted|image|photo|unknown|截屏|截图|微信图片)/i.test(base)) return '';
  const meat = base.replace(/[\d_\-\s.()]/g, '');
  return meat.length < 2 ? '' : base;
}

$('#add-text-btn').addEventListener('click', () => {
  $('#add-bar').hidden = false;
  $('#add-input').focus();
});
function commitAddText() {
  const raw = $('#add-input').value.trim();
  $('#add-bar').hidden = true;
  $('#add-input').value = '';
  if (!raw) return;
  const names = raw.split(/[,，、\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!names.length) return;
  sendOps(
    names.map((text) => ({ op: 'addItem', item: { text, image: null, note: '', color: null, evidence: [] }, target: { tier: 'pool' } })),
    `添加 ${names.length} 个条目`,
  );
}
$('#add-confirm').addEventListener('click', commitAddText);
$('#add-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitAddText();
  if (e.key === 'Escape') { $('#add-bar').hidden = true; $('#add-input').value = ''; }
});

$('#add-image-btn').addEventListener('click', () => $('#image-input').click());
$('#image-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !editKey) return;
  $('#add-image-btn').disabled = true;
  try {
    const prep = await (await fetch(`/api/boards/${boardId}/assets/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Edit-Ref': editKey },
      body: JSON.stringify({ files: files.map((f) => ({ name: f.name, mime: f.type })) }),
    })).json();
    for (let i = 0; i < prep.assets.length; i += 1) {          // 串行，保上传序
      await fetch(prep.assets[i].uploadUrl, { method: 'PUT', body: files[i] });
    }
    sendOps(
      prep.assets.map((asset, i) => ({
        op: 'addItem',
        item: { text: guessName(files[i].name), image: { kind: 'asset', assetId: asset.assetId }, note: '', color: null, evidence: [] },
        target: { tier: 'pool' },
      })),
      `上传 ${files.length} 张图片`,
    );
  } finally {
    $('#add-image-btn').disabled = false;
  }
});

/* ============================================================
   编辑者拖拽：手势 → BoardPatchV1（moveItem）
   本地不做乐观更新，渲染交给服务端 doc.revision 回声；
   过期 base → patch.conflict 帧采用服务端版
   ============================================================ */
function enableDrag() {
  const TIER_KEYS = ['hang', 'top', 'upper', 'npc', 'la'];
  let drag = null;

  const zoneOf = (el) => {
    const tierBox = el?.closest('.tier-items');
    if (!tierBox) return null;
    if (tierBox.id === 'pool-items') return { tier: 'pool', box: tierBox };
    const rowIndex = [...document.querySelectorAll('#board .tier .tier-items')].indexOf(tierBox);
    return rowIndex >= 0 ? { tier: TIER_KEYS[rowIndex], box: tierBox } : null;
  };

  document.body.addEventListener('pointerdown', (e) => {
    const cardEl = e.target.closest('.card-item');
    if (!cardEl?.dataset.itemId || e.button > 0) return;
    drag = { el: cardEl, sx: e.clientX, sy: e.clientY, started: false, ghost: null };
  });

  document.body.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 7) return;
      drag.started = true;
      const ghost = drag.el.cloneNode(true);
      ghost.id = 'drag-ghost';
      const rect = drag.el.getBoundingClientRect();
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      drag.el.classList.add('drag-source');
    }
    e.preventDefault();
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    zoneOf(document.elementFromPoint(e.clientX, e.clientY))?.box.classList.add('drag-over');
  });

  const endDrag = (e, cancelled) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.started) return;
    d.ghost?.remove();
    d.el.classList.remove('drag-source');
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    if (cancelled || !latestDoc || !latestHead || activeSocket?.readyState !== WebSocket.OPEN) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const zone = zoneOf(under);
    if (!zone) return;
    const cards = [...zone.box.querySelectorAll('.card-item')].filter((el) => el !== d.el);
    const targetCard = under.closest('.card-item');
    const index = targetCard && targetCard !== d.el ? Math.max(0, cards.indexOf(targetCard)) : cards.length;
    const tierLabel = zone.tier === 'pool'
      ? '备选区'
      : latestDoc.tiers[TIER_KEYS.indexOf(zone.tier)]?.label ?? zone.tier;
    activeSocket.send(JSON.stringify({
      type: 'patch',
      patch: {
        schemaVersion: 'patch.v1',
        boardId: latestDoc.id,
        baseRevision: latestHead,
        ops: [{ op: 'moveItem', itemId: d.el.dataset.itemId, to: { tier: zone.tier, index } }],
        summary: `把「${d.el.dataset.itemText || '条目'}」移到${tierLabel}`,
        author: { kind: 'web' },
      },
    }));
  };
  document.body.addEventListener('pointerup', (e) => endDrag(e, false));
  document.body.addEventListener('pointercancel', (e) => endDrag(e, true));
}

/* ---- 启动 ---- */
const snapshot = await pollPublic();
if (snapshot) {
  if (snapshot.generation.status === 'running') {
    const timer = setInterval(async () => {
      const s = await pollPublic();
      if (!s || s.generation.status !== 'running') clearInterval(timer);
    }, 800);
  }
  if (editKey) { connectEditor(); enableDrag(); }
  else setInterval(pollPublic, 3000);               // 围观者轻轮询
}
