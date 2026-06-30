import { config } from '@/config';
import { schema } from '@/db';

export type CommandOutboxEventType = 'COMMAND_AVAILABLE' | 'DESIRED_STATE_CHANGED' | 'RESYNC_REQUIRED';

export type CreateCommandOutboxEventInput = {
  screenId: string;
  commandId?: string | null;
  eventType: CommandOutboxEventType;
  reason?: string | null;
  payload?: unknown;
  priority?: number | null;
  availableAt?: Date | null;
  maxAttempts?: number | null;
};

export async function createCommandOutboxEvent(tx: any, input: CreateCommandOutboxEventInput) {
  if (!config.COMMAND_OUTBOX_WRITE_ENABLED) {
    return null;
  }

  const [event] = await tx
    .insert(schema.commandOutbox)
    .values({
      screen_id: input.screenId,
      command_id: input.commandId ?? null,
      event_type: input.eventType,
      reason: input.reason ?? null,
      payload: input.payload ?? null,
      priority: input.priority ?? 0,
      available_at: input.availableAt ?? new Date(),
      max_attempts: input.maxAttempts ?? config.COMMAND_MAX_ATTEMPTS,
    })
    .returning();

  return event;
}
