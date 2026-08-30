import { spawn as spawnProcess } from 'node:child_process'
import { createWriteStream, existsSync, lstatSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const backupDirectory = resolve('backups')

const defaultFs = { createWriteStream, existsSync, lstatSync, mkdirSync, statSync, unlinkSync }

function timestampForFileName(now) {
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export function parseBackupOutputPath(args, now = new Date()) {
  if (!Array.isArray(args) || args.length > 1) {
    throw new Error('备份命令最多只能指定一个输出文件名')
  }

  const requestedPath = args[0] || `backups/mysql-${timestampForFileName(now)}.sql`
  if (typeof requestedPath !== 'string' || !requestedPath.endsWith('.sql')) {
    throw new Error('备份输出必须是 backups 目录下的 .sql 文件')
  }

  const outputPath = resolve(requestedPath)
  if (dirname(outputPath) !== backupDirectory) {
    throw new Error('备份输出必须是 backups 目录下一层的 .sql 文件')
  }

  return outputPath
}

export function buildComposeExecArgs(command) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('必须提供容器内执行的命令')
  }

  return ['docker', 'compose', '--env-file', '.env.compose', 'exec', '-T', 'mysql', 'sh', '-lc', command]
}

function waitForChildExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('close', code => resolveExit(code))
  })
}

function assertRealBackupDirectory(fsApi) {
  if (!fsApi.existsSync(backupDirectory)) {
    fsApi.mkdirSync(backupDirectory, { recursive: true })
  }

  const directoryStats = fsApi.lstatSync(backupDirectory)
  const isLink = directoryStats.isSymbolicLink?.() || directoryStats.isReparsePoint?.()
  if (!directoryStats.isDirectory() || isLink) {
    throw new Error('backups 目录不能是符号链接、重解析点或非目录')
  }
}

function safelyDestroy(stream) {
  if (typeof stream?.destroy !== 'function' || stream.destroyed) {
    return
  }

  try {
    stream.destroy()
  } catch {
    // 清理失败不能覆盖原始命令或流错误。
  }
}

function safelyTerminate(child) {
  if (typeof child?.kill !== 'function' || child.killed) {
    return
  }

  try {
    child.kill()
  } catch {
    // 清理失败不能覆盖原始命令或流错误。
  }
}

function createOutputCleanup(fsApi, outputPath, output) {
  let createdByThisRun = false
  let cleanupRequested = false
  let removed = false

  const removeIncompleteBackup = () => {
    if (!cleanupRequested || !createdByThisRun || removed) {
      return
    }

    try {
      fsApi.unlinkSync(outputPath)
      removed = true
    } catch {
      // 写入流关闭后会再尝试一次；始终保留原始错误。
    }
  }

  output.once('open', () => {
    createdByThisRun = true
    removeIncompleteBackup()
  })
  output.once('close', removeIncompleteBackup)
  output.on('error', () => {})

  return {
    cleanup() {
      cleanupRequested = true
      safelyDestroy(output)
      removeIncompleteBackup()
    }
  }
}

function cleanupBackupResources(child, output, outputCleanup) {
  try {
    child?.stdout?.unpipe?.(output)
  } catch {
    // 清理失败不能覆盖原始命令或流错误。
  }
  safelyDestroy(child?.stdout)
  safelyDestroy(child?.stderr)
  outputCleanup.cleanup()
  safelyTerminate(child)
}

export async function runBackup(args, {
  now = new Date(),
  fsApi = defaultFs,
  spawn = spawnProcess,
  log = console.log
} = {}) {
  const outputPath = parseBackupOutputPath(args, now)
  if (fsApi.existsSync(outputPath)) {
    throw new Error(`备份输出已存在，拒绝覆盖：${outputPath}`)
  }

  assertRealBackupDirectory(fsApi)
  const output = fsApi.createWriteStream(outputPath, { flags: 'wx' })
  const outputCleanup = createOutputCleanup(fsApi, outputPath, output)
  const [binary, ...composeArgs] = buildComposeExecArgs(
    'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --events "$MYSQL_DATABASE"'
  )
  let child

  try {
    child = spawn(binary, composeArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    if (!child?.stdout) {
      throw new Error('无法启动 MySQL 备份命令')
    }
    child.stderr?.on?.('error', () => {})
    child.stderr?.resume?.()

    const transfer = pipeline(child.stdout, output)
    const exit = waitForChildExit(child).then(exitCode => {
      if (exitCode !== 0) {
        throw new Error(`MySQL 备份命令失败（退出码 ${exitCode}）`)
      }
      return exitCode
    })
    await Promise.all([exit, transfer])

    if (fsApi.statSync(outputPath).size === 0) {
      throw new Error('MySQL 备份失败：生成的 SQL 文件为空')
    }
  } catch (error) {
    cleanupBackupResources(child, output, outputCleanup)
    throw error
  }

  log(`MySQL 备份完成：${outputPath}`)
  return outputPath
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedAsScript) {
  runBackup(process.argv.slice(2)).catch(error => {
    console.error(`MySQL 备份失败：${error.message}`)
    process.exitCode = 1
  })
}
