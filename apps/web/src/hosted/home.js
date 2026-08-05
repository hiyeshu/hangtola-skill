/**
 * [INPUT]: 依赖 /api/boards 建榜、assets/prepare 上传链与 generate 任务接口
 * [OUTPUT]: 对外提供首页统一输入流程：主题/条目/批量图 → 建榜 → 保序上传 → 点火生成 → 轮询进度 → 跳转编辑
 * [POS]: apps/web 托管层的入口体验；editRef 双持久化（URL fragment + localStorage）防孤儿榜
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const $ = (sel) => document.querySelector(sel);
const files = [];

$('#image-input').addEventListener('change', (e) => {
  files.push(...e.target.files);
  $('#file-label').textContent = files.length ? `已选 ${files.length} 张图` : '＋ 添加图片';
  e.target.value = '';
});
$('.gen-file').addEventListener('click', (e) => {
  if (e.target.tagName !== 'INPUT') $('#image-input').click();
});

async function run() {
  const raw = $('#topic-input').value.trim();
  if (!raw && files.length === 0) return;
  $('#go-btn').disabled = true;
  $('#progress').hidden = false;
  const stage = (text, pct) => {
    $('#progress-stage').textContent = text;
    $('#progress-fill').style.width = `${pct}%`;
  };

  try {
    stage('创建榜单', 2);
    const board = await (await fetch('/api/boards', { method: 'POST' })).json();
    localStorage.setItem(`hangtola-edit:${board.boardId}`, board.editRef);
    const auth = { 'X-Edit-Ref': board.editRef, 'Content-Type': 'application/json' };

    if (files.length) {
      stage(`上传图片 0/${files.length}`, 4);
      const prep = await (await fetch(`/api/boards/${board.boardId}/assets/prepare`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ files: files.map((f) => ({ name: f.name, mime: f.type })) }),
      })).json();
      for (let i = 0; i < prep.assets.length; i += 1) {          // 串行，保上传序
        await fetch(prep.assets[i].uploadUrl, { method: 'PUT', body: files[i] });
        stage(`上传图片 ${i + 1}/${files.length}`, 4 + Math.round((6 * (i + 1)) / files.length));
      }
    }

    /* 首行当主题，其余行/逗号顿号当补充条目；只给条目时主题留给模型判断 */
    const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    const topic = lines[0] ?? '未命名主题';
    const extraText = lines.slice(1).join('、');
    await fetch(`/api/boards/${board.boardId}/generate`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ topic, ...(extraText ? { extraText } : {}) }),
    });

    for (;;) {                                                    // 轮询公开进度
      const snapshot = await (await fetch(`/api/boards/${board.boardId}`)).json();
      const gen = snapshot.generation;
      if (gen.status === 'done') break;
      if (gen.status === 'failed') throw new Error(gen.detail ?? '生成失败');
      stage(gen.stage || '生成中', Math.max(10, gen.pct));
      await new Promise((r) => setTimeout(r, 700));
    }
    stage('完成，正在打开榜单', 100);
    location.href = `/b/${board.boardId}#k=${board.editRef}`;
  } catch (error) {
    stage(`出错了：${error.message}`, 0);
    $('#go-btn').disabled = false;
  }
}

$('#go-btn').addEventListener('click', run);
