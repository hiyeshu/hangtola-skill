/**
 * [INPUT]: 依赖编辑器全局（applyData/serialize/items/autosave/openPanel/closePanel/escapeHtml/持久化三函数）与 ws 协议、资产上传 API
 * [OUTPUT]: 对外提供云同步引擎：编辑器一切动作 diff 编译为 BoardPatchV1 经 ws 提交；回声全量渲染；AI 输入条（✨ 圆钮/斜杠唤起：指令改榜 + 一键排备选，徽标提示）；⋯ 面板注入分享/离线版
 * [POS]: 云端榜单页 = 单机版编辑器 + 本适配器——UI 零分叉，只换持久化引擎；本地 IndexedDB 在云模式被整体短路
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/* eslint-disable no-undef */
(() => {
  const boardId = location.pathname.split('/').filter(Boolean).pop();
  const editKey = new URLSearchParams(location.hash.replace(/^#/, '')).get('k')
    || localStorage.getItem(`hangtola-edit:${boardId}`);
  if (editKey) localStorage.setItem(`hangtola-edit:${boardId}`, editKey);

  /* ---- 云模式：本地持久化整体短路（在 loadInitialData 的首个 await 恢复前生效） ---- */
  loadSavedBoard = async () => null;
  persistBoard = async () => {};
  removeSavedBoard = async () => {};

  const TIERS = ['hang', 'top', 'upper', 'npc', 'la'];
  let cloudDoc = null;           // 服务端 V2 真相
  let head = null;
  let socket = null;
  let suppress = false;          // 应用回声期间不触发 diff
  let syncTimer = null;
  let undoTarget = null;
  let aiBar = null;

  /* ============================================================
     视图桥：V2 → 编辑器 legacy 形状；渲染后按序回贴 cid
     ============================================================ */
  const imageUrl = (image) => image === null ? null
    : image.kind === 'dataurl' ? image.dataUrl : `/assets/${boardId}/${image.assetId}`;

  function renderCloud(doc) {
    suppress = true;
    applyData({
      id: doc.id,
      title: doc.title,
      footnote: doc.footnote,
      savedAt: new Date(doc.savedAt).toISOString(),
      dimensions: doc.dimensions,
      tiers: doc.tiers.map((t) => ({
        key: t.key, label: t.label, color: t.color,
        items: t.items.map((it) => ({ text: it.text, image: imageUrl(it.image), note: it.note, color: it.color })),
      })),
      pool: doc.pool.map((it) => ({ text: it.text, image: imageUrl(it.image), note: it.note, color: it.color })),
    });
    /* applyData 按 tiers→pool 顺序建卡，与 doc 遍历同序：对位回贴 cid */
    const lists = [...doc.tiers.map((t) => t.items), doc.pool];
    const containers = [...TIERS, 'pool'].map((k) => document.querySelector(`.tier-items[data-tier="${k}"]`));
    containers.forEach((container, i) => {
      [...container.querySelectorAll('.card-item')].forEach((el, j) => {
        el.dataset.cid = lists[i][j]?.id ?? '';
      });
    });
    suppress = false;
  }

  /* ============================================================
     diff 引擎：DOM 现状 vs cloudDoc → BoardPatchV1 ops
     ============================================================ */
  function readState() {
    const buckets = {};
    for (const key of [...TIERS, 'pool']) {
      buckets[key] = [...document.querySelectorAll(`.tier-items[data-tier="${key}"] .card-item`)]
        .map((el) => ({
          cid: el.dataset.cid || null,
          uploading: el.dataset.uploading === '1',
          el,
          content: items.get(el.dataset.id),
        }))
        .filter((c) => c.content);
    }
    return buckets;
  }

  function cloudIndex() {
    const map = new Map();
    cloudDoc.tiers.forEach((t) => t.items.forEach((it, i) => map.set(it.id, { tier: t.key, index: i, item: it })));
    cloudDoc.pool.forEach((it, i) => map.set(it.id, { tier: 'pool', index: i, item: it }));
    return map;
  }

  async function diffAndSend() {
    if (!cloudDoc || !head || suppress || socket?.readyState !== WebSocket.OPEN) return;
    const state = readState();
    const known = cloudIndex();
    const ops = [];

    /* 新增：无 cid 的卡。图片卡先上传换 assetId（标记 uploading 防重入） */
    for (const key of [...TIERS, 'pool']) {
      for (let i = 0; i < state[key].length; i += 1) {
        const card = state[key][i];
        if (card.cid || card.uploading) continue;
        let image = null;
        if (card.content.image) {
          card.el.dataset.uploading = '1';
          try {
            /* 先解码再压，压完才知道真实 mime——prepare 必须拿到压后的类型，否则 R2 与 DB 记录打架 */
            const raw = await (await fetch(card.content.image)).blob();
            const file = await globalThis.hangtolaShrinkImage(
              new File([raw], `${card.content.text || '图片'}.png`, { type: raw.type || 'image/png' }));
            const prep = await (await fetch(`/api/boards/${boardId}/assets/prepare`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Edit-Ref': editKey },
              body: JSON.stringify({ files: [{ name: file.name, mime: file.type }] }),
            })).json();
            await fetch(prep.assets[0].uploadUrl, { method: 'PUT', body: file });
            image = { kind: 'asset', assetId: prep.assets[0].assetId };
          } finally {
            delete card.el.dataset.uploading;
          }
        }
        ops.push({
          op: 'addItem',
          item: { text: card.content.text, image, note: card.content.note || '', color: card.content.color, evidence: [] },
          target: { tier: key, index: i },
        });
        card.el.dataset.cid = 'pending';       // 回声会重建映射；先防重复 add
      }
    }

    /* 删除：cloud 有而 DOM 无 */
    const present = new Set([...TIERS, 'pool'].flatMap((k) => state[k].map((c) => c.cid)));
    for (const [cid] of known) {
      if (!present.has(cid)) ops.push({ op: 'removeItem', itemId: cid });
    }

    /* 移动 + 内容更新（以 DOM 为准） */
    for (const key of [...TIERS, 'pool']) {
      const cids = state[key].filter((c) => c.cid && c.cid !== 'pending').map((c) => c.cid);
      const cloudCids = key === 'pool'
        ? cloudDoc.pool.map((it) => it.id)
        : cloudDoc.tiers.find((t) => t.key === key).items.map((it) => it.id);
      const orderChanged = cids.join() !== cloudCids.filter((id) => present.has(id)).join();
      state[key].forEach((card, i) => {
        if (!card.cid || card.cid === 'pending') return;
        const was = known.get(card.cid);
        if (!was) return;
        if (orderChanged || was.tier !== key) {
          ops.push({ op: 'moveItem', itemId: card.cid, to: { tier: key, index: i } });
        }
        const set = {};
        if (card.content.text !== was.item.text) set.text = card.content.text;
        if ((card.content.note || '') !== was.item.note) set.note = card.content.note || '';
        if ((card.content.color ?? null) !== was.item.color) set.color = card.content.color ?? null;
        if (Object.keys(set).length) ops.push({ op: 'updateItem', itemId: card.cid, set });
      });
    }

    /* 元信息 */
    const meta = {};
    const title = document.querySelector('#board-title').textContent.trim();
    const footnoteNow = document.querySelector('#board-footnote').textContent.trim();
    if (title !== cloudDoc.title) meta.title = title;
    if (footnoteNow !== cloudDoc.footnote) meta.footnote = footnoteNow;
    const labels = {};
    cloudDoc.tiers.forEach((t) => {
      const label = document.querySelector(`.tier-label[data-key="${t.key}"]`)?.textContent.trim();
      if (label && label !== t.label) labels[t.key] = label;
    });
    if (Object.keys(labels).length) meta.tierLabels = labels;
    if (Object.keys(meta).length) ops.push({ op: 'setMeta', ...meta });

    if (!ops.length) return;
    socket.send(JSON.stringify({
      type: 'patch',
      patch: {
        schemaVersion: 'patch.v1', boardId, baseRevision: head,
        ops, summary: summarize(ops), author: { kind: 'web' },
      },
    }));
  }

  function summarize(ops) {
    const names = { addItem: '添加', removeItem: '删除', moveItem: '移动', updateItem: '修改', setMeta: '改信息', setDimensions: '改维度' };
    const counts = {};
    ops.forEach((op) => { counts[op.op] = (counts[op.op] || 0) + 1; });
    return Object.entries(counts).map(([op, n]) => `${names[op] || op}${n > 1 ? `×${n}` : ''}`).join('、');
  }

  /* ---- 接管 autosave：编辑器一切动作从此进 diff 管线 ---- */
  autosave = () => {
    if (suppress) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { diffAndSend().catch(() => toast('同步失败，稍后自动重试')); }, 350);
  };

  /* ============================================================
     轻量 toast（摘要 + 撤销）
     ============================================================ */
  const toastEl = document.createElement('div');
  toastEl.id = 'cloud-toast';
  toastEl.innerHTML = '<span id="cloud-toast-text"></span><button id="cloud-toast-undo">撤销</button>';
  document.body.appendChild(toastEl);
  toastEl.hidden = true;
  let toastTimer = null;
  function toast(text, withUndo = false) {
    toastEl.querySelector('#cloud-toast-text').textContent = text;
    toastEl.querySelector('#cloud-toast-undo').hidden = !withUndo;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, withUndo ? 8000 : 4000);
  }
  toastEl.querySelector('#cloud-toast-undo').addEventListener('click', () => {
    if (undoTarget && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'revert', revisionId: undoTarget }));
    }
    toastEl.hidden = true;
  });

  /* ============================================================
     ws：auth → doc.full；回声全量渲染；冲突采服务端
     ============================================================ */
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/agents/hangtola-agent/${boardId}`);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', editRef: editKey })));
    socket.addEventListener('message', (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      switch (frame.type) {
        case 'auth.fail':
          localStorage.removeItem(`hangtola-edit:${boardId}`);
          enterViewerMode();
          break;
        case 'doc.full':
          cloudDoc = frame.doc; head = frame.head;
          renderCloud(cloudDoc);
          break;
        case 'doc.revision':
          cloudDoc = frame.doc; head = frame.revision.id;
          renderCloud(cloudDoc);
          aiBar?.refresh();
          if (frame.revision.kind === 'patch' && frame.revision.parentId) {
            undoTarget = frame.revision.parentId;
            toast(frame.revision.summary, true);
          }
          break;
        case 'patch.conflict':
          cloudDoc = frame.doc; head = frame.head;
          renderCloud(cloudDoc);
          toast('榜单有新版本，已同步最新状态');
          break;
        case 'chat.done': {
          if (frame.revisionId) { aiBar?.close(); toast(frame.reply || '已改好', !!undoTarget); }
          else aiBar?.say(frame.reply || '没改成，换个说法试试？');
          break;
        }
        default:
      }
    });
    socket.addEventListener('close', () => setTimeout(connect, 1500));
  }

  /* ============================================================
     AI 输入条（palette 式）：✨ 圆钮唤起 → 指令改榜 / 一键排备选
     ============================================================ */
  function initAiBar() {
    if (!globalThis.hangtolaAiBar) return;
    const poolCount = () =>
      document.querySelectorAll('.tier-items[data-tier="pool"] .card-item').length;
    aiBar = hangtolaAiBar.init({
      placeholder: '对榜单下指令：把 A 移到夯、改标题…',
      badge: poolCount,
      chips: () => {
        const n = poolCount();
        return n ? [{
          label: `✨ 排备选 ${n}`,
          onClick: (api) => {
            if (socket?.readyState !== WebSocket.OPEN) return;
            api.busy('AI 正在识图、查资料、给备选定档…');
            socket.send(JSON.stringify({ type: 'rankPool' }));
          },
        }] : [];
      },
      onSubmit: (text, api) => {
        if (socket?.readyState !== WebSocket.OPEN) { api.say('连接断了，正在重连…'); return; }
        api.busy('思考中…');
        socket.send(JSON.stringify({ type: 'chat', text }));
      },
    });
  }

  /* ---- ⋯ 面板注入：分享链接 / 下载离线版（观察 #panel 出现） ---- */
  new MutationObserver(() => {
    const panel = document.querySelector('#panel');
    if (!panel || panel.dataset.cloudExtended) return;
    if (![...panel.querySelectorAll('button')].some((b) => b.textContent.includes('导出榜单数据'))) return;
    panel.dataset.cloudExtended = '1';
    const share = document.createElement('button');
    share.className = 'p-btn wide';
    share.textContent = '复制分享链接（对方只读）';
    share.addEventListener('click', async () => {
      await navigator.clipboard.writeText(`${location.origin}/b/${boardId}`);
      share.textContent = '已复制分享链接';
    });
    const offline = document.createElement('button');
    offline.className = 'p-btn wide';
    offline.textContent = '下载离线版（单机编辑器 + 当前数据）';
    offline.addEventListener('click', async () => {
      const res = await fetch(`/api/boards/${boardId}/export?format=html`, { headers: { 'X-Edit-Ref': editKey } });
      if (!res.ok) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `hangtola-${boardId}.html`;
      a.click();
    });
    const anchor = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('导出榜单数据'));
    anchor?.before(share, offline);
  }).observe(document.body, { childList: true });

  /* ============================================================
     围观模式：无编辑密钥 → 只读（隐藏 dock、锁交互、轮询跟新）
     ============================================================ */
  function enterViewerMode() {
    document.body.classList.add('cloud-viewer');
    const poll = async () => {
      const snapshot = await (await fetch(`/api/boards/${boardId}`)).json();
      if (snapshot.error) { document.querySelector('#board-title').textContent = '榜单不存在'; return; }
      if (snapshot.publicDoc) {
        suppress = true;
        applyData({
          id: snapshot.publicDoc.id,
          title: snapshot.publicDoc.title,
          footnote: snapshot.publicDoc.footnote,
          savedAt: new Date().toISOString(),
          dimensions: [],
          tiers: snapshot.publicDoc.tiers,
          pool: snapshot.publicDoc.pool,
        });
        suppress = false;
      }
      if (snapshot.generation?.status === 'running') {
        toast(`${snapshot.generation.stage} ${snapshot.generation.pct}%`);
      }
    };
    poll();
    setInterval(poll, 3000);
  }

  /* ============================================================
     启动
     ============================================================ */
  if (editKey) {
    initAiBar();
    connect();
    /* 直链进入生成中的榜单：轻轮询进度直至 done（ws 回声接管后自停） */
    const genPoll = setInterval(async () => {
      const snapshot = await (await fetch(`/api/boards/${boardId}`)).json();
      const gen = snapshot.generation;
      if (!gen || gen.status !== 'running') { clearInterval(genPoll); return; }
      toast(`${gen.stage} ${gen.pct}%`);
    }, 900);
  } else {
    enterViewerMode();
  }
})();
