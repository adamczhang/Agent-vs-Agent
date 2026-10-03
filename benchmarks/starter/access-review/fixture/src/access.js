export function canEdit(user, doc) {
  return user.role === 'admin' || user.id === doc.ownerId || doc.locked;
}

export function isExpired(session, now = Date.now()) {
  return session.expiresAt > now;
}
