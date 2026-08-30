import pool from './db.js'
import { storeDocumentChunks } from './services/chunkStore.js'

async function reindexReadyDocuments() {
  const [documents] = await pool.query(
    'SELECT id, user_id, original_name, content FROM documents WHERE status = 1 ORDER BY id'
  )
  const results = []

  for (const document of documents) {
    try {
      const chunkCount = await storeDocumentChunks(document.id, document.user_id, document.content)
      await pool.query('UPDATE documents SET chunk_count = ? WHERE id = ?', [chunkCount, document.id])
      results.push({ id: document.id, name: document.original_name, chunks: chunkCount, status: 'ok' })
      console.log(`[reindex] ${document.id} ${document.original_name}: ${chunkCount} chunks`)
    } catch (error) {
      results.push({ id: document.id, name: document.original_name, chunks: 0, status: error.message })
      console.error(`[reindex] ${document.id} failed: ${error.message}`)
    }
  }

  console.table(results)
  if (results.some(result => result.status !== 'ok')) process.exitCode = 1
}

try {
  await reindexReadyDocuments()
} finally {
  await pool.end()
}
