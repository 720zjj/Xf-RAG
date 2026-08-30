export function canManageDocument(document) {
  return Boolean(Number(document?.is_owner))
}

export function documentScopeLabel(document) {
  return document?.scope === 'public' ? '公共知识库' : '我的文档'
}
