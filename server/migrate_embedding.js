// 迁移 + 回填脚本：创建 document_chunks 表，并对现有已完成文档做切块 + 向量化写入。
// 用法（从项目根目录运行，确保能读到 .env）：node server/migrate_embedding.js
import pool from './db.js'
import { storeDocumentChunks } from './services/chunkStore.js'
import { warmupEmbedding, EMBED_MODEL_NAME } from './services/embedding.js'
import { runMigrations } from './migrate.js'

async function main() {
  console.log('== document_chunks 迁移 + 向量回填 ==')

  // 1. 先执行统一、幂等的结构迁移
  await runMigrations()
  console.log('✓ document_chunks 表已就绪')

  // 2. 预热模型
  console.log(`加载 embedding 模型 ${EMBED_MODEL_NAME} ...`)
  const ok = await warmupEmbedding()
  if (!ok) { console.error('✗ 模型加载失败，终止回填'); process.exit(1) }
  console.log('✓ 模型就绪')

  // 3. 回填所有已完成文档
  const [docs] = await pool.query(
    `SELECT id, user_id, original_name, content FROM documents WHERE status = 1 AND content IS NOT NULL`
  )
  console.log(`待回填文档数: ${docs.length}`)

  let total = 0
  for (const d of docs) {
    const t0 = Date.now()
    const n = await storeDocumentChunks(d.id, d.user_id, d.content)
    total += n
    console.log(`  [doc ${d.id}] ${d.original_name} -> ${n} 块，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }
  console.log(`✓ 回填完成，共写入 ${total} 个向量块`)
  process.exit(0)
}

main().catch(err => { console.error('迁移失败:', err); process.exit(1) })
