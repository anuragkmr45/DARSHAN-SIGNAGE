import { subject } from '@casl/ability';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { JWTPayload } from '@/auth/jwt';
import { schema } from '@/db';
import { assertCanReadLiveOccurrence, withLiveOccurrence } from './live-runtime';
import { requireLiveAuthorityEpoch } from './live-authority-epoch';
import { livePlayerReportSchema, type LiveTargetReports, type LiveTargetUnknownReason } from '@/schemas/live-target-reports';

/** Current server-received player declarations, never inferred display/PoP evidence. */
export async function getLiveTargetReports(payload: Pick<JWTPayload, 'sub' | 'jti'>, occurrenceId: string): Promise<LiveTargetReports> {
  return withLiveOccurrence({ occurrenceId }, payload, false, async context => {
    assertCanReadLiveOccurrence(context);
    const audience = context.policy.screen_ids;
    const screens = await context.tx.select().from(schema.screens).where(inArray(schema.screens.id, audience)).for('share');
    const run = context.run;
    const rows = run ? await context.tx.select({ admission: schema.liveAdmissions, observation: schema.liveAdmissionObservations })
      .from(schema.liveAdmissions).leftJoin(schema.liveAdmissionObservations, eq(schema.liveAdmissionObservations.admission_id, schema.liveAdmissions.id))
      .where(and(eq(schema.liveAdmissions.run_id, run.id), eq(schema.liveAdmissions.generation, run.generation),
        eq(schema.liveAdmissions.role, 'receiver'), inArray(schema.liveAdmissions.screen_id, audience)))
      .orderBy(sql`CASE WHEN ${schema.liveAdmissions.teardown_confirmed_at} IS NULL THEN 0 ELSE 1 END`,
        desc(schema.liveAdmissions.created_at), desc(schema.liveAdmissions.id)) : [];
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (row.admission.screen_id && !latest.has(row.admission.screen_id)) latest.set(row.admission.screen_id, row);
    const now = Date.now();
    const inactive: LiveTargetUnknownReason | null = !run ? 'NO_RUN' : !context.publicationActive ? 'PUBLICATION_INACTIVE'
      : now < context.occurrence.start_at.getTime() || now >= context.occurrence.end_at.getTime() ? 'WINDOW_NOT_ACTIVE'
      : !context.control.enabled ? 'OCCURRENCE_DISABLED' : ['STOPPING', 'STOPPED'].includes(run.state) ? 'RUN_STOPPED'
      : run.authority_epoch !== requireLiveAuthorityEpoch().epoch_id ? 'AUTHORITY_CHANGED' : !context.presenterAllowed ? 'PRESENTER_UNAVAILABLE' : null;
    return { version: 1, occurrence_id: occurrenceId, server_now: new Date(now).toISOString(), fresh_for_ms: 10000,
      run: run ? { id: run.id, generation: run.generation, state: run.state } : null,
      targets: audience.map(screenId => {
        const screen = screens.find(row => row.id === screenId), selected = latest.get(screenId), observation = selected?.observation, admission = selected?.admission;
        const screenName = screen && context.actor?.ability.can('read', subject('Screen', screen) as never, 'name') ? screen.name : null;
        const bound = admission && observation && admission.runtime_session_id === observation.runtime_session_id &&
          admission.participant_id === `receiver_${screenId}_${admission.runtime_session_id}`;
        const age = observation ? now - observation.received_at.getTime() : null;
        // Fallback reasons are diagnostics codes only. Never reflect arbitrary
        // client text which may contain paths, URLs or transient credentials.
        const reasonCode = observation?.fallback_reason == null ? null : /^[A-Z][A-Z0-9_]{0,79}$/.test(observation.fallback_reason) ? observation.fallback_reason : 'PLAYER_REASON_REDACTED';
        const parsed = bound ? livePlayerReportSchema.safeParse({ sequence: observation.sequence, connection: observation.connection,
          subscription: observation.subscription, frame: observation.frame, audio: observation.audio,
          fallback_ready: observation.fallback_ready, fallback_reason: reasonCode }) : undefined;
        const report = parsed?.success ? parsed.data : null;
        const reason: LiveTargetUnknownReason | null = inactive ?? (!admission ? 'NO_ADMISSION'
          : admission.revoked_at || admission.teardown_confirmed_at || ['REVOKING', 'REVOKED'].includes(admission.state) ? 'ADMISSION_REVOKED'
          : admission.state !== 'ACTIVE' ? 'ADMISSION_PENDING' : !observation ? 'NO_REPORT' : !bound ? 'RUNTIME_MISMATCH'
          : !report ? 'INVALID_REPORT' : age! < 0 ? 'CLOCK_UNCERTAIN' : age! > 10000 ? 'STALE_REPORT' : null);
        return { screen_id: screenId, screen_name: screenName, freshness: reason ? 'UNKNOWN' as const : 'FRESH' as const, reason,
          received_at: observation && bound ? observation.received_at.toISOString() : null,
          age_ms: bound && age !== null && age >= 0 ? Math.floor(age) : null, report };
      }) };
  });
}
