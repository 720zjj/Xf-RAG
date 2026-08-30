import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const readProjectFile = filename => fs.readFileSync(path.join(testDir, '..', filename), 'utf8')

test('support QR documentation gives operators the authenticated release procedure', () => {
  const envExample = readProjectFile('.env.example')
  const readme = readProjectFile('README.md')

  assert.match(envExample, /# 开发：http:\/\/localhost:3000；生产必须填写 HTTPS 域名\r?\nPUBLIC_APP_URL=http:\/\/localhost:3000/)
  assert.match(readme, /PUBLIC_APP_URL/)
  assert.match(readme, /ADMIN_USERNAMES/)
  assert.match(readme, /ADMIN_REGISTRATION_KEY/)
  assert.match(readme, /JWT_SECRET/)
  assert.match(readme, /npm run db:migrate/)
  assert.match(readme, /\/support\/<channelCode>/)
  assert.match(readme, /普通.*测试.*账号|测试.*普通.*账号/)
  assert.match(readme, /创建.*下载.*二维码|创建.*二维码.*下载/)
  assert.match(readme, /二维码不是身份凭证/)
  assert.match(readme, /HTTPS/)
  assert.match(readme, /数据库备份/)
  assert.match(readme, /一个.*管理员.*产品线.*产品型号.*二维码入口|一.*管理员.*产品线.*产品型号.*二维码入口/)
  assert.match(readme, /停用.*轮换.*不可用|不可用.*停用.*轮换/)
  assert.match(readme, /403/)
})

test('Docker deployment documentation distinguishes local, LAN, and public QR operation', () => {
  const readme = readProjectFile('README.md')

  assert.match(readme, /实际.*用户.*部署配置|用户.*实际.*部署配置/)
  assert.match(readme, /docker compose --env-file \.env\.compose config/)
  assert.match(readme, /docker compose --env-file \.env\.compose up --build -d/)
  assert.match(readme, /http:\/\/localhost:3000/)
  assert.match(readme, /APP_BIND_ADDRESS=0\.0\.0\.0/)
  assert.match(readme, /npm run db:backup/)
  assert.match(readme, /npm run db:restore -- backups\/file\.sql -- --confirm-restore/)
  assert.match(readme, /局域网.*HTTP.*仅.*测试|HTTP.*局域网.*仅.*测试/)
  assert.match(readme, /公网.*二维码.*HTTPS|HTTPS.*公网.*二维码/)
})

test('existing deployment backup guidance precedes automatic migration startup', () => {
  const readme = readProjectFile('README.md')
  const upgradeBackupStart = readme.indexOf('已有数据的部署升级')
  const backupCommand = readme.indexOf('npm run db:backup', upgradeBackupStart)
  const actualConfigValidation = readme.indexOf('docker compose --env-file .env.compose config')
  const composeUp = readme.indexOf('npm run compose:up')

  assert.ok(upgradeBackupStart >= 0, 'README 应提供已有数据的部署升级步骤')
  assert.ok(backupCommand > upgradeBackupStart, '升级步骤应要求备份')
  assert.ok(actualConfigValidation >= 0, 'README 应校验用户实际填写的 Compose 配置')
  assert.ok(backupCommand < actualConfigValidation, '已有数据升级的备份必须发生在实际配置校验之前')
  assert.ok(actualConfigValidation < composeUp, '实际配置校验必须发生在 Compose 启动之前')
})

test('fresh installation copies the template while upgrades preserve existing Compose configuration', () => {
  const readme = readProjectFile('README.md')
  const freshInstall = readme.indexOf('全新安装')
  const templateCopy = readme.indexOf('copy deploy\\.env.compose.example .env.compose')
  const upgrade = readme.indexOf('已有数据的部署升级')

  assert.ok(freshInstall >= 0, 'README 应明确标记全新安装分支')
  assert.ok(templateCopy > freshInstall, '模板复制只能出现在全新安装分支')
  assert.ok(upgrade > templateCopy, '已有数据升级应与全新安装分支分开说明')
  assert.match(readme, /已有数据的部署升级[\s\S]*?不要复制或覆盖现有的 `\.env\.compose`/)
  assert.match(readme, /对照更新后的模板.*只.*新增.*变量|只.*新增.*变量.*对照更新后的模板/)
})

test('Docker documentation explains mirror configuration when registry is unreachable', () => {
  const readme = readProjectFile('README.md')

  assert.match(readme, /registry-mirrors/)
  assert.match(readme, /镜像加速|镜像源/)
  assert.match(readme, /docker pull node:22-bookworm-slim/)
})
