import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadInitStatements } from '../server/migrate.js'

test('统一初始化脚本包含所有核心表且不执行硬编码 USE', () => {
  const statements = loadInitStatements()
  const combined = statements.join('\n')
  for (const table of ['users', 'documents', 'translations', 'rag_qa', 'document_chunks', 'sops', 'videos', 'video_chapters', 'video_qa_links']) {
    assert.match(combined, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`))
  }
  assert.doesNotMatch(combined, /\bUSE\s+iflytek_translator\b/i)
})

test('跨文档问答外键允许 NULL', () => {
  const combined = loadInitStatements().join('\n')
  assert.match(combined, /document_id INT DEFAULT NULL/)
  assert.match(combined, /FOREIGN KEY \(document_id\) REFERENCES documents\(id\) ON DELETE SET NULL/)
  assert.match(combined, /UNIQUE INDEX uq_dc_document_chunk/)
})

test('已有数据库会把问答文档外键迁移为删除时置空', () => {
  const source = fs.readFileSync(new URL('../server/migrate.js', import.meta.url), 'utf8')
  assert.match(source, /ensureForeignKeyDeleteRule/)
  assert.match(source, /DROP FOREIGN KEY/)
  assert.match(source, /ensureForeignKeyDeleteRule\(conn, dbName, 'rag_qa', 'document_id', 'documents', 'SET NULL'\)/)
})

test('初始化脚本声明可持久化的文档任务和文件哈希去重', () => {
  const combined = loadInitStatements().join('\n')
  assert.match(combined, /CREATE TABLE IF NOT EXISTS document_jobs\b/)
  assert.match(combined, /file_hash CHAR\(64\) DEFAULT NULL/)
  assert.match(combined, /UNIQUE INDEX uq_documents_user_file_hash \(user_id, file_hash\)/)
  assert.match(combined, /status VARCHAR\(20\) NOT NULL DEFAULT 'queued'/)
})

test('已有处理中旧文档会迁移为可恢复的后台任务', () => {
  const source = fs.readFileSync(new URL('../server/migrate.js', import.meta.url), 'utf8')
  assert.match(source, /INSERT INTO document_jobs/)
  assert.match(source, /'migration-recovery'/)
  assert.match(source, /WHERE d\.status = 0/)
  assert.match(source, /UPDATE documents d[\s\S]*?SET d\.status = 3/)
})

test('初始化脚本声明回答追溯、证据和用户反馈表', () => {
  const combined = loadInitStatements().join('\n')
  assert.match(combined, /CREATE TABLE IF NOT EXISTS rag_answer_traces\b/)
  assert.match(combined, /CREATE TABLE IF NOT EXISTS rag_answer_evidence\b/)
  assert.match(combined, /CREATE TABLE IF NOT EXISTS rag_answer_feedback\b/)
  assert.match(combined, /UNIQUE INDEX uq_raf_user_trace \(user_id, trace_id\)/)
})

test('初始化脚本声明支持二维码渠道表及其约束', () => {
  const combined = loadInitStatements().join('\n')
  assert.match(combined, /CREATE TABLE IF NOT EXISTS support_channels\b/)
  assert.match(combined, /UNIQUE INDEX uq_support_channels_code \(channel_code\)/)
  assert.match(combined, /UNIQUE INDEX uq_support_channels_creator_product \(created_by, product_line, product_model\)/)
  assert.match(combined, /INDEX idx_support_channels_creator_active \(created_by, is_active, updated_at\)/)
  assert.match(combined, /FOREIGN KEY \(created_by\) REFERENCES users\(id\) ON DELETE CASCADE/)
})

test('视频表声明官方来源字段和幂等导入索引', () => {
  const combined = loadInitStatements().join('\n')
  const migrationSource = fs.readFileSync(new URL('../server/migrate.js', import.meta.url), 'utf8')
  assert.match(combined, /source_provider VARCHAR\(50\) NOT NULL DEFAULT 'local'/)
  assert.match(combined, /external_id VARCHAR\(160\) DEFAULT NULL/)
  assert.match(combined, /source_page_url VARCHAR\(700\) DEFAULT ''/)
  assert.match(combined, /source_priority SMALLINT NOT NULL DEFAULT 0/)
  assert.match(combined, /UNIQUE INDEX uq_video_external_source \(source_provider, external_id\)/)
  assert.match(migrationSource, /ensureColumn\(conn, dbName, 'videos', 'source_provider'/)
  assert.match(migrationSource, /ensureIndex\(conn, dbName, 'videos', 'uq_video_external_source'/)
})

test('已有数据库会迁移支持二维码渠道列和索引', () => {
  const source = fs.readFileSync(new URL('../server/migrate.js', import.meta.url), 'utf8')
  assert.match(source, /ensureColumn\(conn, dbName, 'support_channels', 'display_name'/)
  assert.match(source, /ensureColumn\(conn, dbName, 'support_channels', 'product_line'/)
  assert.match(source, /ensureColumn\(conn, dbName, 'support_channels', 'product_model'/)
  assert.match(source, /ensureColumn\(conn, dbName, 'support_channels', 'is_active'/)
  assert.match(source, /ensureIndex\(conn, dbName, 'support_channels', 'uq_support_channels_code', '`channel_code`', true\)/)
  assert.match(source, /DELETE discarded FROM support_channels discarded[\s\S]*?discarded\.created_by = retained\.created_by[\s\S]*?discarded\.product_line = retained\.product_line[\s\S]*?discarded\.product_model = retained\.product_model/)
  assert.match(source, /discarded\.is_active < retained\.is_active/)
  assert.match(source, /discarded\.is_active = retained\.is_active[\s\S]*?COALESCE\(discarded\.updated_at, discarded\.created_at, '1970-01-01 00:00:00'\) < COALESCE\(retained\.updated_at, retained\.created_at, '1970-01-01 00:00:00'\)/)
  assert.match(source, /COALESCE\(discarded\.updated_at, discarded\.created_at, '1970-01-01 00:00:00'\) = COALESCE\(retained\.updated_at, retained\.created_at, '1970-01-01 00:00:00'\)[\s\S]*?discarded\.id < retained\.id/)
  assert.match(source, /ensureIndex\(conn, dbName, 'support_channels', 'uq_support_channels_creator_product', '`created_by`, `product_line`, `product_model`', true\)/)
  assert.match(source, /ensureIndex\(conn, dbName, 'support_channels', 'idx_support_channels_creator_active', '`created_by`, `is_active`, `updated_at`'\)/)
})
