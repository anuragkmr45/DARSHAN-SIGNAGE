import { getRealtimeFanoutState } from '@/realtime/realtime-fanout';
import { disconnectAuthenticatedUserSockets } from '@/realtime/socket-server';

export function disconnectInvalidatedUsers(userIds: readonly string[]): number {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  for (const userId of uniqueIds) disconnectAuthenticatedUserSockets(userId);
  return uniqueIds.length;
}

export async function broadcastSessionInvalidation(userIds: readonly string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  disconnectInvalidatedUsers(uniqueIds);
  await getRealtimeFanoutState().bus.publishBroadcast({
    type: 'USER_SESSIONS_INVALIDATED',
    user_ids: uniqueIds,
    sent_at: new Date().toISOString(),
  });
}
