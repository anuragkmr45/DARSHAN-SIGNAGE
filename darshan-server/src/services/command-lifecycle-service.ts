import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { config } from '@/config';
import { getDatabase, schema, type Database } from '@/db';
import { recordDesiredStateForCommand } from '@/services/device-desired-state-service';
import { AppError } from '@/utils/app-error';

export const COMMAND_PRIORITY_NORMAL = 0;
export const COMMAND_PRIORITY_CRITICAL = 100;

const ACTIVE_LEASE_STATUSES = ['SENT', 'LEASED', 'PROCESSING'] as const;
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'ACKED_SUCCESS', 'ACKED_FAILURE', 'EXPIRED', 'DEAD_LETTER', 'CANCELLED'] as const;
type DeviceCommandRecord = typeof schema.deviceCommands.$inferSelect;
type DeviceDesiredStateRecord = typeof schema.deviceDesiredState.$inferSelect;
type CommandLifecycleTx = Pick<Database, 'insert' | 'update' | 'select' | 'execute'>;

type CommandStatus =
  | 'PENDING'
  | 'SENT'
  | 'ACKNOWLEDGED'
  | 'COMPLETED'
  | 'FAILED'
  | 'LEASED'
  | 'PROCESSING'
  | 'ACKED_SUCCESS'
  | 'ACKED_FAILURE'
  | 'EXPIRED'
  | 'DEAD_LETTER'
  | 'CANCELLED';
type CommandType =
  | 'REBOOT'
  | 'REFRESH'
  | 'TEST_PATTERN'
  | 'TAKE_SCREENSHOT'
  | 'SET_SCREENSHOT_INTERVAL'
  | 'REFRESH_SCHEDULE'
  | 'SCREENSHOT'
  | 'CLEAR_CACHE'
  | 'PING'
  | 'RESYNC'
  | 'SET_ACTIVE_DISPLAY';

export type CommandAckInput = {
  delivery_token?: string;
  success?: boolean;
  error?: string;
  message?: string;
  result_payload?: unknown;
  data?: unknown;
  processed_at?: string;
};

export type CreateDeviceCommandInput = {
  screenId: string;
  type: CommandType | string;
  createdBy: string;
  payload?: unknown;
  priority?: number;
  expiresAt?: Date | null;
  maxAttempts?: number;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  desiredSnapshotId?: string | null;
  desiredDefaultMediaVersion?: string | null;
  desiredEmergencyVersion?: string | null;
};

export type ClaimedDeviceCommand = {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
  deliveryToken: string | null;
  expiresAt: Date | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
};

function addMs(ms: number) {
  return new Date(Date.now() + ms);
}

export function normalizeCommandType(type: string): CommandType {
  if (type === 'SCREENSHOT') {
    return 'SCREENSHOT';
  }
  return type as CommandType;
}

export function resolveCommandPriority(reason?: string | null, explicitPriority?: number | null) {
  if (typeof explicitPriority === 'number' && Number.isFinite(explicitPriority)) {
    return Math.trunc(explicitPriority);
  }
  const normalizedReason = reason?.trim().toUpperCase();
  return normalizedReason === 'EMERGENCY' || normalizedReason === 'EMERGENCY_START' || normalizedReason === 'EMERGENCY_CLEAR'
    ? COMMAND_PRIORITY_CRITICAL
    : COMMAND_PRIORITY_NORMAL;
}

export function resolveCommandExpiresAt(reason?: string | null, explicitExpiresAt?: Date | null) {
  if (explicitExpiresAt) return explicitExpiresAt;
  const normalizedReason = reason?.trim().toUpperCase();
  const ttlMs =
    normalizedReason === 'EMERGENCY' || normalizedReason === 'EMERGENCY_START' || normalizedReason === 'EMERGENCY_CLEAR'
      ? config.COMMAND_EMERGENCY_EXPIRES_MS
      : config.COMMAND_DEFAULT_EXPIRES_MS;
  return addMs(ttlMs);
}

function resolveReason(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const reason = (payload as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : null;
}

function hasOwnValue<T extends object>(input: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
}

function hasDuplicateScreenIds(inputs: CreateDeviceCommandInput[]) {
  const screenIds = new Set<string>();
  for (const input of inputs) {
    if (screenIds.has(input.screenId)) return true;
    screenIds.add(input.screenId);
  }
  return false;
}

function isTerminalStatus(status: string) {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

function isActiveLeaseStatus(status: string) {
  return (ACTIVE_LEASE_STATUSES as readonly string[]).includes(status);
}

function parseDbTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return new Date(hasTimezone ? normalized : `${normalized}Z`);
}

async function insertStatusHistory(
  tx: CommandLifecycleTx,
  input: {
    commandId: string;
    screenId: string;
    oldStatus?: string | null;
    newStatus: string;
    reason: string;
    attemptCount?: number | null;
    deliveryToken?: string | null;
    metadata?: unknown;
  }
) {
  await tx.insert(schema.deviceCommandStatusHistory).values({
    command_id: input.commandId,
    screen_id: input.screenId,
    old_status: (input.oldStatus ?? null) as CommandStatus | null,
    new_status: input.newStatus as CommandStatus,
    reason: input.reason,
    attempt_count: input.attemptCount ?? null,
    delivery_token: input.deliveryToken ?? null,
    metadata: input.metadata ?? null,
  });
}

function buildCreateCommandHistoryValue(command: DeviceCommandRecord) {
  return {
    command_id: command.id,
    screen_id: command.screen_id,
    old_status: null as CommandStatus | null,
    new_status: 'PENDING' as CommandStatus,
    reason: 'created',
    attempt_count: command.attempt_count,
    delivery_token: null,
    metadata: {
      type: command.type,
      priority: command.priority,
      expires_at: command.expires_at?.toISOString?.() ?? command.expires_at ?? null,
    },
  };
}

async function insertCreateCommandHistory(tx: CommandLifecycleTx, commands: DeviceCommandRecord[]) {
  if (commands.length === 0) return;
  await tx.insert(schema.deviceCommandStatusHistory).values(commands.map(buildCreateCommandHistoryValue));
}

type DesiredStateMode = {
  snapshotId: 'set' | 'preserve';
  defaultMediaVersion: 'set' | 'preserve';
  emergencyVersion: 'set' | 'preserve';
};

function getUniformDesiredStateMode(inputs: CreateDeviceCommandInput[]): DesiredStateMode | null {
  const snapshotModes = new Set(inputs.map((input) => hasOwnValue(input, 'desiredSnapshotId')));
  const defaultMediaModes = new Set(inputs.map((input) => hasOwnValue(input, 'desiredDefaultMediaVersion')));
  const emergencyModes = new Set(inputs.map((input) => hasOwnValue(input, 'desiredEmergencyVersion')));

  if (snapshotModes.size > 1 || defaultMediaModes.size > 1 || emergencyModes.size > 1) {
    return null;
  }

  return {
    snapshotId: snapshotModes.has(true) ? 'set' : 'preserve',
    defaultMediaVersion: defaultMediaModes.has(true) ? 'set' : 'preserve',
    emergencyVersion: emergencyModes.has(true) ? 'set' : 'preserve',
  };
}

function buildDesiredStateMetadata(params: {
  command: DeviceCommandRecord;
  desiredSnapshotId?: string | null;
  desiredDefaultMediaVersion?: string | null;
  desiredEmergencyVersion?: string | null;
}) {
  return {
    command_id: params.command.id,
    command_type: params.command.type,
    priority: params.command.priority,
    desired_snapshot_id: params.desiredSnapshotId ?? null,
    desired_default_media_version: params.desiredDefaultMediaVersion ?? null,
    desired_emergency_version: params.desiredEmergencyVersion ?? null,
  };
}

async function recordDesiredStatesSequentially(
  tx: CommandLifecycleTx,
  commands: DeviceCommandRecord[],
  inputs: CreateDeviceCommandInput[]
) {
  const states = [];
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const input = inputs[index];
    const reason = resolveReason(command.payload);
    const desiredSnapshotId = hasOwnValue(input, 'desiredSnapshotId') ? input.desiredSnapshotId ?? null : undefined;
    const desiredDefaultMediaVersion = hasOwnValue(input, 'desiredDefaultMediaVersion')
      ? input.desiredDefaultMediaVersion ?? null
      : undefined;
    const desiredEmergencyVersion = hasOwnValue(input, 'desiredEmergencyVersion') ? input.desiredEmergencyVersion ?? null : undefined;

    states.push(
      await recordDesiredStateForCommand(tx, {
        screenId: command.screen_id,
        commandId: command.id,
        commandType: command.type,
        commandReason: reason,
        snapshotId: desiredSnapshotId,
        defaultMediaVersion: desiredDefaultMediaVersion,
        emergencyVersion: desiredEmergencyVersion,
        metadata: buildDesiredStateMetadata({
          command,
          desiredSnapshotId,
          desiredDefaultMediaVersion,
          desiredEmergencyVersion,
        }),
      })
    );
  }

  return states;
}

async function recordDesiredStatesForCommands(
  tx: CommandLifecycleTx,
  commands: DeviceCommandRecord[],
  inputs: CreateDeviceCommandInput[]
) {
  if (!config.DEVICE_DESIRED_STATE_ENABLED) {
    return commands.map(() => null);
  }

  const mode = getUniformDesiredStateMode(inputs);
  if (!mode || hasDuplicateScreenIds(inputs)) {
    return await recordDesiredStatesSequentially(tx, commands, inputs);
  }

  const now = new Date();
  const values = commands.map((command, index) => {
    const input = inputs[index];
    const reason = resolveReason(command.payload);
    const desiredSnapshotId = hasOwnValue(input, 'desiredSnapshotId') ? input.desiredSnapshotId ?? null : null;
    const desiredDefaultMediaVersion = hasOwnValue(input, 'desiredDefaultMediaVersion')
      ? input.desiredDefaultMediaVersion ?? null
      : null;
    const desiredEmergencyVersion = hasOwnValue(input, 'desiredEmergencyVersion') ? input.desiredEmergencyVersion ?? null : null;

    return {
      screen_id: command.screen_id,
      snapshot_id: desiredSnapshotId,
      default_media_version: desiredDefaultMediaVersion,
      emergency_version: desiredEmergencyVersion,
      command_version: 1,
      state_version: 1,
      last_command_id: command.id,
      last_command_type: command.type,
      last_command_reason: reason,
      last_changed_reason: reason ?? 'COMMAND_AVAILABLE',
      metadata: buildDesiredStateMetadata({
        command,
        desiredSnapshotId,
        desiredDefaultMediaVersion,
        desiredEmergencyVersion,
      }),
      created_at: now,
      updated_at: now,
    };
  });

  const states = (await tx
    .insert(schema.deviceDesiredState)
    .values(values)
    .onConflictDoUpdate({
      target: schema.deviceDesiredState.screen_id,
      set: {
        snapshot_id:
          mode.snapshotId === 'preserve'
            ? sql`COALESCE(${schema.deviceDesiredState.snapshot_id}, excluded.snapshot_id)`
            : sql`excluded.snapshot_id`,
        default_media_version:
          mode.defaultMediaVersion === 'preserve'
            ? sql`COALESCE(${schema.deviceDesiredState.default_media_version}, excluded.default_media_version)`
            : sql`excluded.default_media_version`,
        emergency_version:
          mode.emergencyVersion === 'preserve'
            ? sql`COALESCE(${schema.deviceDesiredState.emergency_version}, excluded.emergency_version)`
            : sql`excluded.emergency_version`,
        command_version: sql`${schema.deviceDesiredState.command_version} + 1`,
        state_version: sql`${schema.deviceDesiredState.state_version} + 1`,
        last_command_id: sql`excluded.last_command_id`,
        last_command_type: sql`excluded.last_command_type`,
        last_command_reason: sql`excluded.last_command_reason`,
        last_changed_reason: sql`excluded.last_changed_reason`,
        metadata: sql`excluded.metadata`,
        updated_at: now,
      },
    })
    .returning()) as DeviceDesiredStateRecord[];

  const stateByScreenId = new Map(states.map((state) => [state.screen_id, state]));
  const orderedStates = commands.map((command) => stateByScreenId.get(command.screen_id) ?? null);
  const historyValues = orderedStates.flatMap((state, index) => {
    if (!state) return [];
    const command = commands[index];
    const input = inputs[index];
    return [
      {
        screen_id: state.screen_id,
        state_version: state.state_version,
        command_version: state.command_version,
        snapshot_id: state.snapshot_id,
        default_media_version: state.default_media_version,
        emergency_version: state.emergency_version,
        command_id: command.id,
        reason: resolveReason(command.payload) ?? 'COMMAND_AVAILABLE',
        metadata: buildDesiredStateMetadata({
          command,
          desiredSnapshotId: hasOwnValue(input, 'desiredSnapshotId') ? input.desiredSnapshotId ?? null : undefined,
          desiredDefaultMediaVersion: hasOwnValue(input, 'desiredDefaultMediaVersion')
            ? input.desiredDefaultMediaVersion ?? null
            : undefined,
          desiredEmergencyVersion: hasOwnValue(input, 'desiredEmergencyVersion') ? input.desiredEmergencyVersion ?? null : undefined,
        }),
        created_at: now,
      },
    ];
  });

  if (historyValues.length > 0) {
    await tx.insert(schema.deviceDesiredStateHistory).values(historyValues);
  }

  return orderedStates;
}

async function insertCommandOutboxEvents(
  tx: CommandLifecycleTx,
  commands: DeviceCommandRecord[],
  inputs: CreateDeviceCommandInput[],
  desiredStates: Array<DeviceDesiredStateRecord | null>
) {
  if (!config.COMMAND_OUTBOX_WRITE_ENABLED || commands.length === 0) {
    return;
  }

  await tx.insert(schema.commandOutbox).values(
    commands.map((command, index) => {
      const input = inputs[index];
      const reason = resolveReason(command.payload);
      const desiredSnapshotId = hasOwnValue(input, 'desiredSnapshotId') ? input.desiredSnapshotId ?? null : undefined;
      const desiredDefaultMediaVersion = hasOwnValue(input, 'desiredDefaultMediaVersion')
        ? input.desiredDefaultMediaVersion ?? null
        : undefined;
      const desiredEmergencyVersion = hasOwnValue(input, 'desiredEmergencyVersion') ? input.desiredEmergencyVersion ?? null : undefined;

      return {
        screen_id: command.screen_id,
        command_id: command.id,
        event_type: 'COMMAND_AVAILABLE' as const,
        reason,
        payload: {
          command_id: command.id,
          command_type: command.type,
          reason,
          state_version: desiredStates[index]?.state_version ?? null,
          command_version: desiredStates[index]?.command_version ?? null,
          desired_snapshot_id: desiredSnapshotId ?? null,
          desired_default_media_version: desiredDefaultMediaVersion ?? null,
          desired_emergency_version: desiredEmergencyVersion ?? null,
        },
        priority: command.priority,
        max_attempts: config.COMMAND_MAX_ATTEMPTS,
      };
    })
  );
}

function buildCreateCommandValues(input: CreateDeviceCommandInput) {
  const reason = resolveReason(input.payload);
  const expiresAt = input.expiresAt === undefined ? resolveCommandExpiresAt(reason) : input.expiresAt;
  const maxAttempts = input.maxAttempts ?? config.COMMAND_MAX_ATTEMPTS;
  const priority = resolveCommandPriority(reason, input.priority);

  return {
    screen_id: input.screenId,
    type: normalizeCommandType(input.type),
    payload: input.payload ?? null,
    status: 'PENDING' as const,
    priority,
    expires_at: expiresAt ?? null,
    max_attempts: maxAttempts,
    correlation_id: input.correlationId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    desired_snapshot_id: input.desiredSnapshotId ?? null,
    desired_default_media_version: input.desiredDefaultMediaVersion ?? null,
    desired_emergency_version: input.desiredEmergencyVersion ?? null,
    created_by: input.createdBy,
  };
}

export async function createDeviceCommands(
  inputs: CreateDeviceCommandInput[],
  options: { ignoreIdempotencyConflicts?: boolean } = {}
) {
  const db = getDatabase();
  if (inputs.length === 0) {
    return [];
  }

  return await db.transaction(async (tx) => {
    const commandValues = inputs.map(buildCreateCommandValues);
    const insert = tx.insert(schema.deviceCommands).values(commandValues);
    const commands = await (options.ignoreIdempotencyConflicts
      ? insert.onConflictDoNothing().returning()
      : insert.returning());

    if (commands.length === 0) {
      return [];
    }

    const inputByScreenId = new Map(inputs.map((input) => [input.screenId, input]));
    const insertedInputs = commands.map((command) => {
      const input = inputByScreenId.get(command.screen_id);
      if (!input) {
        throw new Error(`Unable to match inserted command to input for screen ${command.screen_id}`);
      }
      return input;
    });

    await insertCreateCommandHistory(tx, commands);
    const desiredStates = await recordDesiredStatesForCommands(tx, commands, insertedInputs);
    await insertCommandOutboxEvents(tx, commands, insertedInputs, desiredStates);

    return commands;
  });
}

export async function createDeviceCommand(input: CreateDeviceCommandInput) {
  const [command] = await createDeviceCommands([input]);
  return command;
}

export async function claimDeviceCommands(deviceId: string): Promise<ClaimedDeviceCommand[]> {
  const db = getDatabase();
  return await db.transaction(async (tx) => {
    const now = new Date();
    const legacyReclaimBefore = new Date(now.getTime() - config.COMMAND_LEASE_MS);
    const leaseExpiresAt = new Date(now.getTime() + config.COMMAND_LEASE_MS);

    const claimableResult = await tx.execute(sql`
      SELECT id, type, payload, status, created_at, expires_at, lease_expires_at, claimed_at,
             delivery_attempts, attempt_count, max_attempts, priority
      FROM device_commands
      WHERE screen_id = ${deviceId}
        AND (
          status = 'PENDING'
          OR (
            status IN ('SENT', 'LEASED', 'PROCESSING')
            AND acknowledged_at IS NULL
            AND (
              (lease_expires_at IS NOT NULL AND lease_expires_at <= ${now})
              OR (lease_expires_at IS NULL AND claimed_at <= ${legacyReclaimBefore})
            )
          )
        )
      ORDER BY priority DESC, created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
    `);

    const claimable =
      (claimableResult as unknown as {
        rows?: Array<{
          id: string;
          type: string;
          payload: unknown;
          status: string;
          created_at: Date | string;
          expires_at: Date | string | null;
          lease_expires_at: Date | string | null;
          claimed_at: Date | string | null;
          delivery_attempts: number | string | null;
          attempt_count: number | string | null;
          max_attempts: number | string | null;
          priority: number | string | null;
        }>;
      }).rows ?? [];

    const claimedCommands: ClaimedDeviceCommand[] = [];

    for (const candidate of claimable) {
      const oldStatus = candidate.status;
      const currentAttemptCount = Number(candidate.attempt_count ?? candidate.delivery_attempts ?? 0);
      const maxAttempts = Number(candidate.max_attempts ?? config.COMMAND_MAX_ATTEMPTS);
      const expiresAt = parseDbTimestamp(candidate.expires_at);

      if (isActiveLeaseStatus(oldStatus)) {
        const activeLeaseExpiresAt = parseDbTimestamp(candidate.lease_expires_at);
        const legacyClaimedAt = parseDbTimestamp(candidate.claimed_at);
        const leaseIsStillActive =
          activeLeaseExpiresAt !== null
            ? activeLeaseExpiresAt.getTime() > now.getTime()
            : legacyClaimedAt !== null && legacyClaimedAt.getTime() > legacyReclaimBefore.getTime();

        if (leaseIsStillActive) {
          continue;
        }
      }

      if (expiresAt && expiresAt.getTime() <= now.getTime()) {
        const [expired] = await tx
          .update(schema.deviceCommands)
          .set({
            status: 'EXPIRED',
            last_error: 'Command expired before delivery',
            updated_at: now,
          })
          .where(and(eq(schema.deviceCommands.id, candidate.id), eq(schema.deviceCommands.screen_id, deviceId)))
          .returning({ id: schema.deviceCommands.id, screen_id: schema.deviceCommands.screen_id });
        if (expired) {
          await insertStatusHistory(tx, {
            commandId: expired.id,
            screenId: expired.screen_id,
            oldStatus,
            newStatus: 'EXPIRED',
            reason: 'expired_before_claim',
            attemptCount: currentAttemptCount,
            metadata: { expires_at: expiresAt.toISOString() },
          });
        }
        continue;
      }

      if (currentAttemptCount >= maxAttempts) {
        const [deadLettered] = await tx
          .update(schema.deviceCommands)
          .set({
            status: 'DEAD_LETTER',
            last_error: 'Command exceeded maximum delivery attempts',
            dead_lettered_at: now,
            updated_at: now,
          })
          .where(and(eq(schema.deviceCommands.id, candidate.id), eq(schema.deviceCommands.screen_id, deviceId)))
          .returning({ id: schema.deviceCommands.id, screen_id: schema.deviceCommands.screen_id });
        if (deadLettered) {
          await insertStatusHistory(tx, {
            commandId: deadLettered.id,
            screenId: deadLettered.screen_id,
            oldStatus,
            newStatus: 'DEAD_LETTER',
            reason: 'max_attempts_exceeded',
            attemptCount: currentAttemptCount,
            metadata: { max_attempts: maxAttempts },
          });
        }
        continue;
      }

      const deliveryToken = randomUUID();
      const nextAttemptCount = currentAttemptCount + 1;
      const [claimed] = await tx
        .update(schema.deviceCommands)
        .set({
          status: 'SENT',
          delivery_token: deliveryToken,
          claimed_at: now,
          lease_expires_at: leaseExpiresAt,
          updated_at: now,
          delivery_attempts: sql`${schema.deviceCommands.delivery_attempts} + 1`,
          attempt_count: sql`${schema.deviceCommands.attempt_count} + 1`,
        })
        .where(and(eq(schema.deviceCommands.id, candidate.id), eq(schema.deviceCommands.screen_id, deviceId)))
        .returning({
          id: schema.deviceCommands.id,
          screenId: schema.deviceCommands.screen_id,
          type: schema.deviceCommands.type,
          payload: schema.deviceCommands.payload,
          createdAt: schema.deviceCommands.created_at,
          deliveryToken: schema.deviceCommands.delivery_token,
          expiresAt: schema.deviceCommands.expires_at,
          leaseExpiresAt: schema.deviceCommands.lease_expires_at,
          attemptCount: schema.deviceCommands.attempt_count,
        });

      if (claimed) {
        await insertStatusHistory(tx, {
          commandId: claimed.id,
          screenId: claimed.screenId,
          oldStatus,
          newStatus: 'SENT',
          reason: oldStatus === 'PENDING' ? 'claimed' : 'lease_reclaimed',
          attemptCount: nextAttemptCount,
          deliveryToken,
          metadata: {
            lease_expires_at: leaseExpiresAt.toISOString(),
            compatibility_status: 'SENT_AS_LEASED',
          },
        });
        claimedCommands.push({
          id: claimed.id,
          type: claimed.type,
          payload: claimed.payload,
          createdAt: claimed.createdAt,
          deliveryToken: claimed.deliveryToken,
          expiresAt: claimed.expiresAt,
          leaseExpiresAt: claimed.leaseExpiresAt,
          attemptCount: claimed.attemptCount,
        });
      }
    }

    return claimedCommands;
  });
}

export async function acknowledgeDeviceCommand(deviceId: string, commandId: string, ackBody?: CommandAckInput) {
  const db = getDatabase();
  return await db.transaction(async (tx) => {
    const [command] = await tx
      .select()
      .from(schema.deviceCommands)
      .where(and(eq(schema.deviceCommands.id, commandId), eq(schema.deviceCommands.screen_id, deviceId)))
      .for('update');

    if (!command) {
      throw AppError.notFound('Command not found');
    }

    const providedToken = ackBody?.delivery_token ?? null;
    const storedToken = command.delivery_token ?? null;
    const tokenMatches = storedToken ? providedToken === storedToken : providedToken === null;
    if (!tokenMatches) {
      throw AppError.notFound('Command not found');
    }

    if (isTerminalStatus(command.status)) {
      if (command.acknowledged_at) {
        return {
          id: command.id,
          status: command.status,
          alreadyAcknowledged: true,
        };
      }
      throw AppError.notFound('Command not found');
    }

    if (!isActiveLeaseStatus(command.status)) {
      throw AppError.notFound('Command not found');
    }

    const acknowledgedAt = new Date();
    const executionSucceeded = ackBody?.success !== false;
    const nextStatus = executionSucceeded ? 'COMPLETED' : 'FAILED';
    const resultPayload = {
      success: executionSucceeded,
      error: ackBody?.error ?? null,
      message: ackBody?.message ?? null,
      result_payload: ackBody?.result_payload ?? ackBody?.data ?? null,
      processed_at: ackBody?.processed_at ?? null,
      acknowledged_at: acknowledgedAt.toISOString(),
    };
    const lastError = executionSucceeded ? null : ackBody?.error ?? ackBody?.message ?? 'Command failed';

    const [updated] = await tx
      .update(schema.deviceCommands)
      .set({
        status: nextStatus,
        acknowledged_at: acknowledgedAt,
        completed_at: acknowledgedAt,
        result_payload: resultPayload,
        last_error: lastError,
        payload: sql`COALESCE(${schema.deviceCommands.payload}, '{}'::jsonb) || ${JSON.stringify({
          execution_result: resultPayload,
        })}::jsonb`,
        updated_at: acknowledgedAt,
      })
      .where(and(eq(schema.deviceCommands.id, commandId), eq(schema.deviceCommands.screen_id, deviceId)))
      .returning({ id: schema.deviceCommands.id, screen_id: schema.deviceCommands.screen_id, status: schema.deviceCommands.status });

    if (!updated) {
      throw AppError.notFound('Command not found');
    }

    await insertStatusHistory(tx, {
      commandId: updated.id,
      screenId: updated.screen_id,
      oldStatus: command.status,
      newStatus: updated.status,
      reason: executionSucceeded ? 'ack_success' : 'ack_failure',
      attemptCount: command.attempt_count,
      deliveryToken: storedToken,
      metadata: resultPayload,
    });

    return {
      id: updated.id,
      status: updated.status,
      alreadyAcknowledged: false,
    };
  });
}

export async function listRecentDeviceCommands(screenId: string, limit = 25) {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const commands = await db
    .select()
    .from(schema.deviceCommands)
    .where(eq(schema.deviceCommands.screen_id, screenId))
    .orderBy(desc(schema.deviceCommands.created_at))
    .limit(safeLimit);

  if (commands.length === 0) {
    return [];
  }

  const histories = await db
    .select()
    .from(schema.deviceCommandStatusHistory)
    .where(inArray(schema.deviceCommandStatusHistory.command_id, commands.map((command) => command.id)))
    .orderBy(desc(schema.deviceCommandStatusHistory.created_at));

  const historyByCommand = histories.reduce<Record<string, typeof histories>>((acc, entry) => {
    (acc[entry.command_id] ??= []).push(entry);
    return acc;
  }, {});

  return commands.map((command) => ({
    ...command,
    status_history: historyByCommand[command.id] ?? [],
    lifecycle_status:
      command.status === 'SENT'
        ? 'LEASED'
        : command.status === 'COMPLETED'
        ? 'ACKED_SUCCESS'
        : command.status === 'FAILED'
        ? 'ACKED_FAILURE'
        : command.status,
  }));
}
