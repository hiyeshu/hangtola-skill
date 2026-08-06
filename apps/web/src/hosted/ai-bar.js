/**
 * [INPUT]: 依赖编辑器 dock DOM（定位锚点）与页面注入的 --safe-b/--accent 设计变量
 * [OUTPUT]: 对外提供 window.hangtolaAiBar.init({placeholder, chips, onSubmit})：dock 右侧 ✨ 圆钮 + dock 原位变形 AI 输入条（palette 式：说完即走），busy 态 ✨ 槽位就地转为盲文 spinner
 * [POS]: 单机版（升舱/主题生成）与云端版（改榜/排备选）共用的唯一 AI 召唤组件——零依赖，视觉语言完全继承 dock
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/* eslint-disable no-undef */
(() => {
  /* 盲文 spinner：10 帧 / 80ms，帧序列取自 unicode-animations（MIT，cli-loaders 的帧数据源）。
     不装那个包——它是 React 组件库，而本组件的立身之本是零依赖、可内联进单文件模板。 */
  const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const SPIN_INTERVAL = 80;

  function init({ placeholder, chips, onSubmit, badge }) {
    const dock = document.querySelector('#dock');
    if (!dock) return null;

    /* ---- ✨ 圆钮：贴着 dock 右侧，同一悬浮语言 ---- */
    const fab = document.createElement('button');
    fab.id = 'ai-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'AI');
    fab.innerHTML = '✨<span id="ai-fab-badge" hidden></span>';
    document.body.appendChild(fab);

    const place = () => {
      const rect = dock.getBoundingClientRect();
      fab.style.left = `${rect.right + 10}px`;
      fab.style.top = `${rect.top + (rect.height - 44) / 2}px`;
    };
    requestAnimationFrame(place);
    addEventListener('resize', place);
    /* dock 尺寸随字体/内容变化：观察一次布局稳定 */
    setTimeout(place, 300);

    /* ---- 输入条：dock 原位的第二形态 ---- */
    const bar = document.createElement('div');
    bar.id = 'ai-bar';
    bar.hidden = true;
    bar.innerHTML = [
      '<span class="ai-bar-spark">✨</span>',
      '<div id="ai-bar-chips"></div>',
      '<input type="text" id="ai-bar-input" autocomplete="off">',
      '<button type="button" id="ai-bar-go" aria-label="发送">↑</button>',
      '<button type="button" id="ai-bar-close" aria-label="关闭">×</button>',
    ].join('');
    document.body.appendChild(bar);
    const input = bar.querySelector('#ai-bar-input');
    const go = bar.querySelector('#ai-bar-go');
    const spark = bar.querySelector('.ai-bar-spark');
    input.placeholder = placeholder;

    /* ---- ✨ 槽位的第二形态：工作时就地转盲文 spinner，不新增任何 DOM ---- */
    const calm = matchMedia('(prefers-reduced-motion: reduce)');
    let spinTimer = null;
    const spin = (on) => {
      clearInterval(spinTimer);
      spinTimer = null;
      bar.setAttribute('aria-busy', on ? 'true' : 'false');
      /* 降噪偏好下不转：placeholder 的阶段文案已经是无障碍的进度播报 */
      if (!on || calm.matches) {
        spark.textContent = '✨';
        spark.classList.remove('is-spinning');
        return;
      }
      spark.classList.add('is-spinning');
      let i = 0;
      const tick = () => { spark.textContent = SPIN_FRAMES[i++ % SPIN_FRAMES.length]; };
      tick();
      spinTimer = setInterval(tick, SPIN_INTERVAL);
    };

    const renderChips = () => {
      const list = chips ? chips() : [];
      const wrap = bar.querySelector('#ai-bar-chips');
      wrap.innerHTML = '';
      for (const chip of list) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'ai-bar-chip';
        el.textContent = chip.label;
        el.addEventListener('click', () => chip.onClick(api));
        wrap.appendChild(el);
      }
      const badgeEl = fab.querySelector('#ai-fab-badge');
      const count = badge ? badge() : list.length;
      badgeEl.hidden = !count;
      requestAnimationFrame(place);
    };

    const open = () => {
      /* 清场：任何编辑面板/遮罩让位，AI 条独占底部 */
      if (typeof closePanel === 'function') closePanel();
      renderChips();
      document.body.classList.add('ai-bar-open');
      bar.hidden = false;
      fab.hidden = true;
      input.focus();
    };
    const close = () => {
      document.body.classList.remove('ai-bar-open');
      bar.hidden = true;
      fab.hidden = false;
      spin(false);            /* 关条即停表，隐藏的输入条不留后台定时器 */
      input.disabled = false;
      go.disabled = false;
      input.value = '';
      input.placeholder = placeholder;
      renderChips();
      requestAnimationFrame(place);
    };
    /** busy(text)：进入工作态并播报阶段；busy(null)：回到可输入态 */
    const busy = (text) => {
      const working = text !== null && text !== undefined;
      input.disabled = working;
      go.disabled = working;
      spin(working);
      if (working) { input.value = ''; input.placeholder = text; }
      else input.placeholder = placeholder;
    };
    /** say(text)：非阻塞提示（婉拒等），保持可输入 */
    const say = (text) => { busy(null); input.placeholder = text; };

    const api = { open, close, busy, say, refresh: renderChips };

    fab.addEventListener('click', open);
    /* dock 与输入条共存：使用 dock（会弹面板/选择器）时输入条自动让位 */
    dock.addEventListener('click', () => { if (!bar.hidden) close(); });
    bar.querySelector('#ai-bar-close').addEventListener('click', close);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    const submit = () => {
      const text = input.value.trim();
      if (!text || input.disabled) return;
      onSubmit(text, api);
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    /* 快捷键 /：随处唤起（输入场景除外） */
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey
          && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')
          && document.activeElement?.contentEditable !== 'true'
          && bar.hidden) {
        e.preventDefault();
        open();
      }
    });

    renderChips();
    return api;
  }

  globalThis.hangtolaAiBar = { init };
})();
