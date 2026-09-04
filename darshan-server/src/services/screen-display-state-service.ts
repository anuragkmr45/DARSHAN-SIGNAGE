import { and, eq, sql } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { AppError } from '@/utils/app-error';
import {
  DisplayProfileV1,
  DisplaySelection,
  displayProfileLegacyDimensions,
  hashDisplayProfile,
} from '@/utils/display-profile';

type DisplayStateRow = typeof schema.screenDisplayStates.$inferSelect;

export type DisplayProfileWriteResult =
  | { applied: true; state: DisplayStateRow }
  | { applied: false; reason: 'STALE_OBSERVATION'; state: DisplayStateRow };

const defaultSelection = { mode: 'PRIMARY', preferred_key: null } as const;

async function ensureState(screenId: string) {
  const db = getDatabase();
  await db
    .insert(schema.screenDisplayStates)
    .values({ screen_id: screenId, desired_selection: defaultSelection })
    .onConflictDoNothing();
  const [state] = await db
    .select()
    .from(schema.screenDisplayStates)
    .where(eq(schema.screenDisplayStates.screen_id, screenId))
    .limit(1);
  if (!state) throw AppError.notFound('Display state not found');
  return state;
}

export async function getScreenDisplayState(screenId: string) {
  return await ensureState(screenId);
}

/**
 * Ignore observations that predate an already-accepted observation from the
 * same player process. A new runtime session intentionally resets the
 * sequence domain after a player restart.
 */
export async function recordDisplayProfile(screenId: string, profile: DisplayProfileV1): Promise<DisplayProfileWriteResult> {
  const db = getDatabase();
  const current = await ensureState(screenId);
  const isSameSession = current.runtime_session_id === profile.runtime_session_id;
  const observedAt = new Date(profile.observed_at);
  if (isSameSession && Number(current.observation_seq) >= profile.observation_seq) {
    return { applied: false, reason: 'STALE_OBSERVATION', state: current };
  }
  // A restarted player deliberately starts a new sequence domain. The old
  // process can still emit one delayed heartbeat, however, so a different
  // session must not replace a newer observed state with an older timestamp.
  if (!isSameSession && current.observed_at && observedAt.getTime() < current.observed_at.getTime()) {
    return { applied: false, reason: 'STALE_OBSERVATION', state: current };
  }

  const hash = hashDisplayProfile(profile);
  // A player restart changes the observation ordering domain, not the physical
  // display configuration.  Keeping the revision content-addressed prevents a
  // valid pinned-selection request from becoming stale solely because the
  // player process was restarted.
  const isContentChange = current.profile_hash !== hash;
  const legacy = displayProfileLegacyDimensions(profile);
  const now = new Date();

  const [state] = await db
    .update(schema.screenDisplayStates)
    .set({
      active_display_key: profile.selection.active_key ?? null,
      placement: profile.placement,
      display_profile: profile,
      profile_hash: hash,
      profile_revision: isContentChange ? current.profile_revision + 1 : current.profile_revision,
      runtime_session_id: profile.runtime_session_id,
      observation_seq: profile.observation_seq,
      observed_at: observedAt,
      updated_at: now,
    })
    .where(
      and(
        eq(schema.screenDisplayStates.screen_id, screenId),
        sql`(
          (${schema.screenDisplayStates.runtime_session_id} IS NOT DISTINCT FROM ${profile.runtime_session_id}
            AND ${schema.screenDisplayStates.observation_seq} < ${profile.observation_seq})
          OR
          (${schema.screenDisplayStates.runtime_session_id} IS DISTINCT FROM ${profile.runtime_session_id}
            AND (${schema.screenDisplayStates.observed_at} IS NULL OR ${schema.screenDisplayStates.observed_at} <= ${observedAt}))
        )`
      )
    )
    .returning();

  // A concurrent heartbeat won the race. Re-read rather than overwriting a
  // newer observation with a stale one.
  if (!state) {
    const latest = await ensureState(screenId);
    return { applied: false, reason: 'STALE_OBSERVATION', state: latest };
  }

  await db
    .update(schema.screens)
    .set({
      width: legacy.width,
      height: legacy.height,
      aspect_ratio: legacy.aspect_ratio,
      orientation: legacy.orientation,
      updated_at: now,
    })
    .where(eq(schema.screens.id, screenId));

  return { applied: true, state };
}

export async function updateDisplaySelection(screenId: string, selection: DisplaySelection) {
  const db = getDatabase();
  const current = await ensureState(screenId);
  if (selection.mode === 'PINNED' && selection.expected_profile_revision !== current.profile_revision) {
    throw AppError.conflict('The display inventory changed. Refresh the screen and choose the output again.', {
      code: 'DISPLAY_PROFILE_STALE',
      expected_profile_revision: selection.expected_profile_revision,
      current_profile_revision: current.profile_revision,
    });
  }

  if (selection.mode === 'PINNED') {
    const inventory = ((current.display_profile as DisplayProfileV1 | null)?.inventory ?? []);
    if (!inventory.some((display) => display.key === selection.display_key)) {
      throw AppError.badRequest('The selected display is not present in the latest inventory.');
    }
  }

  const desired =
    selection.mode === 'PRIMARY'
      ? defaultSelection
      : { mode: 'PINNED' as const, preferred_key: selection.display_key };
  const [updated] = await db
    .update(schema.screenDisplayStates)
    .set({
      desired_selection: desired,
      selection_version: current.selection_version + 1,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(schema.screenDisplayStates.screen_id, screenId),
        eq(schema.screenDisplayStates.selection_version, current.selection_version)
      )
    )
    .returning();
  if (!updated) {
    throw AppError.conflict('The display selection changed concurrently. Refresh and try again.', {
      code: 'DISPLAY_SELECTION_CONFLICT',
    });
  }
  return updated;
}

export function serializeDisplayState(state: DisplayStateRow) {
  return {
    screen_id: state.screen_id,
    desired_selection: state.desired_selection,
    selection_version: state.selection_version,
    active_display_key: state.active_display_key,
    placement: state.placement,
    profile: state.display_profile,
    profile_hash: state.profile_hash,
    profile_revision: state.profile_revision,
    runtime_session_id: state.runtime_session_id,
    observation_seq: Number(state.observation_seq),
    observed_at: state.observed_at?.toISOString() ?? null,
    updated_at: state.updated_at.toISOString(),
  };
}
