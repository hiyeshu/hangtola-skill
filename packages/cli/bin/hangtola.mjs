#!/usr/bin/env node
/**
 * [INPUT]: 依赖同包 ../src/cli.ts 与仓库 devDep tsx
 * [OUTPUT]: 对外提供 hangtola 可执行入口（开发形态经 tsx 直跑 TS；发布形态待构建产物接管）
 * [POS]: packages/cli 的 bin 垫片
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cliTs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.ts');
const result = spawnSync('npx', ['tsx', cliTs, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
