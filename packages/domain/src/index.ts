/**
 * [INPUT]: 依赖同包 ids / rank / schema / migrate / patch
 * [OUTPUT]: 对外提供 @hangtola/domain 的全部公开 API（常量、schema、迁移三桥、patch 应用器、标识工厂）
 * [POS]: domain 包的唯一出口，四端只从这里 import
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export * from './ids.js';
export * from './rank.js';
export * from './schema.js';
export * from './migrate.js';
export * from './patch.js';
