import path from 'node:path'

export function configureTransformersRuntime({ runtimeEnv = process.env, transformersEnv }) {
  const configuredDirectory = typeof runtimeEnv.MODEL_CACHE_DIR === 'string' ? runtimeEnv.MODEL_CACHE_DIR.trim() : ''
  if (!configuredDirectory) return undefined
  if (!transformersEnv || typeof transformersEnv !== 'object') throw new Error('Transformers 运行环境未配置')
  const cacheDir = path.resolve(configuredDirectory)
  transformersEnv.cacheDir = cacheDir
  return cacheDir
}
