import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
dotenv.config()

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'iflytek_translator',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true
})

export async function checkDatabase() {
  await pool.query('SELECT 1')
  return true
}

export async function closeDatabase() {
  await pool.end()
}

export default pool
