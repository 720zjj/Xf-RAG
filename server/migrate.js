import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { getOfficialVideoCatalog, OFFICIAL_VIDEO_PROVIDER } from './services/officialVideoCatalog.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function loadInitStatements(sqlText = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8')) {
  const schemaOnly = sqlText
    .replace(/^\s*CREATE DATABASE[^;]+;\s*/im, '')
    .replace(/^\s*USE\s+[^;]+;\s*/im, '')
  return schemaOnly.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean)
}

async function hasColumn(conn, dbName, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [dbName, table, column]
  )
  return rows.length > 0
}

async function columnInfo(conn, dbName, table, column) {
  const [rows] = await conn.query(
    'SELECT DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [dbName, table, column]
  )
  return rows[0] || null
}

async function hasIndex(conn, dbName, table, indexName) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [dbName, table, indexName]
  )
  return rows.length > 0
}

async function ensureColumn(conn, dbName, table, column, definition) {
  if (!(await hasColumn(conn, dbName, table, column))) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
  }
}

async function ensureIndex(conn, dbName, table, indexName, columns, unique = false) {
  if (!(await hasIndex(conn, dbName, table, indexName))) {
    await conn.query(`ALTER TABLE \`${table}\` ADD ${unique ? 'UNIQUE ' : ''}INDEX \`${indexName}\` (${columns})`)
  }
}

async function ensureForeignKeyDeleteRule(conn, dbName, table, column, referencedTable, deleteRule) {
  const [rows] = await conn.query(
    `SELECT k.CONSTRAINT_NAME, r.DELETE_RULE
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
      AND r.TABLE_NAME = k.TABLE_NAME
      AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.COLUMN_NAME = ?
       AND k.REFERENCED_TABLE_NAME = ?`,
    [dbName, table, column, referencedTable]
  )
  if (rows.some(row => row.DELETE_RULE === deleteRule)) return

  for (const row of rows) {
    const constraintName = String(row.CONSTRAINT_NAME).replace(/`/g, '``')
    await conn.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${constraintName}\``)
  }
  await conn.query(
    `ALTER TABLE \`${table}\` ADD CONSTRAINT \`fk_${table}_${column}\`
     FOREIGN KEY (\`${column}\`) REFERENCES \`${referencedTable}\`(\`id\`) ON DELETE ${deleteRule}`
  )
}

export async function runMigrations() {
  const dbName = process.env.DB_NAME || 'iflytek_translator'
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) throw new Error('DB_NAME 只能包含字母、数字和下划线')

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4'
  })

  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await conn.query(`USE \`${dbName}\``)

    const statements = loadInitStatements()
    for (const statement of statements) await conn.query(statement)

    // 兼容已经存在的旧数据库：补列、放宽跨文档问答外键并升级文本容量。
    const metadataColumns = {
      brand: "VARCHAR(50) DEFAULT '科大讯飞'",
      product_line: "VARCHAR(50) DEFAULT '翻译机'",
      product_model: "VARCHAR(100) DEFAULT ''",
      firmware_version: "VARCHAR(50) DEFAULT ''",
      document_type: "VARCHAR(50) DEFAULT ''",
      document_version: "VARCHAR(50) DEFAULT ''",
      chapter: "VARCHAR(100) DEFAULT ''",
      content_type: "VARCHAR(50) DEFAULT 'general'",
      risk_level: "VARCHAR(20) DEFAULT 'low'",
      effective_status: "VARCHAR(20) DEFAULT 'active'"
    }
    for (const [column, definition] of Object.entries(metadataColumns)) {
      await ensureColumn(conn, dbName, 'document_chunks', column, definition)
    }
    for (const [column, definition] of Object.entries({
      file_hash: 'CHAR(64) DEFAULT NULL',
      mineru_task_id: 'VARCHAR(100) DEFAULT NULL',
      mineru_batch_id: 'VARCHAR(100) DEFAULT NULL',
      mineru_zip_url: 'VARCHAR(500) DEFAULT NULL',
      mineru_pages: 'INT DEFAULT 0',
      mineru_model: "VARCHAR(20) DEFAULT 'pipeline'",
      processing_started_at: 'DATETIME DEFAULT NULL',
      error_message: 'VARCHAR(1000) DEFAULT NULL'
    })) await ensureColumn(conn, dbName, 'documents', column, definition)

    await ensureColumn(conn, dbName, 'support_channels', 'display_name', "VARCHAR(100) NOT NULL DEFAULT ''")
    await ensureColumn(conn, dbName, 'support_channels', 'product_line', "VARCHAR(50) NOT NULL DEFAULT ''")
    await ensureColumn(conn, dbName, 'support_channels', 'product_model', "VARCHAR(100) NOT NULL DEFAULT ''")
    await ensureColumn(conn, dbName, 'support_channels', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1')

    await ensureColumn(conn, dbName, 'videos', 'source_provider', "VARCHAR(50) NOT NULL DEFAULT 'local'")
    await ensureColumn(conn, dbName, 'videos', 'external_id', 'VARCHAR(160) DEFAULT NULL')
    await ensureColumn(conn, dbName, 'videos', 'source_page_url', "VARCHAR(700) DEFAULT ''")
    await ensureColumn(conn, dbName, 'videos', 'source_priority', 'SMALLINT NOT NULL DEFAULT 0')
    await ensureColumn(conn, dbName, 'videos', 'playback_url', "VARCHAR(700) DEFAULT ''")

    // 保留官方 H5 原地址用于溯源，同时为已导入的双屏 2.0 视频补充移动端兼容的 H.264 播放地址。
    for (const item of getOfficialVideoCatalog().filter(video => video.playbackUrl)) {
      await conn.query(
        `UPDATE videos SET playback_url = ?
         WHERE source_provider = ? AND external_id = ? AND COALESCE(playback_url, '') <> ?`,
        [item.playbackUrl, OFFICIAL_VIDEO_PROVIDER, item.externalId, item.playbackUrl]
      )
    }

    const documentContent = await columnInfo(conn, dbName, 'documents', 'content')
    if (documentContent?.DATA_TYPE !== 'longtext') await conn.query('ALTER TABLE documents MODIFY COLUMN content LONGTEXT NULL')
    const qaDocumentId = await columnInfo(conn, dbName, 'rag_qa', 'document_id')
    if (qaDocumentId?.IS_NULLABLE !== 'YES') await conn.query('ALTER TABLE rag_qa MODIFY COLUMN document_id INT NULL')
    await ensureForeignKeyDeleteRule(conn, dbName, 'rag_qa', 'document_id', 'documents', 'SET NULL')

    // 旧版把 status=0 仅作为 HTTP 进程中的“处理中”标记。升级后将没有任务记录的文档恢复为可持久化队列任务。
    const [legacyRecovery] = await conn.query(
      `INSERT INTO document_jobs (document_id, user_id, job_type, status, progress, stage, max_attempts)
       SELECT d.id, d.user_id, 'migration-recovery', 'queued', 0, 'queued', 3
       FROM documents d
       LEFT JOIN document_jobs j ON j.document_id = d.id
       WHERE d.status = 0 AND j.id IS NULL`
    )
    if (legacyRecovery.affectedRows > 0) {
      await conn.query(
        `UPDATE document_jobs SET queue_job_id = CONCAT('document-', id)
         WHERE job_type = 'migration-recovery' AND queue_job_id IS NULL`
      )
      await conn.query(
        `UPDATE documents d
         JOIN document_jobs j ON j.document_id = d.id
         SET d.status = 3, d.processing_started_at = NULL, d.error_message = NULL
         WHERE d.status = 0 AND j.job_type = 'migration-recovery' AND j.status = 'queued'`
      )
    }

    if (!(await hasIndex(conn, dbName, 'document_chunks', 'uq_dc_document_chunk'))) {
      await conn.query(`DELETE newer FROM document_chunks newer
        JOIN document_chunks older
          ON newer.document_id = older.document_id
         AND newer.chunk_index = older.chunk_index
         AND newer.id > older.id`)
      await ensureIndex(conn, dbName, 'document_chunks', 'uq_dc_document_chunk', '`document_id`, `chunk_index`', true)
    }
    await ensureIndex(conn, dbName, 'document_chunks', 'idx_dc_product', '`product_line`, `product_model`')
    await ensureIndex(conn, dbName, 'document_chunks', 'idx_dc_type', '`content_type`')
    await ensureIndex(conn, dbName, 'document_chunks', 'idx_dc_status', '`effective_status`')
    await ensureIndex(conn, dbName, 'documents', 'idx_documents_user', '`user_id`, `created_at`')
    await ensureIndex(conn, dbName, 'documents', 'uq_documents_user_file_hash', '`user_id`, `file_hash`', true)
    await ensureIndex(conn, dbName, 'rag_qa', 'idx_rag_qa_user', '`user_id`, `created_at`')
    await ensureIndex(conn, dbName, 'rag_qa', 'idx_rag_qa_document', '`document_id`')
    await ensureIndex(conn, dbName, 'rag_answer_traces', 'idx_rat_user_created', '`user_id`, `created_at`')
    await ensureIndex(conn, dbName, 'rag_answer_traces', 'idx_rat_decision_created', '`trust_level`, `reason_code`, `created_at`')
    await ensureIndex(conn, dbName, 'rag_answer_evidence', 'uq_rae_trace_evidence', '`trace_id`, `evidence_id`', true)
    await ensureIndex(conn, dbName, 'rag_answer_evidence', 'idx_rae_trace', '`trace_id`')
    await ensureIndex(conn, dbName, 'rag_answer_feedback', 'uq_raf_user_trace', '`user_id`, `trace_id`', true)
    await ensureIndex(conn, dbName, 'rag_answer_feedback', 'idx_raf_outcome_created', '`outcome`, `created_at`')
    await ensureIndex(conn, dbName, 'support_channels', 'uq_support_channels_code', '`channel_code`', true)
    if (!(await hasIndex(conn, dbName, 'support_channels', 'uq_support_channels_creator_product'))) {
      await conn.query(`DELETE discarded FROM support_channels discarded
        JOIN support_channels retained
          ON discarded.created_by = retained.created_by
         AND discarded.product_line = retained.product_line
         AND discarded.product_model = retained.product_model
         AND (
           discarded.is_active < retained.is_active
           OR (
             discarded.is_active = retained.is_active
             AND (
               COALESCE(discarded.updated_at, discarded.created_at, '1970-01-01 00:00:00') < COALESCE(retained.updated_at, retained.created_at, '1970-01-01 00:00:00')
               OR (
                 COALESCE(discarded.updated_at, discarded.created_at, '1970-01-01 00:00:00') = COALESCE(retained.updated_at, retained.created_at, '1970-01-01 00:00:00')
                 AND discarded.id < retained.id
               )
             )
           )
         )`)
      await ensureIndex(conn, dbName, 'support_channels', 'uq_support_channels_creator_product', '`created_by`, `product_line`, `product_model`', true)
    }
    await ensureIndex(conn, dbName, 'support_channels', 'idx_support_channels_creator_active', '`created_by`, `is_active`, `updated_at`')
    await ensureIndex(conn, dbName, 'videos', 'uq_video_external_source', '`source_provider`, `external_id`', true)
    if (!(await hasIndex(conn, dbName, 'video_qa_links', 'uq_vqa_action'))) {
      await conn.query(`DELETE newer FROM video_qa_links newer
        JOIN video_qa_links older
          ON newer.video_id = older.video_id
         AND newer.user_id = older.user_id
         AND newer.action = older.action
         AND newer.id > older.id`)
      await ensureIndex(conn, dbName, 'video_qa_links', 'uq_vqa_action', '`video_id`, `user_id`, `action`', true)
    }
    console.log(`数据库迁移完成: ${dbName}`)
  } finally {
    await conn.end()
  }
}

const invokedAsScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invokedAsScript) {
  runMigrations().catch(err => {
    console.error('数据库迁移失败:', err.message)
    process.exit(1)
  })
}
