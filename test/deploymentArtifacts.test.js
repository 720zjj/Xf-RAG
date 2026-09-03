import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const readRepositoryFile = (path) => readFileSync(resolve(repositoryRoot, path), 'utf8')

test('部署所需的 Docker 与 Compose 文件均存在', () => {
  for (const artifact of [
    'Dockerfile',
    '.dockerignore',
    'docker-compose.yml',
    'deploy/.env.compose.example'
  ]) {
    assert.equal(existsSync(resolve(repositoryRoot, artifact)), true, `${artifact} 应存在`)
  }
})

test('Compose 拓扑持久化服务并让应用等待迁移完成', () => {
  const compose = readRepositoryFile('docker-compose.yml')

  for (const fragment of [
    'mysql:8.4',
    'redis:7',
    'migrate:',
    'api:',
    'worker:',
    'uploads-data:',
    'model-cache:',
    'DB_HOST: mysql',
    'REDIS_URL: redis://redis:6379',
    'condition: service_completed_successfully'
  ]) {
    assert.match(compose, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('迁移容器使用 MySQL 根账号，运行中的 API 和 Worker 保留应用账号', () => {
  const compose = readRepositoryFile('docker-compose.yml')

  assert.match(
    compose,
    /migrate:[\s\S]*?environment:\s*\n\s+<<: \*app-environment\s*\n\s+DB_USER: root\s*\n\s+DB_PASSWORD: \$\{MYSQL_ROOT_PASSWORD\}/
  )
  assert.match(compose, /DB_USER: \$\{MYSQL_APP_USER\}/)
})

test('MySQL 就绪检查通过 TCP 等待正式数据库端口', () => {
  const compose = readRepositoryFile('docker-compose.yml')

  assert.match(
    compose,
    /mysqladmin ping -h 127\.0\.0\.1 --protocol=TCP/
  )
})

test('Dockerfile 使用 Node 22 Debian 多阶段镜像及精简生产依赖', () => {
  const dockerfile = readRepositoryFile('Dockerfile')

  assert.match(dockerfile, /FROM node:22-bookworm-slim AS build/)
  assert.match(dockerfile, /npm ci --omit=dev/)
  assert.match(dockerfile, /--mount=type=cache,target=\/root\/\.npm/)
})

test('Docker 构建上下文排除本机数据、日志、备份和个人工作产物', () => {
  const dockerignore = readRepositoryFile('.dockerignore')

  for (const entry of [
    '.env*',
    'uploads',
    'backups',
    'logs',
    '.runtime',
    '.tmp-recovery-audit',
    'report',
    'browser-*.png',
    'step*.png'
  ]) {
    assert.equal(dockerignore.split(/\r?\n/).includes(entry), true, `${entry} 应从 Docker 构建上下文排除`)
  }
  assert.match(dockerignore, /^!deploy\/\.env\.compose\.example$/m)
})

test('npm 提供 Compose 配置校验脚本', () => {
  const packageJson = JSON.parse(readRepositoryFile('package.json'))

  assert.equal(packageJson.scripts['compose:config'], 'docker compose --env-file deploy/.env.compose.example config')
})

test('Compose 环境模板包含必要变量且不含真实凭据', () => {
  const environmentTemplate = readRepositoryFile('deploy/.env.compose.example')

  for (const variable of [
    'MYSQL_ROOT_PASSWORD',
    'MYSQL_APP_USER',
    'MYSQL_APP_PASSWORD',
    'JWT_SECRET',
    'PUBLIC_APP_URL',
    'APP_BIND_ADDRESS',
    'TRUST_PROXY'
  ]) {
    assert.match(environmentTemplate, new RegExp(`^${variable}=`, 'm'))
  }

  assert.doesNotMatch(environmentTemplate, /sk-[A-Za-z0-9_-]{16,}/)
  assert.doesNotMatch(environmentTemplate, /AKIA[0-9A-Z]{16}/)
})

test('环境模板明确要求生产 CORS 来源与公开二维码地址匹配', () => {
  const environmentTemplate = readRepositoryFile('deploy/.env.compose.example')

  assert.match(environmentTemplate, /生产环境[\s\S]*?CORS_ORIGINS[\s\S]*?PUBLIC_APP_URL/)
})

test('本机开发环境模板说明 Docker 模型缓存目录', () => {
  const environmentTemplate = readRepositoryFile('.env.example')

  assert.match(environmentTemplate, /# Docker Compose 部署时使用容器内持久化模型缓存目录\r?\nMODEL_CACHE_DIR=\/data\/models/)
})
