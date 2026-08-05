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
src/hosted/board.html + board.js: 榜单页。围观者轻轮询公开投影只读渲染；持 editRef 者 ws 实时（auth/doc.full/doc.revision）+ 聊天改榜 + patch 摘要 toast 一键撤销（revert 到 parentId）+ 离线版/JSON 导出；渲染复用 .tier/.card-item 视觉，V2 与公开投影统一降维

架构决策:
托管编辑 = 领域 Patch：拖拽手势直接编译为 moveItem op 经 ws 提交（V2 条目 id 是抓手），本地零乐观更新，渲染只信服务端 doc.revision 回声；过期 base 收 patch.conflict 帧采用服务端版。离线编辑器保持本地模型不动——两个场景两种持久化，同一套领域语言。
断线重连由 close 事件驱动，重连后服务端 doc.full 兜底恢复；聊天按钮随连接关闭复位防卡死。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
