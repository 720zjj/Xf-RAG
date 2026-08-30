// 兼容旧命令：MinerU 字段已纳入统一迁移。
import { runMigrations } from './migrate.js'

runMigrations().catch(err => {
  console.error('MinerU 字段迁移失败:', err.message)
  process.exit(1)
})
