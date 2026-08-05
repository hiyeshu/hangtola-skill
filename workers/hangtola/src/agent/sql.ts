/**
 * [INPUT]: 依赖 agents SDK Agent 实例的 this.sql 标签模板（DO 内嵌 SQLite）
 * [OUTPUT]: 对外提供建表 DDL 清单与行类型；表结构是 DO 持久层的唯一真相
 * [POS]: workers/hangtola 的存储契约：meta/revisions/conversation/tasks（assets 表 P3 加入）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS revisions (
     id TEXT PRIMARY KEY,
     parent_id TEXT,
     kind TEXT NOT NULL,
     summary TEXT NOT NULL,
     author TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     patch_json TEXT,
     doc_json TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS conversation (
     id TEXT PRIMARY KEY,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     revision_id TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS tasks (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     status TEXT NOT NULL,
     progress_json TEXT NOT NULL,
     input_json TEXT NOT NULL,
     error TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS assets (
     id TEXT PRIMARY KEY,
     r2_key TEXT NOT NULL,
     mime TEXT NOT NULL,
     name TEXT NOT NULL,
     order_index INTEGER NOT NULL,
     state TEXT NOT NULL,
     upload_token_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
];

export interface AssetRow {
  id: string;
  r2_key: string;
  mime: string;
  name: string;
  order_index: number;
  state: string;
  upload_token_hash: string;
  created_at: number;
}

export interface RevisionRow {
  id: string;
  parent_id: string | null;
  kind: string;
  summary: string;
  author: string;
  created_at: number;
  patch_json: string | null;
  doc_json: string;
}

export interface TaskRow {
  id: string;
  kind: string;
  status: string;
  progress_json: string;
  input_json: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}
