# packages/cli/
> L2 | 父级: ../../CLAUDE.md

hangtola 命令行：Agent 能力（generate/revise）与确定性数据操作（get/apply/revert/render/export）双层，同一 HTTP API、同一领域语言，绝不绕过 DO 写入路径。

成员清单
bin/hangtola.mjs: bin 垫片，开发形态经 tsx 直跑 TS 源（发布构建产物待后续接管）
src/cli.ts: 全部实现——参数解析（--flag 与 -x 短旗标）、editRef 落 ~/.hangtola/boards.json、--base 指任意部署；generate 串行保序上传图片并轮询进度；apply 对 409 打印最新文档退出码 2；render 纯本地零网络（转投 skills 渲染器，规则不二写）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
