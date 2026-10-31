import { config } from '@/config';
import { getRealtimeFanoutState } from '@/realtime/realtime-fanout';
import { disconnectAuthenticatedUserSockets } from '@/realtime/socket-server';
import { createLogger } from '@/utils/logger';

const logger = createLogger('session-invalidation');

function invalidationMessage(userIds: string[], sentAt: string) {
  return { type: 'USER_SESSIONS_INVALIDATED' as const, user_ids: userIds, sent_at: sentAt };
}

export function disconnectInvalidatedUsers(userIds: readonly string[]): number {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  for (const userId of uniqueIds) disconnectAuthenticatedUserSockets(userId);
  return uniqueIds.length;
}

export async function broadcastSessionInvalidation(userIds: readonly string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  disconnectInvalidatedUsers(uniqueIds);
  const sentAt = new Date().toISOString();
  const bus = getRealtimeFanoutState().bus;
  const emptyMessageBytes = Buffer.byteLength(JSON.stringify(invalidationMessage([], sentAt)), 'utf8');
  let publishedUsers = 0;
  async function publishBatch(ids: string[]): Promise<boolean> {
    let result: Awaited<ReturnType<typeof bus.publishBroadcast>>;
    try {
      result = await bus.publishBroadcast(invalidationMessage(ids, sentAt));
    } catch (error) {
      logger.warn(
        { err: error, affectedUsers: uniqueIds.length, publishedUsers },
        'Session invalidation broadcast threw; revoked database sessions remain authoritative'
      );
      return false;
    }
    if (result.status !== 'published') {
      logger.warn(
        { status: result.status, affectedUsers: uniqueIds.length, publishedUsers },
        'Session invalidation broadcast incomplete; revoked database sessions remain authoritative'
      );
      return false;
    }
    publishedUsers += ids.length;
    return true;
  }
  let batch: string[] = [];
  let batchBytes = emptyMessageBytes;
  for (const userId of uniqueIds) {
    const idBytes = Buffer.byteLength(JSON.stringify(userId), 'utf8');
    const addition = idBytes + (batch.length > 0 ? 1 : 0);
    if (batchBytes + addition <= config.WS_NOTIFICATION_MAX_BYTES) {
      batch.push(userId);
      batchBytes += addition;
      continue;
    }
    if (batch.length > 0) {
      if (!(await publishBatch(batch))) return;
      batch = [];
      batchBytes = emptyMessageBytes;
    }
    if (batchBytes + idBytes <= config.WS_NOTIFICATION_MAX_BYTES) {
      batch.push(userId);
      batchBytes += idBytes;
    } else {
      logger.error({ idBytes, maxBytes: config.WS_NOTIFICATION_MAX_BYTES }, 'Session invalidation ID exceeds bus payload limit');
    }
  }
  if (batch.length > 0) await publishBatch(batch);
}
