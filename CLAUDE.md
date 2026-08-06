# hangtola-skill - 多模态夯到拉榜单 Skill 与离线编辑器（v2 架构演进中）
Agent Skills 开放规范 + 原生 HTML/CSS/JavaScript + TypeScript workspaces + Node.js CLI + Cloudflare Workers

<directory>
skills/ - skills.sh 可发现的 Skill 集合；当前仅含 hangtola
packages/ - TypeScript workspace 包（2 子目录: domain, cli）；domain 为四端共享领域真相
workers/ - Cloudflare Workers；hangtola 为 Agents SDK 运行时（DO + HTTP + 托管站点，见其 L2 地图）
apps/ - 前端源真相；web 含离线编辑器五部件与托管站点模块（见其 L2 地图）
docs/ - GEB 语义相总图；geb/CONTEXT.md 定义六实体不变式与协作关系
scripts/ - 仓库级检查与站点组合工具，不进入 Skill 运行时工作流
site/ - npm run build 生成的部署产物，含站点专属外壳，永不手改且不入 Git
</directory>

<config>
skills/hangtola/SKILL.md - Skill 入口：多模态输入归一化、维度、调研、定档、呈现参数、生成与交付
skills/hangtola/assets/template.html - 离线单文件编辑器（构建产物：源在 apps/web/src/template，build.mjs 重组，门禁验零漂移）
skills/hangtola/package.json - 将公开 Skill 内 `.js` 显式限定为 ESM，隔离宿主或祖先目录的 Node 模块模式
skills/hangtola/scripts/render-board.js - RedSkill 兼容的渲染 CLI，经 board-validate.gen.js 校验、嵌入本地图片并安全注入模板
skills/hangtola/scripts/board-validate.gen.js - packages/domain 代码生成的零依赖契约镜像，禁手改，npm run codegen 再生
packages/domain/ - 领域真相源（见其 L2 地图）：schema/迁移/patch/rank/标识 + codegen 桥 + 测试
scripts/build-site.mjs - 部署适配器：驱动 apps/web 双目标构建，向首页与榜单页同注 GitHub 图标与 Skill 复制，升舱脚本只进首页
README.md - GitHub 与 skills.sh 用户入口、通用安装命令和开发说明
package.json - workspaces 根与 check/build/test/typecheck/codegen/deploy 边界（deploy 指向 workers/hangtola/wrangler.toml）
tsconfig.base.json - workspace 严格 TS 基线（ES2022 + bundler 解析）
.gitignore - 忽略 site、node_modules、Wrangler 缓存、TS 构建产物与系统文件
</config>

架构决策:
外链图片只做来源不做存储：/assets/from-url 与 MCP ingest_image_url 服务器侧抓取校验（https、image/*、≤6MB、15s 止损）转 R2 资产；文档与导出永远无外链——离线自足、canvas 无污染、不随外站腐烂。
开放分发只认 `skills/hangtola/` 真相源；不维护私有 `.skill` 二进制副本，避免双重版本。
数据模型只保留 `text` 稳定名称与 `note` 内部依据；卡片只公开显示名字，图片和纯文字共享定档模型。
纯文字 `color` 由 AI 从受控调色板按语义选择；图片卡颜色固定为空，拒绝无效参数。
HTML 生成必须经过 render-board.js，禁止 Agent 手工拼 base64 或替换 JSON script。
公开 Skill 包禁止 `.mjs`；Skill 局部 package.json 固定 ESM 语义，仓库级构建与检查脚本仍可使用 `.mjs`。
批量图片异步压缩必须保持输入顺序；用户拖拽决定档位与档内次序。
云端并发度是运行时约束的推论而非调参：识图闸 6 = Workers 连接上限，体积闸 6MB = 128MB isolate 除以并发与 base64 膨胀；改任一处须重算另一处。该约束由 workers/hangtola/src/limits.ts 单一真相源结构化承载，四处消费方共用，禁止就地复制常量。上传前压缩是这条链的前提，不可为省事下放到 Worker 补救。
成本闸设在成本发生处并按量级分档：写端点零鉴权（editRef 由建榜免费铸出）是既定设计，故防线不是鉴权而是限流——建榜造永久 DO 实例、生成聊天烧模型真金、资产写入吃 R2，三者单价差两个数量级，同闸必然要么误伤要么失守。限流是挡脚本的第一道闸而非配额保证（per-colo 计数、官方明示非精确记账），真配额需账户体系或 Turnstile，属产品决策。
资产只增不减是不可变 revision 链的必然推论而非疏漏：历史版本仍引用旧图，删图即毁 revert。故成本治理只能在入境侧（客户端压缩 + 体积闸 + 限流），不可在存量侧补删除。
大图榜单用 IndexedDB 自动保存，localStorage 只保留旧数据与能力降级回退。
模板离线自足，图片只能是本地路径或 data URL；部署外壳由根级脚本组合，禁止写回 Skill 模板。外壳的边界是「托管页 vs Skill 产物」，不是「首页 vs 榜单页」——榜单页才是被生成、被分享、被围观的那一页，回流入口只留在首页等于留在没人到达的地方。
导出画框按画布短边缩放；卡片按内容尺度铺满，档位文字从真实行高取 18% 并测量拟合，禁止再以画布宽度单独缩放。
用户面板坚持动作优先的费曼文案；标题、输入与取消/确认分层，技术格式不得挤占主按钮，默认文案只填入不自动保存。
维度与榜单记忆落在使用方项目 `.hangtola/`，不进入本仓库。

变更日志:
2026-08-06 - 回流入口补进榜单页：站点外壳注入抽为 injectShell，index 与 board 同注 GitHub + 复制 Skill（升舱脚本仍只进首页，榜单页自带云端 ai-bar）。README 去掉与 wrangler.toml 重复且已过期的密钥行（ARK_API_KEY 早已改名 VISION_API_KEY），Skill 章节不再自称「离线路径」——Skill 是 Agent 入口，离线只是它的产物形态。
2026-08-06 - 成本与滥用防线：新增 limits.ts 收口全部运行时推导闸值（四处消费方共用，消除三处常量复制）；三档 IP 限流按成本量级设于建榜/模型/资产端点；直传上传补 Content-Length 先挡后读的双闸（此前无任何体积上限，与 from-url 的 6MB 闸不对称）；prepare 批量截断设于 DO 内；from-url 收紧为 https 单轨 + 私网字面量拒斥 + 声明值先挡。审计确认资产永不回收系不可变 revision 链的必然推论，非缺陷。
2026-08-06 - 网图入境通道：HTTP /assets/from-url + MCP ingest_image_url（八工具），URL 即抓即转资产；AI 条占位语费曼化（想排什么/想怎么改，直接说）。
2026-08-06 - AI 输入条改共存布局：悬于 dock 上方一层（不再变形替换），＋文字/＋图片/导出全程可用；使用 dock 时输入条自动让位，toast 随之上移一层。
2026-08-06 - 双主体协作补最后一块：生成完成改合并语义（生成期间人工新增条目/标题/声明/档位名原样保留，摘要如实播报），AI 条唤起先清场编辑面板；「任意状态双方可介入、文档单一真相源」自此闭环。
2026-08-06 - AI 协作定型为 palette 模式（拒绝常驻聊天窗与开源 chat 组件）：自研 ai-bar 组件（✨ 圆钮 + dock 原位变形输入条 + / 唤起 + 备选徽标）两页共用；单机版右上 AI pill 退役，升舱由输入条驱动；云端指令改榜/排备选同入口。
2026-08-06 - 入口大一统：杀 /ai 页（301 回 /），「AI 智能排」一个按钮一种行为（空板=主题生成/有货=升舱，同一面板自适应）；云端新条目获得增量智能：智能改榜面板一键「排备选」（DO 补识图补证据，白名单 patch 只动备选条目），新图不再是哑条目。
2026-08-06 - 生成管线提速：实测定位「慢」不在 Qwen（单次 3.4~5.1s，MaaS 侧 12 路并发零限流）而在串行。识图改 6 路并发（= Workers 同时等响应头的连接上限），步名按资产下标固定保 Workflow 重放确定性；新增上传前置压缩闸（长边 1280、逐像素验 alpha 定 PNG/JPEG）——压缩是并行的前提而非补充，否则 6 路吃原图必爆 128MB isolate；上传亦转并发（序由 order_index 定，与完成先后无关）；vision 加 25s 止损并把重试权交还 step，消除 SDK×step 双层退避相乘。
2026-08-06 - 云端页 UI 大一统：废 lite 渲染器，榜单页=完整单机编辑器+云适配器（autosave 单点 diff→Patch、图片上 R2、回声渲染、dock 注入智能改榜、⋯ 注入分享/离线版、围观只读模式）；三比例 PNG 导出在云端复活。
2026-08-06 - 产品反转：hangtola.app 默认单机版编辑器，「AI 智能排」升舱入口带本地条目上云重排；Agent 输入页迁 /ai。视觉切 Qwen3.7-Flash（阿里 MaaS，约 ¥0.001/张），DeepSeek 保持官方；修同名图片候选覆盖。
2026-08-06 - 云端榜单页补齐直接编辑入口（＋文字批量/＋图片保序上传→addItem Patch）；首页加单机版编辑器直达；生产密钥注入（用户授权），hangtola.app 真模型端到端验证通过。
2026-08-06 - P6 收官：docs/geb/CONTEXT.md 六实体总图；README 四入口叙事；build-site 改为托管首页外壳注入器；Worker 更名 hangtola 携自定义域接管 hangtola.app（撤 assets-only 配置）；生产真模型 + R2 + secrets 上线。
2026-08-06 - P5 落地 CLI 与 Remote MCP：hangtola 七命令（保序上传/409 退出码 2/本地渲染转投 skills 渲染器）；/mcp 无状态七工具薄封装 DO；MCP 六项 + CLI 全命令 e2e 通过。
2026-08-06 - P4a 落地托管站点：模板降格为构建产物（五部件切分逐字节重组+零漂移门禁）；首页统一输入→保序上传→生成进度→跳转；榜单页围观轮询/编辑者 ws 实时+聊天改榜+摘要撤销+离线版导出；ws 鉴权迁入 connection state 修复休眠丢态。
2026-08-06 - P3 落地图片与调研管线：R2 资产链（DO 一次性令牌/Worker 中转/读透）、Seed 识图与 Exa 调研边界（降级不臆造）、可恢复生成 Workflow（每图一步/批次证据/幂等 commit）、enforceGrounding 代码层无捏造；冒烟 25 项全绿 + DO 持久化跨重启验证。
2026-08-06 - P2 落地 HangtolaAgent DO：每榜一实例、#commit 唯一写入路径、不可变 revision 链与 revert-as-new-revision、ws 协议、DeepSeek 结构化 NL→Patch（修复一次/失败零 revision）、MOCK 桩验收 14 项全绿 + 真模型生成/改榜双实测贯通。
2026-08-06 - P1 落地共享领域模块：workspaces + packages/domain（V2 schema、迁移三桥、patch 应用器）、代码生成契约镜像接管 render-board 校验（金样零 diff）、check.mjs 焊入 codegen/类型/测试门禁。
2026-08-03 - 迁移至 skills.sh 兼容目录；加入多图输入、纯文字智能配色、确定性渲染脚本与 IndexedDB。
2026-08-03 - 同步 minitool-build 通用改进：软键盘上浮、安全区、无刷新重置、满幅比例导出。
2026-08-03 - 产品化并部署 hangtola.app：透明 PNG、统一卡片框、深浅色与可编辑标题/声明。
2026-08-03 - 分离部署站点外壳：右上角 GitHub 图标与 Skill 复制仅注入 hangtola.app，Skill 模板保持干净。
2026-08-03 - Web 与 minitool 业务模型同构：移除短评字段，卡片只显示名字，三种导出比例共用单行名字槽位算法。
2026-08-03 - 公开 Skill 渲染器迁移为 RedSkill 白名单内的 `.js`，并用局部 package.json 显式固定 ESM。
2026-08-03 - 修复 3:4 导出光学比例：标签列内容驱动，档位文字随行高拟合，标题与声明按短边保持可读。
2026-08-03 - 统一编辑器费曼文案与表单层级：技术格式退出主按钮，声明默认文案改为填入后确认保存。

法则: 极简·稳定·导航·版本精确
