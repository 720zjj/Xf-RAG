export function getConfiguredAdminUsernames(raw = process.env.ADMIN_USERNAMES || '') {
  return [...new Set(
    String(raw)
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  )]
}

export function canReadKnowledgeDocument(
  { userId, ownerId, ownerUsername, status },
  raw = process.env.ADMIN_USERNAMES || ''
) {
  if (Number(userId) === Number(ownerId)) return true
  return Number(status) === 1 && getConfiguredAdminUsernames(raw).includes(ownerUsername)
}

export function buildKnowledgeScope(
  userId,
  { documentAlias = 'd', ownerAlias = 'owner' } = {},
  raw = process.env.ADMIN_USERNAMES || ''
) {
  const adminUsernames = getConfiguredAdminUsernames(raw)
  if (adminUsernames.length === 0) {
    return { where: `${documentAlias}.user_id = ?`, params: [userId] }
  }
  return {
    where: `(${documentAlias}.user_id = ? OR (${ownerAlias}.username IN (?) AND ${documentAlias}.status = 1))`,
    params: [userId, adminUsernames]
  }
}
