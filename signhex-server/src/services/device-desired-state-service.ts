import { sql } from 'drizzle-orm';
import { config } from '@/config';
import { getDatabase, schema } from '@/db';

export type DesiredStateCommandInput = {
  screenId: string;
  commandId: string;
  commandType: string;
  commandReason?: string | null;
  snapshotId?: string | null;
  defaultMediaVersion?: string | null;
  emergencyVersion?: string | null;
  metadata?: unknown;
};

export async function recordDesiredStateForCommand(tx: any, input: DesiredStateCommandInput) {
  if (!config.DEVICE_DESIRED_STATE_ENABLED) {
    return null;
  }

  const now = new Date();
  const [state] = await tx
    .insert(schema.deviceDesiredState)
    .values({
      screen_id: input.screenId,
      snapshot_id: input.snapshotId ?? null,
      default_media_version: input.defaultMediaVersion ?? null,
      emergency_version: input.emergencyVersion ?? null,
      command_version: 1,
      state_version: 1,
      last_command_id: input.commandId,
      last_command_type: input.commandType,
      last_command_reason: input.commandReason ?? null,
      last_changed_reason: input.commandReason ?? 'COMMAND_AVAILABLE',
      metadata: input.metadata ?? null,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: schema.deviceDesiredState.screen_id,
      set: {
        snapshot_id:
          input.snapshotId === undefined
            ? sql`COALESCE(${schema.deviceDesiredState.snapshot_id}, excluded.snapshot_id)`
            : input.snapshotId,
        default_media_version:
          input.defaultMediaVersion === undefined
            ? sql`COALESCE(${schema.deviceDesiredState.default_media_version}, excluded.default_media_version)`
            : input.defaultMediaVersion,
        emergency_version:
          input.emergencyVersion === undefined
            ? sql`COALESCE(${schema.deviceDesiredState.emergency_version}, excluded.emergency_version)`
            : input.emergencyVersion,
        command_version: sql`${schema.deviceDesiredState.command_version} + 1`,
        state_version: sql`${schema.deviceDesiredState.state_version} + 1`,
        last_command_id: input.commandId,
        last_command_type: input.commandType,
        last_command_reason: input.commandReason ?? null,
        last_changed_reason: input.commandReason ?? 'COMMAND_AVAILABLE',
        metadata: input.metadata ?? null,
        updated_at: now,
      },
    })
    .returning();

  if (state) {
    await tx.insert(schema.deviceDesiredStateHistory).values({
      screen_id: state.screen_id,
      state_version: state.state_version,
      command_version: state.command_version,
      snapshot_id: state.snapshot_id,
      default_media_version: state.default_media_version,
      emergency_version: state.emergency_version,
      command_id: input.commandId,
      reason: input.commandReason ?? 'COMMAND_AVAILABLE',
      metadata: input.metadata ?? null,
      created_at: now,
    });
  }

  return state ?? null;
}

export async function getDeviceDesiredState(screenId: string) {
  const db = getDatabase();
  const [state] = await db
    .select()
    .from(schema.deviceDesiredState)
    .where(sql`${schema.deviceDesiredState.screen_id} = ${screenId}`);

  return state ?? null;
}
