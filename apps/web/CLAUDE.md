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
src/hosted/home.html + home.js: 首页统一输入（主题/条目/批量图混合）→ 建榜 → 串行保序上传 → 点火生成 → 轮询进度 → 带 #k= 跳转；editRef 双持久化（fragment + localStorage）防孤儿榜
src/hosted/cloud-adapter.js + cloud.css: 云端榜单页引擎。页面本体就是完整单机编辑器（build.mjs 以 编辑器五部件+适配器 拼装 board.html），适配器接管 autosave 做 DOM↔cloudDoc diff → BoardPatchV1 经 ws 提交（新增图片先上 R2 换 assetId）；回声全量渲染并回贴 cid；dock 注入「智能改榜」面板、⋯ 面板注入分享/离线版；撤销 toast；无 key 进只读围观模式（隐藏 dock 锁交互轮询跟新）

架构决策:
一个编辑器、两个引擎：云端页不做第二套 UI——单机编辑器本体 + 云适配器换掉持久化（本地三函数被同步短路于任何 await 恢复之前，无竞态无闪现）。一切编辑动作汇于 autosave 单点，diff 引擎在此把 DOM 现状编译为最小 ops；渲染只信服务端回声；过期 base 采服务端版。
断线重连由 close 事件驱动，重连后服务端 doc.full 兜底恢复；聊天按钮随连接关闭复位防卡死。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
