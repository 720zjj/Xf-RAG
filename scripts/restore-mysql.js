import { spawn as spawnProcess } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { buildComposeExecArgs } from './backup-mysql.js'

const defaultFs = { createReadStream, existsSync, statSync }

export function requireRestoreConfirmation(args) {
  if (!Array.isArray(args) || args.length !== 2 || args[1] !== '--confirm-restore') {
    throw new Error('恢复数据库必须在备份文件后明确传入 --confirm-restore')
  }

  return args[0]
}

function waitForChildExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('close', code => resolveExit(code))
  })
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

function cleanupRestoreResources(input, child) {
  try {
    input?.unpipe?.(child?.stdin)
  } catch {
    // 清理失败不能覆盖原始命令或流错误。
  }
  safelyDestroy(input)
  safelyDestroy(child?.stdin)
  safelyTerminate(child)
}

export async function runRestore(args, {
  fsApi = defaultFs,
  spawn = spawnProcess,
  warn = console.warn
} = {}) {
  const requestedPath = requireRestoreConfirmation(args)
  if (typeof requestedPath !== 'string' || !requestedPath.endsWith('.sql')) {
    throw new Error('恢复文件必须是 .sql 文件')
  }

  const inputPath = resolve(requestedPath)
  if (!fsApi.existsSync(inputPath)) {
    throw new Error(`恢复文件不存在：${inputPath}`)
  }
  if (!fsApi.statSync(inputPath).isFile()) {
    throw new Error(`恢复文件不是普通文件：${inputPath}`)
  }

  warn(`警告：即将把 ${inputPath} 导入 MySQL。该操作可能修改现有数据，请确认已完成备份。`)
  const input = fsApi.createReadStream(inputPath)
  input.on('error', () => {})
  const [binary, ...composeArgs] = buildComposeExecArgs(
    'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
  )
  let child

  try {
    child = spawn(binary, composeArgs, { stdio: ['pipe', 'inherit', 'inherit'] })
    if (!child?.stdin) {
      throw new Error('无法启动 MySQL 恢复命令')
    }
    child.stdin.on('error', () => {})

    const transfer = pipeline(input, child.stdin)
    const exit = waitForChildExit(child).then(exitCode => {
      if (exitCode !== 0) {
        throw new Error(`MySQL 恢复命令失败（退出码 ${exitCode}）`)
      }
      return exitCode
    })
    await Promise.all([exit, transfer])
  } catch (error) {
    cleanupRestoreResources(input, child)
    throw error
  }

  return inputPath
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedAsScript) {
  runRestore(process.argv.slice(2)).catch(error => {
    console.error(`MySQL 恢复失败：${error.message}`)
    process.exitCode = 1
  })
}
