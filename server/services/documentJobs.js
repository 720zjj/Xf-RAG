import pool from '../db.js'

/** 将进程重启或超时遗留的处理中任务显式标记为失败，避免永久卡死。 */
export async function recoverStaleDocumentJobs(staleMinutes = 10) {
  const minutes = Math.max(1, Math.floor(Number(staleMinutes) || 10))
  const [result] = await pool.query(
    `UPDATE documents
       SET status = 2,
           processing_started_at = NULL,
           error_message = '解析任务因服务重启或超时中断，请重新解析'
     WHERE status = 0
       AND processing_started_at IS NOT NULL
       AND processing_started_at < DATE_SUB(NOW(), INTERVAL ${minutes} MINUTE)`
  )
  return result.affectedRows || 0
}
