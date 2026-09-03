import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMigrationPackageArgs, resolveUploadDirectory, verifyChecksum, writeChecksum } from '../scripts/migration-package.js'

test('迁移包只接受项目内环境文件和安全输出前缀', () => {
  const parsed = parseMigrationPackageArgs(['.env', 'aliyun-20260902'])
  assert.match(parsed.envPath, /a2[\\/]\.env$/)
  assert.equal(parsed.prefix, 'aliyun-20260902')
  assert.throws(() => parseMigrationPackageArgs(['..\\outside.env']), /项目目录/)
  assert.throws(() => parseMigrationPackageArgs(['.env', '..\\escape']), /输出名称/)
  assert.throws(() => parseMigrationPackageArgs(['.env', 'one', 'extra']), /最多接受/)
})

test('uploads 只能位于项目内部且不能指向项目根目录', () => {
  assert.match(resolveUploadDirectory('./uploads'), /a2[\\/]uploads$/)
  assert.throws(() => resolveUploadDirectory('.'), /项目根目录/)
  assert.throws(() => resolveUploadDirectory('..\\outside'), /项目目录/)
})

test('SHA-256 校验文件可验证原文件并能发现文件被修改', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migration-checksum-'))
  const file = join(directory, 'sample.sql')
  try {
    writeFileSync(file, 'SELECT 1;\n')
    const { checksumPath, checksum } = await writeChecksum(file)
    assert.equal(await verifyChecksum(file), checksum)
    assert.match(readFileSync(checksumPath, 'utf8'), /^[a-f0-9]{64} {2}sample\.sql\n$/)

    writeFileSync(file, 'SELECT 2;\n')
    await assert.rejects(verifyChecksum(file), /校验失败/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('缺失或指向其他文件的校验信息会被拒绝', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migration-checksum-'))
  const file = join(directory, 'sample.sql')
  try {
    writeFileSync(file, 'SELECT 1;\n')
    await assert.rejects(verifyChecksum(file), /缺少校验文件/)
    writeFileSync(`${file}.sha256`, `${'0'.repeat(64)}  other.sql\n`)
    await assert.rejects(verifyChecksum(file), /格式或文件名/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
