/**
 * Generate a consistent anonymous identifier from a user ID.
 * Returns "Bruker #XXXX" where XXXX is derived from the UUID.
 */
export function anonymizeUser(userId: string): string {
  const hash = userId.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `Bruker #${hash}`;
}

export function staffOrAnon(user: { id: string; role?: string | null; display_name?: string | null }): string {
  const isStaff = user.role === 'admin' || user.role === 'moderator';
  return isStaff ? (user.display_name ?? anonymizeUser(user.id)) : anonymizeUser(user.id);
}
