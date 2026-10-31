import { and, eq, sql } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { runWithWorkerAdmission } from '@/maintenance/worker-admission';
import {
  recordDeviceAuthRolloutObservation,
  type DeviceAuthObservationChannel,
  type DeviceAuthObservationMethod,
} from '@/deployment/device-auth-rollout';
import {
  persistDeviceIdentitySessionObservation,
  type DeviceIdentitySessionObservation,
} from '@/services/device-identity-session-service';

export type DeviceOperationalObservationJob =
  | {
      eventId: string;
      type: 'auth_rollout';
      screenId: string;
      channel: DeviceAuthObservationChannel;
      method: DeviceAuthObservationMethod;
      observedAt: string;
    }
  | {
      eventId: string;
      type: 'identity_session';
      observation: DeviceIdentitySessionObservation;
    }
  | {
      eventId: string;
      type: 'hello_capabilities';
      screenId: string;
      capabilities: Record<string, unknown>;
      observedAt: string;
    };

async function persistHelloCapabilities(job: Extract<DeviceOperationalObservationJob, { type: 'hello_capabilities' }>) {
  const db = getDatabase();
  const observedAt = new Date(job.observedAt);
  const capabilityDocument = JSON.stringify({
    player_capabilities: job.capabilities,
    player_capabilities_observed_at: observedAt.toISOString(),
  });

  await db
    .update(schema.screens)
    .set({
      device_info: sql`COALESCE(${schema.screens.device_info}, '{}'::jsonb) || ${capabilityDocument}::jsonb`,
      updated_at: sql`GREATEST(${schema.screens.updated_at}, ${observedAt})`,
    })
    .where(and(
      eq(schema.screens.id, job.screenId),
      sql`COALESCE(${schema.screens.device_info} ->> 'player_capabilities_observed_at', '') < ${observedAt.toISOString()}`
    ));
}

async function persistDeviceOperationalObservation(job: DeviceOperationalObservationJob) {
  switch (job.type) {
    case 'auth_rollout':
      await recordDeviceAuthRolloutObservation({
        screenId: job.screenId,
        channel: job.channel,
        method: job.method,
        observedAt: new Date(job.observedAt),
      });
      return;
    case 'identity_session':
      await persistDeviceIdentitySessionObservation(job.observation);
      return;
    case 'hello_capabilities':
      await persistHelloCapabilities(job);
  }
}

export async function processDeviceOperationalObservation(job: DeviceOperationalObservationJob) {
  return runWithWorkerAdmission(
    'telemetry:device-observation',
    () => persistDeviceOperationalObservation(job)
  );
}
