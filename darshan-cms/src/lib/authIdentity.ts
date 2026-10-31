/**
 * A refreshed cookie session may belong to another account after a login in a
 * second tab. Never apply that account's grants to the locally rendered user.
 */
export const isDifferentAuthenticatedUser = (
  localUserId?: string | null,
  refreshedUserId?: string | null,
): boolean => Boolean(localUserId && refreshedUserId && localUserId !== refreshedUserId);
