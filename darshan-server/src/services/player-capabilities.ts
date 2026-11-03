import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase, schema, type DatabaseTransaction } from '@/db';
import { playerCapabilitiesSchema } from '@/schemas/player-capabilities';

type CapabilityReport = {
  deviceId: string;
  capabilities: unknown;
  authMethod: 'signature' | 'legacy_serial';
  source: 'REST' | 'HELLO';
  runtimeSessionId?: string;
  receivedAt?: Date;
};
/** Caller supplies the authentication method actually verified by the HTTP or
 * socket authenticator. Never derive it from a client claim or rollout mode. */
export async function recordPlayerCapabilityReport(input: CapabilityReport, executor?: DatabaseTransaction): Promise<boolean> {
  if (input.source === 'REST' && input.authMethod !== 'signature') return false;
  const capabilities = playerCapabilitiesSchema.parse(input.capabilities);
  if (!executor) return getDatabase().transaction(tx => recordPlayerCapabilityReport(input, tx));
  const [screen] = await executor.select({ info: schema.screens.device_info }).from(schema.screens)
    .where(eq(schema.screens.id, input.deviceId)).for('update');
  if (!screen) return false;
  const info = screen.info && typeof screen.info === 'object' ? screen.info as Record<string, unknown> : {};
  const trusted = input.authMethod === 'signature';
  if (!trusted && info.player_capabilities_trusted === true) return false;
  const runtime = trusted ? z.string().uuid().safeParse(input.runtimeSessionId) : undefined;
  const runtimeHash = runtime?.success ? createHash('sha256').update(runtime.data).digest('hex') : null;
  // A legacy HELLO remains useful for old features. It cannot add LIVE; nor
  // can a signed HELLO without a process UUID invent LIVE process binding.
  const current = runtimeHash ? capabilities : { ...capabilities,
    ...(capabilities.features ? { features: capabilities.features.filter(feature => feature !== 'live_broadcast_v1') } : {}) };
  const at = input.receivedAt ?? new Date();
  const document = { player_capabilities: current, player_capabilities_observed_at: at.toISOString(),
    player_capabilities_trusted: trusted, player_capabilities_source: `${input.source}_${trusted ? 'SIGNED' : 'LEGACY'}`,
    player_capabilities_runtime_session_hash: runtimeHash };
  await executor.update(schema.screens).set({
    device_info: sql`COALESCE(${schema.screens.device_info}, '{}'::jsonb) || ${JSON.stringify(document)}::jsonb`, updated_at: at,
  }).where(eq(schema.screens.id, input.deviceId));
  return true;
}
