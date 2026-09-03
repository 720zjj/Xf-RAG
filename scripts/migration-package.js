import { spawn as spawnProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const workspaceDirectory = resolve('.')
const backupDirectory = resolve('backups')
const defaultFs = {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
}

function timestampForFileName(now) {
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function isInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate)
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !resolve(pathFromParent).startsWith('\\'))
}

function assertRealDirectory(path, label, fsApi, { create = false } = {}) {
  if (!fsApi.existsSync(path) && create) {
    fsApi.mkdirSync(path, { recursive: true })
  }
  if (!fsApi.existsSync(path)) {
    throw new Error(`${label}不存在：${path}`)
  }

  const stats = fsApi.lstatSync(path)
  const isLink = stats.isSymbolicLink?.() || stats.isReparsePoint?.()
  if (!stats.isDirectory() || isLink) {
    throw new Error(`${label}必须是真实目录，不能是符号链接或重解析点`)
  }
}

export function parseMigrationPackageArgs(args, now = new Date()) {
  if (!Array.isArray(args) || args.length > 2) {
    throw new Error('迁移包命令最多接受环境文件和输出名称两个参数')
  }
  const envFile = args[0] || '.env'
  const prefix = args[1] || `migration-${timestampForFileName(now)}`

  if (!envFile || typeof envFile !== 'string') {
    throw new Error('必须指定环境文件')
  }
  if (!prefix || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(prefix)) {
    throw new Error('输出名称只能包含字母、数字、点、下划线和短横线，且最长 80 个字符')
  }

  const envPath = resolve(envFile)
  if (!isInside(workspaceDirectory, envPath)) {
    throw new Error('环境文件必须位于当前项目目录内')
  }

  return { envPath, prefix }
}

export function resolveUploadDirectory(uploadDir) {
  const candidate = resolve(uploadDir || 'uploads')
  if (!isInside(workspaceDirectory, candidate) || candidate === workspaceDirectory) {
    throw new Error('UPLOAD_DIR 必须位于当前项目目录内，且不能是项目根目录')
  }
  return candidate
}

function waitForChildExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('close', code => {
      if (code === 0) resolveExit()
      else rejectExit(new Error(`命令执行失败（退出码 ${code}）`))
    })
  })
}

async function hashFile(path, fsApi = defaultFs) {
  const hash = createHash('sha256')
  await pipeline(fsApi.createReadStream(path), hash)
  return hash.digest('hex')
}

export async function writeChecksum(path, fsApi = defaultFs) {
  const checksum = await hashFile(path, fsApi)
  const checksumPath = `${path}.sha256`
  fsApi.writeFileSync(checksumPath, `${checksum}  ${basename(path)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { checksum, checksumPath }
}

export async function verifyChecksum(path, fsApi = defaultFs) {
  const checksumPath = `${path}.sha256`
  if (!fsApi.existsSync(checksumPath)) {
    throw new Error(`缺少校验文件：${checksumPath}`)
  }
  const content = fsApi.readFileSync(checksumPath, 'utf8').trim()
  const match = /^([a-f0-9]{64})\s{2}(.+)$/i.exec(content)
  if (!match || match[2] !== basename(path)) {
    throw new Error(`校验文件格式或文件名不正确：${checksumPath}`)
  }
  const actual = await hashFile(path, fsApi)
  if (actual.toLowerCase() !== match[1].toLowerCase()) {
    throw new Error(`SHA-256 校验失败：${basename(path)}`)
  }
  return actual
}

function countFiles(path, fsApi = defaultFs) {
  let files = 0
  let bytes = 0
  const visit = currentPath => {
    for (const entry of fsApi.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = resolve(currentPath, entry.name)
      if (entry.isSymbolicLink?.()) {
        throw new Error(`上传目录包含符号链接，拒绝打包：${entryPath}`)
      }
      if (entry.isDirectory()) visit(entryPath)
      else if (entry.isFile()) {
        files += 1
        bytes += fsApi.statSync(entryPath).size
      }
    }
  }
  visit(path)
  return { files, bytes }
}

function assertOutputPathsAvailable(paths, fsApi) {
  const existing = paths.find(path => fsApi.existsSync(path))
  if (existing) throw new Error(`迁移包文件已存在，拒绝覆盖：${existing}`)
}

function removeCreatedFiles(paths, fsApi) {
  for (const path of paths) {
    try {
      if (fsApi.existsSync(path)) fsApi.unlinkSync(path)
    } catch {
      // 清理失败不能覆盖原始错误。
    }
  }
}

async function createSqlDump(path, config, { fsApi, spawn }) {
  const output = fsApi.createWriteStream(path, { flags: 'wx' })
  const args = [
    `--host=${config.DB_HOST}`,
    `--port=${config.DB_PORT}`,
    `--user=${config.DB_USER}`,
    '--single-transaction',
    '--routines',
    '--events',
    '--hex-blob',
    '--no-tablespaces',
    '--set-gtid-purged=OFF',
    '--default-character-set=utf8mb4',
    config.DB_NAME
  ]
  const child = spawn('mysqldump', args, {
    env: { ...process.env, MYSQL_PWD: config.DB_PASSWORD },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr?.setEncoding?.('utf8')
  child.stderr?.on?.('data', chunk => { stderr += chunk })
  await Promise.all([pipeline(child.stdout, output), waitForChildExit(child)]).catch(error => {
    child.kill?.()
    throw new Error(stderr.trim() || error.message)
  })
  if (fsApi.statSync(path).size === 0) throw new Error('MySQL 备份文件为空')
}

async function createUploadsArchive(path, uploadDirectory, { spawn }) {
  const child = spawn('tar', ['-czf', path, '-C', dirname(uploadDirectory), basename(uploadDirectory)], {
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let stderr = ''
  child.stderr?.setEncoding?.('utf8')
  child.stderr?.on?.('data', chunk => { stderr += chunk })
  await waitForChildExit(child).catch(error => {
    child.kill?.()
    throw new Error(stderr.trim() || error.message)
  })
}

export async function createMigrationPackage(args, {
  now = new Date(),
  fsApi = defaultFs,
  spawn = spawnProcess,
  log = console.log
} = {}) {
  const { envPath, prefix } = parseMigrationPackageArgs(args, now)
  if (!fsApi.existsSync(envPath) || !fsApi.statSync(envPath).isFile()) {
    throw new Error(`环境文件不存在或不是普通文件：${envPath}`)
  }
  const config = dotenv.parse(fsApi.readFileSync(envPath))
  const requiredKeys = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
  const missing = requiredKeys.filter(key => !String(config[key] || '').trim())
  if (missing.length) throw new Error(`环境文件缺少数据库配置：${missing.join(', ')}`)

  const uploadDirectory = resolveUploadDirectory(config.UPLOAD_DIR)
  assertRealDirectory(backupDirectory, 'backups 目录', fsApi, { create: true })
  assertRealDirectory(uploadDirectory, 'uploads 目录', fsApi)

  const sqlPath = resolve(backupDirectory, `${prefix}.sql`)
  const uploadsPath = resolve(backupDirectory, `${prefix}-uploads.tar.gz`)
  const manifestPath = resolve(backupDirectory, `${prefix}-manifest.json`)
  const outputPaths = [sqlPath, `${sqlPath}.sha256`, uploadsPath, `${uploadsPath}.sha256`, manifestPath]
  assertOutputPathsAvailable(outputPaths, fsApi)

  try {
    await createSqlDump(sqlPath, config, { fsApi, spawn })
    const sql = await writeChecksum(sqlPath, fsApi)
    const uploadStats = countFiles(uploadDirectory, fsApi)
    await createUploadsArchive(uploadsPath, uploadDirectory, { spawn })
    if (!fsApi.existsSync(uploadsPath) || fsApi.statSync(uploadsPath).size === 0) {
      throw new Error('uploads 压缩包为空或未生成')
    }
    const uploads = await writeChecksum(uploadsPath, fsApi)
    const manifest = {
      formatVersion: 1,
      createdAt: now.toISOString(),
      databaseName: config.DB_NAME,
      uploads: uploadStats,
      files: {
        database: { name: basename(sqlPath), bytes: fsApi.statSync(sqlPath).size, sha256: sql.checksum },
        uploads: { name: basename(uploadsPath), bytes: fsApi.statSync(uploadsPath).size, sha256: uploads.checksum }
      }
    }
    fsApi.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    log(`迁移包已生成：${manifestPath}`)
    return { sqlPath, uploadsPath, manifestPath, manifest }
  } catch (error) {
    removeCreatedFiles(outputPaths, fsApi)
    throw error
  }
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedAsScript) {
  createMigrationPackage(process.argv.slice(2)).catch(error => {
    console.error(`迁移包生成失败：${error.message}`)
    process.exitCode = 1
  })
}
