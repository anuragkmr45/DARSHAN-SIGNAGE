import { config } from '../config/index.js';
import { schema } from '../db/index.js';
export async function createCommandOutboxEvent(tx, input) {
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
