import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('管理员视频工坊提供官方目录预览和勾选导入', () => {
  const component = fs.readFileSync(new URL('../src/OfficialVideoImporter.jsx', import.meta.url), 'utf8')
  const studio = fs.readFileSync(new URL('../src/SopVideoStudio.jsx', import.meta.url), 'utf8')

  assert.match(studio, /<OfficialVideoImporter api=\{api\}/)
  assert.match(component, /\/video\/official-catalog/)
  assert.match(component, /\/video\/official-catalog\/import/)
  assert.match(component, /externalIds:\s*\[\.\.\.selectedIds\]/)
  assert.match(component, /现有本地视频未被修改/)
  assert.doesNotMatch(component, /videoUrl:\s*item\.videoUrl/)
})
