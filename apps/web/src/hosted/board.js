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
function connectEditor() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${proto}://${location.host}/agents/hangtola-agent/${boardId}`);
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

/* ---- 启动 ---- */
const snapshot = await pollPublic();
if (snapshot) {
  if (snapshot.generation.status === 'running') {
    const timer = setInterval(async () => {
      const s = await pollPublic();
      if (!s || s.generation.status !== 'running') clearInterval(timer);
    }, 800);
  }
  if (editKey) connectEditor();
  else setInterval(pollPublic, 3000);               // 围观者轻轮询
}
