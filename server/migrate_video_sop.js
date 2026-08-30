// 兼容旧命令：视频/SOP 表已纳入统一迁移。
import { runMigrations } from './migrate.js'

runMigrations().catch(err => {
  console.error('视频/SOP 迁移失败:', err.message)
  process.exit(1)
})
