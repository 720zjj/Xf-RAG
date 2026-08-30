import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Readable, Writable } from 'node:stream'
import {
  buildComposeExecArgs,
  parseBackupOutputPath,
  runBackup
} from '../scripts/backup-mysql.js'
import {
  requireRestoreConfirmation,
  runRestore
} from '../scripts/restore-mysql.js'

const realBackupDirectory = {
  isDirectory: () => true,
  isSymbolicLink: () => false
}

test('未指定输出文件时会生成 backups 目录下的 SQL 备份绝对路径', () => {
  const outputPath = parseBackupOutputPath([], new Date(2026, 7, 30, 9, 8, 7))

  assert.match(outputPath, /backups[\\/]mysql-20260830-090807\.sql$/)
})

test('备份输出只接受真实 backups 目录下一层的 SQL 文件', () => {
  assert.throws(() => parseBackupOutputPath(['backups/nested/escape.sql']), /一层|backups/)
  assert.throws(() => parseBackupOutputPath(['other.sql']), /backups/)
  assert.match(parseBackupOutputPath(['backups/direct.sql']), /backups[\\/]direct\.sql$/)
})

test('已存在的备份输出会在创建目录或启动 Docker 前被拒绝', async () => {
  let mkdirCalled = false
  let spawnCalled = false

  await assert.rejects(
    runBackup(['backups/existing.sql'], {
      fsApi: {
        existsSync: () => true,
        mkdirSync: () => { mkdirCalled = true },
        lstatSync: () => realBackupDirectory,
        createWriteStream: () => { throw new Error('不应创建 SQL 文件') },
        statSync: () => ({ size: 1 }),
        unlinkSync: () => {}
      },
      spawn: () => { spawnCalled = true }
    }),
    /已存在/
  )

  assert.equal(mkdirCalled, false)
  assert.equal(spawnCalled, false)
})

test('符号链接或重解析 backups 目录会在写入或启动 Docker 前被拒绝', async () => {
  let createOutputCalled = false
  let spawnCalled = false

  await assert.rejects(
    runBackup(['backups/direct.sql'], {
      fsApi: {
        existsSync: path => !path.endsWith('direct.sql'),
        mkdirSync: () => { throw new Error('不应创建链接目录') },
        lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => true }),
        createWriteStream: () => { createOutputCalled = true },
        statSync: () => ({ size: 1 }),
        unlinkSync: () => {}
      },
      spawn: () => { spawnCalled = true }
    }),
    /符号链接|重解析/
  )

  assert.equal(createOutputCalled, false)
  assert.equal(spawnCalled, false)
})

test('备份脚本使用固定 Compose 前缀，模拟执行不会启动真实 Docker 或写入 SQL 文件', async () => {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    }
  })
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  let receivedCommand
  let receivedArgs
  let createdOutput
  const logs = []

  const resultPromise = runBackup([], {
    now: new Date(2026, 7, 30, 9, 8, 7),
    fsApi: {
      existsSync: () => false,
      mkdirSync: () => {},
      lstatSync: () => realBackupDirectory,
      createWriteStream: (path, options) => {
        createdOutput = { path, options }
        queueMicrotask(() => output.emit('open', 1))
        return output
      },
      statSync: () => ({ size: 4 }),
      unlinkSync: () => {}
    },
    spawn: (command, args) => {
      receivedCommand = command
      receivedArgs = args
      queueMicrotask(() => {
        child.stdout.end('sql\n')
        child.emit('close', 0)
      })
      return child
    },
    log: message => logs.push(message)
  })

  const outputPath = await resultPromise

  assert.equal(receivedCommand, 'docker')
  assert.deepEqual(receivedArgs.slice(0, 7), ['compose', '--env-file', '.env.compose', 'exec', '-T', 'mysql', 'sh'])
  assert.match(buildComposeExecArgs('mysqldump').join(' '), /docker compose --env-file .env.compose exec -T mysql/)
  assert.equal(createdOutput.options.flags, 'wx')
  assert.match(outputPath, /backups[\\/]mysql-20260830-090807\.sql$/)
  assert.equal(logs.length, 1)
})

test('备份会主动排空 MySQL 子进程的 stderr，避免错误输出阻塞', async () => {
  const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  const originalResume = child.stderr.resume.bind(child.stderr)
  let resumeCalls = 0
  child.stderr.resume = () => {
    resumeCalls += 1
    return originalResume()
  }

  const pending = runBackup(['backups/drain-stderr.sql'], {
    fsApi: {
      existsSync: () => false,
      mkdirSync: () => {},
      lstatSync: () => realBackupDirectory,
      createWriteStream: () => {
        queueMicrotask(() => output.emit('open', 1))
        return output
      },
      statSync: () => ({ size: 1 }),
      unlinkSync: () => {}
    },
    spawn: () => {
      queueMicrotask(() => {
        child.stderr.end('mysqldump diagnostic\\n')
        child.stdout.end('SELECT 1;')
        child.emit('close', 0)
      })
      return child
    },
    log: () => {}
  })

  await pending
  assert.equal(resumeCalls, 1)
})

test('备份子进程失败或生成空文件时会拒绝成功并清理本次输出', async () => {
  const removedPaths = []
  const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()

  const pending = runBackup([], {
    fsApi: {
      existsSync: () => false,
      mkdirSync: () => {},
      lstatSync: () => realBackupDirectory,
      createWriteStream: () => {
        queueMicrotask(() => output.emit('open', 1))
        return output
      },
      statSync: () => ({ size: 0 }),
      unlinkSync: path => removedPaths.push(path)
    },
    spawn: () => {
      queueMicrotask(() => {
        child.stdout.end()
        child.emit('close', 2)
      })
      return child
    },
    log: () => {}
  })

  await assert.rejects(pending, /退出码 2/)
  assert.equal(removedPaths.length, 1)
})

test('备份成功退出但 SQL 文件为空时仍会拒绝并清理本次输出', async () => {
  const removedPaths = []
  const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()

  const pending = runBackup([], {
    fsApi: {
      existsSync: () => false,
      mkdirSync: () => {},
      lstatSync: () => realBackupDirectory,
      createWriteStream: () => {
        queueMicrotask(() => output.emit('open', 1))
        return output
      },
      statSync: () => ({ size: 0 }),
      unlinkSync: path => removedPaths.push(path)
    },
    spawn: () => {
      queueMicrotask(() => {
        child.stdout.end()
        child.emit('close', 0)
      })
      return child
    },
    log: () => {}
  })

  await assert.rejects(pending, /文件为空/)
  assert.equal(removedPaths.length, 1)
})

test('备份子进程报错时会断开流、终止子进程并清理本次输出', async () => {
  const removedPaths = []
  const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => { child.killed = true }

  const pending = runBackup(['backups/error.sql'], {
    fsApi: {
      existsSync: () => false,
      mkdirSync: () => {},
      lstatSync: () => realBackupDirectory,
      createWriteStream: () => {
        queueMicrotask(() => output.emit('open', 1))
        return output
      },
      statSync: () => ({ size: 1 }),
      unlinkSync: path => removedPaths.push(path)
    },
    spawn: () => {
      queueMicrotask(() => child.emit('error', new Error('Docker 不可用')))
      return child
    },
    log: () => {}
  })

  await assert.rejects(pending, /Docker 不可用/)
  assert.equal(child.killed, true)
  assert.equal(child.stdout.destroyed, true)
  assert.equal(child.stderr.destroyed, true)
  assert.equal(output.destroyed, true)
  assert.equal(removedPaths.length, 1)
})

test('备份启动同步抛错时也会关闭输出并清理本次输出', async () => {
  const removedPaths = []
  const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })

  await assert.rejects(
    runBackup(['backups/spawn-throw.sql'], {
      fsApi: {
        existsSync: () => false,
        mkdirSync: () => {},
        lstatSync: () => realBackupDirectory,
        createWriteStream: () => {
          queueMicrotask(() => output.emit('open', 1))
          return output
        },
        statSync: () => ({ size: 1 }),
        unlinkSync: path => removedPaths.push(path)
      },
      spawn: () => { throw new Error('找不到 docker') },
      log: () => {}
    }),
    /找不到 docker/
  )

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(output.destroyed, true)
  assert.equal(removedPaths.length, 1)
})

test('备份标准输出或输出文件写入失败时会终止仍在运行的子进程', async () => {
  for (const failure of ['stdout', 'output']) {
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(failure === 'output' ? new Error('输出文件写入失败') : undefined)
      }
    })
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.killed = false
    child.kill = () => { child.killed = true }

    const pending = runBackup([`backups/${failure}-error.sql`], {
      fsApi: {
        existsSync: () => false,
        mkdirSync: () => {},
        lstatSync: () => realBackupDirectory,
        createWriteStream: () => {
          queueMicrotask(() => output.emit('open', 1))
          return output
        },
        statSync: () => ({ size: 1 }),
        unlinkSync: () => {}
      },
      spawn: () => {
        queueMicrotask(() => {
          if (failure === 'stdout') {
            child.stdout.destroy(new Error('标准输出读取失败'))
          } else {
            child.stdout.end('SELECT 1;')
          }
        })
        return child
      },
      log: () => {}
    })

    await assert.rejects(pending, failure === 'stdout' ? /标准输出读取失败/ : /输出文件写入失败/)
    assert.equal(child.killed, true)
    assert.equal(output.destroyed, true)
  }
})

test('恢复必须提供且只能提供明确确认标志', () => {
  assert.throws(() => requireRestoreConfirmation(['backup.sql']), /confirm-restore/)
  assert.throws(() => requireRestoreConfirmation(['backup.sql', '--force']), /confirm-restore/)
  assert.equal(requireRestoreConfirmation(['backup.sql', '--confirm-restore']), 'backup.sql')
})

test('恢复在确认前会拒绝不存在或非 SQL 文件，且不会启动 Docker', async () => {
  let spawnCalled = false
  const dependencies = {
    fsApi: {
      existsSync: () => false,
      statSync: () => ({ isFile: () => false }),
      createReadStream: () => { throw new Error('不应读取文件') }
    },
    spawn: () => { spawnCalled = true },
    warn: () => {}
  }

  await assert.rejects(runRestore(['missing.sql', '--confirm-restore'], dependencies), /不存在/)
  await assert.rejects(runRestore(['backup.txt', '--confirm-restore'], dependencies), /\.sql/)
  assert.equal(spawnCalled, false)
})

test('恢复只会把已确认的 SQL 内容流入 Compose 中的 mysql 客户端', async () => {
  const child = new EventEmitter()
  const received = []
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      received.push(chunk.toString())
      callback()
    },
    final(callback) {
      callback()
      queueMicrotask(() => child.emit('close', 0))
    }
  })
  let receivedCommand
  let receivedArgs
  const warnings = []

  const pending = runRestore(['backups/approved.sql', '--confirm-restore'], {
    fsApi: {
      existsSync: () => true,
      statSync: () => ({ isFile: () => true }),
      createReadStream: () => Readable.from(['SELECT 1;'])
    },
    spawn: (command, args) => {
      receivedCommand = command
      receivedArgs = args
      return child
    },
    warn: message => warnings.push(message)
  })

  await pending

  assert.equal(receivedCommand, 'docker')
  assert.match(receivedArgs.join(' '), /compose --env-file .env.compose exec -T mysql/)
  assert.deepEqual(received, ['SELECT 1;'])
  assert.match(warnings[0], /警告/)
})

test('恢复输入到子进程 stdin 失败时会关闭流并终止子进程', async () => {
  const child = new EventEmitter()
  child.killed = false
  child.kill = () => { child.killed = true }
  child.stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('EPIPE'))
    }
  })
  const input = Readable.from(['SELECT 1;'])

  const pending = runRestore(['backups/broken.sql', '--confirm-restore'], {
    fsApi: {
      existsSync: () => true,
      statSync: () => ({ isFile: () => true }),
      createReadStream: () => input
    },
    spawn: () => child,
    warn: () => {}
  })

  await assert.rejects(pending, /EPIPE/)
  assert.equal(child.killed, true)
  assert.equal(input.destroyed, true)
  assert.equal(child.stdin.destroyed, true)
})

test('恢复子进程报错时会关闭输入并终止子进程', async () => {
  const child = new EventEmitter()
  child.killed = false
  child.kill = () => { child.killed = true }
  child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const input = new PassThrough()

  const pending = runRestore(['backups/child-error.sql', '--confirm-restore'], {
    fsApi: {
      existsSync: () => true,
      statSync: () => ({ isFile: () => true }),
      createReadStream: () => input
    },
    spawn: () => {
      queueMicrotask(() => child.emit('error', new Error('Docker 不可用')))
      return child
    },
    warn: () => {}
  })

  await assert.rejects(pending, /Docker 不可用/)
  assert.equal(child.killed, true)
  assert.equal(input.destroyed, true)
  assert.equal(child.stdin.destroyed, true)
})

test('恢复读取输入失败、启动同步抛错或非零关闭时均不会报告成功', async () => {
  const cases = [
    {
      name: 'input',
      expected: /读取失败/,
      arrange({ input }) {
        queueMicrotask(() => input.destroy(new Error('读取失败')))
      }
    },
    {
      name: 'spawn',
      expected: /找不到 docker/,
      spawn: () => { throw new Error('找不到 docker') }
    },
    {
      name: 'close',
      expected: /退出码 3/,
      arrange({ input, child }) {
        input.end('SELECT 1;')
        queueMicrotask(() => child.emit('close', 3))
      }
    }
  ]

  for (const scenario of cases) {
    const child = new EventEmitter()
    child.killed = false
    child.kill = () => { child.killed = true }
    child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    const input = new PassThrough()
    const pending = runRestore([`backups/${scenario.name}.sql`, '--confirm-restore'], {
      fsApi: {
        existsSync: () => true,
        statSync: () => ({ isFile: () => true }),
        createReadStream: () => input
      },
      spawn: scenario.spawn || (() => {
        scenario.arrange?.({ input, child })
        return child
      }),
      warn: () => {}
    })

    await assert.rejects(pending, scenario.expected)
    assert.equal(input.destroyed, true)
    if (scenario.name !== 'spawn') {
      assert.equal(child.killed, true)
      assert.equal(child.stdin.destroyed, true)
    }
  }
})
