# apps/web/
> L2 | 父级: ../../CLAUDE.md

编辑器与托管站点的源真相：离线单文件 template.html 自此降格为构建产物——模块是源、产物入库、门禁验零漂移。

成员清单
build.mjs: 唯一构建入口。--check 验离线产物零漂移（进 check.mjs 门禁）；默认重组 skills/hangtola/assets/template.html（五部件逐字节拼装）并产出 workers/hangtola/public/{index,board,template}.html
src/template/head.html: 文档头部件（doctype/meta/favicon/title）
src/template/styles.css: 编辑器全部样式（Apple 外壳 CSS 变量是托管页的共享设计基座）
src/template/body.html: 编辑器 DOM 骨架（含 #hangtola-data 注入点行）
src/template/editor.js: 离线编辑器全部行为（814 行原样机械迁入；后续 seam 化在此进行）
src/template/tail.html: 收尾部件
src/hosted/hosted.css: 托管页附加样式，只加不改，复用编辑器变量
src/hosted/image-shrink.js: 上传前置闸，home.js 与 cloud-adapter.js 共用（构建是拼接非打包，故挂 globalThis 而非 import）。长边压 1280、逐像素验 alpha 决定 PNG/JPEG；压完更大或解不开则原样放行
（已删）home.html/home.js/hosted.css: 首页统一输入（主题/条目/批量图混合）→ 建榜 → 压缩 → 并发上传（4 路）→ 点火生成 → 轮询进度 → 带 #k= 跳转；次序由 prepare 落库的 order_index 定死，与上传完成先后无关，故不必串行；editRef 双持久化（fragment + localStorage）防孤儿榜
src/hosted/ai-bar.js + ai-bar.css: 两页共用的 AI 召唤组件（palette 式）：dock 右侧 ✨ 圆钮（窄屏悬浮右下、备选徽标）+ dock 原位变形输入条（/ 键唤起、Esc 退、busy/say 状态机、chips 扩展点）；零依赖，视觉语言继承 dock
src/hosted/cloud-adapter.js + cloud.css: 云端榜单页引擎。AI 交互经共享 ai-bar 组件（指令改榜 + 排备选 chip + 备选徽标），回包走 chat.done → 关条/toast/婉拒占位。页面本体就是完整单机编辑器（build.mjs 以 编辑器五部件+适配器 拼装 board.html），适配器接管 autosave 做 DOM↔cloudDoc diff → BoardPatchV1 经 ws 提交（新增图片先压后上 R2 换 assetId，prepare 必须拿压后 mime 否则 R2 与 DB 记录打架）；回声全量渲染并回贴 cid；dock 注入「智能改榜」面板、⋯ 面板注入分享/离线版；撤销 toast；无 key 进只读围观模式（隐藏 dock 锁交互轮询跟新）

架构决策:
压缩是并行的前提，不是并行的补充：识图链路上单图内存峰值约为自身 4~5 倍，Worker 侧 6 路并发若吃原图必爆 128MB isolate。故治理落在上传前的客户端，而非事后在 Worker 里抢救——源头小了，下游的并发、token、存储三处同时受益。
一个编辑器、两个引擎：云端页不做第二套 UI——单机编辑器本体 + 云适配器换掉持久化（本地三函数被同步短路于任何 await 恢复之前，无竞态无闪现）。一切编辑动作汇于 autosave 单点，diff 引擎在此把 DOM 现状编译为最小 ops；渲染只信服务端回声；过期 base 采服务端版。
断线重连由 close 事件驱动，重连后服务端 doc.full 兜底恢复；聊天按钮随连接关闭复位防卡死。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
