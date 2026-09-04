import { createHash } from 'crypto';
import { inArray } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { createScheduleRepository, ScheduleRepository } from '@/db/repositories/schedule';
import { createScheduleItemRepository, ScheduleItemRepository } from '@/db/repositories/schedule-item';
import { AppError } from '@/utils/app-error';
import { serializeMediaRecord } from '@/utils/media';
import { areAspectsCompatible, parseAspectRatio } from '@/utils/display-profile';

type DB = ReturnType<typeof getDatabase>;

function normalizeCodecList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean);
}

function inferRequiredCodecs(media: any): string[] {
  const contentType = typeof media?.source_content_type === 'string' ? media.source_content_type.toLowerCase() : '';
  if (!contentType.startsWith('video/')) return [];
  if (contentType.includes('webm')) return ['vp9', 'vp8'];
  if (contentType.includes('mp4') || contentType.includes('quicktime')) return ['h264'];
  return [];
}

export async function resolvePresentations(presentationIds: string[], db: DB = getDatabase()) {
  const unique = Array.from(new Set(presentationIds));
  if (unique.length === 0) return new Map<string, any>();

  const presentations = await db
    .select()
    .from(schema.presentations)
    .where(inArray(schema.presentations.id, unique as any));

  const items = await db
    .select()
    .from(schema.presentationItems)
    .where(inArray(schema.presentationItems.presentation_id, unique as any))
    .orderBy(schema.presentationItems.order);

  const slotItems = await db
    .select()
    .from(schema.presentationSlotItems)
    .where(inArray(schema.presentationSlotItems.presentation_id, unique as any))
    .orderBy(schema.presentationSlotItems.slot_id, schema.presentationSlotItems.order);

  const mediaIds = items.map((i) => i.media_id).concat(slotItems.map((i) => i.media_id));
  const mediaRows = mediaIds.length
    ? await db.select().from(schema.media).where(inArray(schema.media.id, mediaIds as any))
    : [];
  const mediaMap = new Map(mediaRows.map((m) => [m.id, m]));

  const layoutIds = presentations.map((p) => (p as any).layout_id).filter(Boolean) as string[];
  const layoutRows = layoutIds.length
    ? await db.select().from(schema.layouts).where(inArray(schema.layouts.id, layoutIds as any))
    : [];
  const layoutMap = new Map(layoutRows.map((l) => [l.id, l]));

  const grouped = new Map<string, any>();
  presentations.forEach((p) => {
    grouped.set(p.id, {
      ...p,
      items: [] as any[],
      slots: [] as any[],
      layout: (p as any).layout_id ? layoutMap.get((p as any).layout_id) : null,
    });
  });

  items.forEach((i) => {
    const entry = grouped.get(i.presentation_id) || {
      id: i.presentation_id,
      name: null,
      items: [],
      slots: [],
    };
    entry.items.push({
      id: i.id,
      media_id: i.media_id,
      order: i.order,
      duration_seconds: i.duration_seconds,
      media: mediaMap.get(i.media_id) || null,
      created_at: i.created_at,
    });
    grouped.set(i.presentation_id, entry);
  });

  slotItems.forEach((i) => {
    const entry = grouped.get(i.presentation_id) || {
      id: i.presentation_id,
      name: null,
      items: [],
      slots: [],
    };
    entry.slots.push({
      id: i.id,
      slot_id: i.slot_id,
      media_id: i.media_id,
      order: i.order,
      duration_seconds: i.duration_seconds,
      fit_mode: i.fit_mode,
      audio_enabled: i.audio_enabled,
      loop_enabled: i.loop_enabled ?? false,
      media: mediaMap.get(i.media_id) || null,
      created_at: i.created_at,
    });
    grouped.set(i.presentation_id, entry);
  });

  return grouped;
}

export interface PublishScheduleParams {
  scheduleId: string;
  screenIds?: string[];
  screenGroupIds?: string[];
  publishedBy: string;
  notes?: string | null;
  aspectOverride?: { acknowledged: true; issue_hash: string; reason?: string } | null;
  db?: DB;
  scheduleRepo?: ScheduleRepository;
  scheduleItemRepo?: ScheduleItemRepository;
  onPublished?: (context: {
    tx: DB;
    publish: typeof schema.publishes.$inferSelect;
    snapshot: typeof schema.scheduleSnapshots.$inferSelect;
    schedule: typeof schema.schedules.$inferSelect;
    scheduleItems: any[];
    resolvedScreenIds: string[];
  }) => Promise<void>;
}

export async function getScheduleDisplayPreflight(params: {
  scheduleId: string;
  screenIds?: string[];
  screenGroupIds?: string[];
  db?: DB;
  scheduleItemRepo?: ScheduleItemRepository;
}) {
  const db = params.db ?? getDatabase();
  const scheduleItemRepo = params.scheduleItemRepo ?? createScheduleItemRepository();
  const scheduleItems = await scheduleItemRepo.listBySchedule(params.scheduleId);
  const presentations = await resolvePresentations(scheduleItems.map((item: any) => item.presentation_id), db);
  const groupIds = new Set<string>(params.screenGroupIds || []);
  scheduleItems.forEach((item: any) => (item.screen_group_ids || []).forEach((groupId: string) => groupIds.add(groupId)));
  const members = groupIds.size
    ? await db.select().from(schema.screenGroupMembers).where(inArray(schema.screenGroupMembers.group_id, Array.from(groupIds) as any))
    : [];
  const groupMap = new Map<string, string[]>();
  members.forEach((member: any) => {
    const values = groupMap.get(member.group_id) || [];
    values.push(member.screen_id);
    groupMap.set(member.group_id, values);
  });
  const expandGroups = (groupIdsToExpand: string[] = []) => {
    const ids = new Set<string>();
    groupIdsToExpand.forEach((groupId) => (groupMap.get(groupId) || []).forEach((screenId) => ids.add(screenId)));
    return ids;
  };
  const targets = new Set<string>(params.screenIds || []);
  expandGroups(params.screenGroupIds || []).forEach((screenId) => targets.add(screenId));
  if (targets.size === 0) {
    scheduleItems.forEach((item: any) => {
      (item.screen_ids || []).forEach((screenId: string) => targets.add(screenId));
      expandGroups(item.screen_group_ids || []).forEach((screenId) => targets.add(screenId));
    });
  }
  const targetIds = Array.from(targets);
  if (targetIds.length === 0) return { target_screen_ids: [], issues: [], issue_hash: null, compatible: true };
  const [displayStates, screens] = await Promise.all([
    db.select().from(schema.screenDisplayStates).where(inArray(schema.screenDisplayStates.screen_id, targetIds as any)),
    db
      .select({ id: schema.screens.id, aspect_ratio: schema.screens.aspect_ratio, width: schema.screens.width, height: schema.screens.height })
      .from(schema.screens)
      .where(inArray(schema.screens.id, targetIds as any)),
  ]);
  const displayMap = new Map(displayStates.map((state) => [state.screen_id, state]));
  const screenMap = new Map(screens.map((screen) => [screen.id, screen]));
  const aspectForScreen = (screenId: string) => {
    const observed = (displayMap.get(screenId)?.display_profile as any)?.output?.aspect?.numeric_value;
    if (typeof observed === 'number' && Number.isFinite(observed) && observed > 0) return observed;
    const legacy = screenMap.get(screenId);
    return parseAspectRatio(legacy?.aspect_ratio) ?? (legacy?.width && legacy?.height ? legacy.width / legacy.height : null);
  };
  const issues: Array<{
    screen_id: string;
    presentation_id: string;
    layout_aspect_ratio: string;
    screen_aspect_ratio: number | null;
    usable_area_fraction: number | null;
    profile_revision: number | null;
  }> = [];
  scheduleItems.forEach((item: any) => {
    const presentation = presentations.get(item.presentation_id);
    const layoutRatio = parseAspectRatio(presentation?.layout?.aspect_ratio);
    if (!layoutRatio) return;
    const itemTargets = new Set<string>();
    (item.screen_ids || []).forEach((screenId: string) => itemTargets.add(screenId));
    expandGroups(item.screen_group_ids || []).forEach((screenId) => itemTargets.add(screenId));
    if (itemTargets.size === 0) targetIds.forEach((screenId) => itemTargets.add(screenId));
    itemTargets.forEach((screenId) => {
      const actual = aspectForScreen(screenId);
      if (actual !== null && !areAspectsCompatible(layoutRatio, actual)) {
        issues.push({
          screen_id: screenId,
          presentation_id: presentation.id,
          layout_aspect_ratio: presentation.layout.aspect_ratio,
          screen_aspect_ratio: actual,
          usable_area_fraction: Math.min(layoutRatio / actual, actual / layoutRatio),
          profile_revision: displayMap.get(screenId)?.profile_revision ?? null,
        });
      }
    });
  });
  const sorted = issues.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const issueHash = sorted.length ? createHash('sha256').update(JSON.stringify(sorted)).digest('hex') : null;
  return { target_screen_ids: targetIds, issues: sorted, issue_hash: issueHash, compatible: sorted.length === 0 };
}

export async function publishScheduleSnapshot(params: PublishScheduleParams) {
  const db = params.db ?? getDatabase();
  const scheduleRepo = params.scheduleRepo ?? createScheduleRepository();
  const scheduleItemRepo = params.scheduleItemRepo ?? createScheduleItemRepository();

  const schedule = await scheduleRepo.findById(params.scheduleId);
  if (!schedule) {
    throw AppError.notFound('Schedule not found');
  }

  const scheduleItems = await scheduleItemRepo.listBySchedule(schedule.id);
  if (scheduleItems.length === 0) {
    throw AppError.badRequest('Cannot publish a schedule without schedule items');
  }
  const presMap = await resolvePresentations(scheduleItems.map((i: any) => i.presentation_id), db);

  const missingPresentationIds = Array.from(
    new Set(scheduleItems.map((item: any) => item.presentation_id).filter((presentationId: string) => !presMap.has(presentationId)))
  );
  if (missingPresentationIds.length > 0) {
    throw AppError.badRequest('One or more schedule items reference a missing presentation', {
      reason: 'MISSING_PRESENTATION',
      presentation_ids: missingPresentationIds,
    });
  }

  const invalidPresentationRefs: Array<{ presentation_id: string; issue: string; media_id?: string | null }> = [];
  for (const presentation of presMap.values()) {
    if ((presentation as any)?.layout_id && !presentation.layout) {
      invalidPresentationRefs.push({
        presentation_id: presentation.id,
        issue: 'MISSING_LAYOUT',
      });
    }

    for (const item of presentation.items || []) {
      if (!item.media) {
        invalidPresentationRefs.push({
          presentation_id: presentation.id,
          issue: 'MISSING_MEDIA',
          media_id: item.media_id,
        });
        continue;
      }
      if (item.media.status !== 'READY') {
        invalidPresentationRefs.push({
          presentation_id: presentation.id,
          issue: 'MEDIA_NOT_READY',
          media_id: item.media.id,
        });
      }
    }

    for (const slot of presentation.slots || []) {
      if (!slot.media) {
        invalidPresentationRefs.push({
          presentation_id: presentation.id,
          issue: 'MISSING_MEDIA',
          media_id: slot.media_id,
        });
        continue;
      }
      if (slot.media.status !== 'READY') {
        invalidPresentationRefs.push({
          presentation_id: presentation.id,
          issue: 'MEDIA_NOT_READY',
          media_id: slot.media.id,
        });
      }
    }
  }

  if (invalidPresentationRefs.length > 0) {
    throw AppError.badRequest('Schedule references missing or non-ready presentation assets', {
      reason: 'INVALID_PRESENTATION_ASSETS',
      invalid_references: invalidPresentationRefs,
    });
  }

  const uniqueGroupIds = new Set<string>();
  (params.screenGroupIds || []).forEach((g) => uniqueGroupIds.add(g));
  scheduleItems.forEach((i: any) => (i.screen_group_ids || []).forEach((g: string) => uniqueGroupIds.add(g)));

  const groupMembers = uniqueGroupIds.size
    ? await db
        .select()
        .from(schema.screenGroupMembers)
        .where(inArray(schema.screenGroupMembers.group_id, Array.from(uniqueGroupIds) as any))
    : [];
  const groupMemberMap = new Map<string, string[]>();
  groupMembers.forEach((m: any) => {
    const arr = groupMemberMap.get(m.group_id) || [];
    arr.push(m.screen_id);
    groupMemberMap.set(m.group_id, arr);
  });

  const resolveGroupScreens = (groupIds: string[] = []) => {
    const result = new Set<string>();
    groupIds.forEach((gid) => {
      (groupMemberMap.get(gid) || []).forEach((sid) => result.add(sid));
    });
    return result;
  };

  const itemDerivedScreens = new Set<string>();
  scheduleItems.forEach((i: any) => {
    (i.screen_ids || []).forEach((sid: string) => itemDerivedScreens.add(sid));
    resolveGroupScreens(i.screen_group_ids || []).forEach((sid) => itemDerivedScreens.add(sid));
  });

  const resolvedScreenIds = new Set<string>();
  (params.screenIds || []).forEach((sid) => resolvedScreenIds.add(sid));
  resolveGroupScreens(params.screenGroupIds || []).forEach((sid) => resolvedScreenIds.add(sid));

  if (resolvedScreenIds.size === 0) {
    itemDerivedScreens.forEach((sid) => resolvedScreenIds.add(sid));
  }

  if (resolvedScreenIds.size === 0) {
    throw AppError.badRequest('No target screens found for publish');
  }

  const screenRows = await db
    .select({
      id: schema.screens.id,
      name: schema.screens.name,
      device_info: schema.screens.device_info,
    })
    .from(schema.screens)
    .where(inArray(schema.screens.id, Array.from(resolvedScreenIds) as any));

  const screenMap = new Map(
    screenRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        codecs: normalizeCodecList((row.device_info as Record<string, unknown> | null)?.codecs),
      },
    ])
  );

  const unsupportedTargets: Array<{
    screen_id: string;
    screen_name: string;
    media_id: string;
    media_name: string;
    required_codecs: string[];
  }> = [];

  scheduleItems.forEach((item: any) => {
    const targetedScreens = new Set<string>();
    (item.screen_ids || []).forEach((screenId: string) => targetedScreens.add(screenId));
    resolveGroupScreens(item.screen_group_ids || []).forEach((screenId) => targetedScreens.add(screenId));
    if (targetedScreens.size === 0) {
      resolvedScreenIds.forEach((screenId) => targetedScreens.add(screenId));
    }

    const presentation = presMap.get(item.presentation_id);
    const presentationMedia = [
      ...((presentation?.items || []) as any[]),
      ...((presentation?.slots || []) as any[]),
    ]
      .map((entry) => entry?.media)
      .filter(Boolean);

    presentationMedia.forEach((media: any) => {
      const requiredCodecs = inferRequiredCodecs(media);
      if (requiredCodecs.length === 0) return;

      targetedScreens.forEach((screenId) => {
        const screenInfo = screenMap.get(screenId);
        if (!screenInfo || screenInfo.codecs.length === 0) return;
        const supportsCodec = requiredCodecs.some((codec) => screenInfo.codecs.includes(codec));
        if (supportsCodec) return;

        unsupportedTargets.push({
          screen_id: screenInfo.id,
          screen_name: screenInfo.name,
          media_id: media.id,
          media_name: media.display_name ?? media.name,
          required_codecs: requiredCodecs,
        });
      });
    });
  });

  if (unsupportedTargets.length > 0) {
    throw AppError.conflict(
      'One or more target screens do not support the required media codec for this publish.',
      {
        reason: 'UNSUPPORTED_SCREEN_CODEC',
        unsupported_targets: unsupportedTargets,
      }
    );
  }

  const displayRows = await db
    .select({
      screen_id: schema.screenDisplayStates.screen_id,
      display_profile: schema.screenDisplayStates.display_profile,
      placement: schema.screenDisplayStates.placement,
      profile_revision: schema.screenDisplayStates.profile_revision,
    })
    .from(schema.screenDisplayStates)
    .where(inArray(schema.screenDisplayStates.screen_id, Array.from(resolvedScreenIds) as any));
  const displayByScreenId = new Map(displayRows.map((row) => [row.screen_id, row]));
  const legacyScreenById = new Map(
    (await db
      .select({ id: schema.screens.id, aspect_ratio: schema.screens.aspect_ratio, width: schema.screens.width, height: schema.screens.height })
      .from(schema.screens)
      .where(inArray(schema.screens.id, Array.from(resolvedScreenIds) as any)))
      .map((screen) => [screen.id, screen])
  );
  const screenAspect = (screenId: string) => {
    const profile = displayByScreenId.get(screenId)?.display_profile as any;
    const observed = profile?.output?.aspect?.numeric_value;
    if (typeof observed === 'number' && Number.isFinite(observed) && observed > 0) return observed;
    const legacy = legacyScreenById.get(screenId);
    return parseAspectRatio(legacy?.aspect_ratio) ??
      (legacy?.width && legacy?.height ? legacy.width / legacy.height : null);
  };
  const aspectIssues: Array<{
    screen_id: string;
    presentation_id: string;
    layout_aspect_ratio: string;
    screen_aspect_ratio: number | null;
    usable_area_fraction: number | null;
    profile_revision: number | null;
  }> = [];
  scheduleItems.forEach((item: any) => {
    const presentation = presMap.get(item.presentation_id);
    const layoutRatio = parseAspectRatio(presentation?.layout?.aspect_ratio);
    if (!layoutRatio) return;
    const targets = new Set<string>();
    (item.screen_ids || []).forEach((screenId: string) => targets.add(screenId));
    resolveGroupScreens(item.screen_group_ids || []).forEach((screenId) => targets.add(screenId));
    if (targets.size === 0) resolvedScreenIds.forEach((screenId) => targets.add(screenId));
    targets.forEach((screenId) => {
      const actual = screenAspect(screenId);
      if (actual !== null && !areAspectsCompatible(layoutRatio, actual)) {
        aspectIssues.push({
          screen_id: screenId,
          presentation_id: presentation.id,
          layout_aspect_ratio: presentation.layout.aspect_ratio,
          screen_aspect_ratio: actual,
          usable_area_fraction: Math.min(layoutRatio / actual, actual / layoutRatio),
          profile_revision: displayByScreenId.get(screenId)?.profile_revision ?? null,
        });
      }
    });
  });
  if (aspectIssues.length > 0) {
    const issueHash = createHash('sha256')
      .update(JSON.stringify(aspectIssues.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))))
      .digest('hex');
    if (!params.aspectOverride?.acknowledged || params.aspectOverride.issue_hash !== issueHash) {
      throw new AppError({
        statusCode: 409,
        code: 'DISPLAY_ASPECT_MISMATCH',
        message: 'One or more target displays have an incompatible aspect ratio. Review the preflight and explicitly confirm letterboxing.',
        details: { issue_hash: issueHash, issues: aspectIssues, compatibility_threshold: 0.995 },
      });
    }
  }

  const publishedAt = new Date().toISOString();
  const snapshotPayload = {
    schedule: {
      id: schedule.id,
      name: schedule.name,
      description: schedule.description,
      timezone: (schedule as any).timezone ?? null,
      start_at: schedule.start_at?.toISOString(),
      end_at: schedule.end_at?.toISOString(),
      is_active: schedule.is_active,
      items: scheduleItems.map((i: any) => {
        const pres = presMap.get(i.presentation_id);
        return {
          id: i.id,
          presentation_id: i.presentation_id,
          start_at: i.start_at.toISOString?.() ?? i.start_at,
          end_at: i.end_at.toISOString?.() ?? i.end_at,
          priority: i.priority,
          screen_ids: i.screen_ids || [],
          screen_group_ids: i.screen_group_ids || [],
          presentation: pres
            ? {
                id: pres.id,
                name: pres.name,
                description: pres.description,
                layout: pres.layout
                  ? {
                      id: pres.layout.id,
                      name: pres.layout.name,
                      description: pres.layout.description,
                      aspect_ratio: pres.layout.aspect_ratio,
                      spec: pres.layout.spec,
                    }
                  : null,
                items: (pres.items || []).map((pi: any) => ({
                  id: pi.id,
                  media_id: pi.media_id,
                  order: pi.order,
                  duration_seconds: pi.duration_seconds,
                  media: pi.media ? serializeMediaRecord(pi.media) : null,
                })),
                slots: (pres.slots || []).map((si: any) => ({
                  id: si.id,
                  slot_id: si.slot_id,
                  media_id: si.media_id,
                  order: si.order,
                  duration_seconds: si.duration_seconds,
                  fit_mode: si.fit_mode,
                  audio_enabled: si.audio_enabled,
                  loop_enabled: si.loop_enabled ?? false,
                  media: si.media ? serializeMediaRecord(si.media) : null,
                })),
              }
            : null,
        };
      }),
    },
    targets: {
      screen_ids: params.screenIds || [],
      screen_group_ids: params.screenGroupIds || [],
      resolved_screen_ids: Array.from(resolvedScreenIds),
    },
    published_at: publishedAt,
    notes: params.notes ?? null,
  };

  const targetRows: { screen_id?: string; screen_group_id?: string }[] = [];
  const seenScreens = new Set<string>();

  (params.screenGroupIds || []).forEach((gid) => targetRows.push({ screen_group_id: gid }));

  resolveGroupScreens(params.screenGroupIds || []).forEach((sid) => {
    if (!seenScreens.has(sid)) {
      targetRows.push({ screen_id: sid });
      seenScreens.add(sid);
    }
  });

  resolvedScreenIds.forEach((sid) => {
    if (!seenScreens.has(sid)) {
      targetRows.push({ screen_id: sid });
      seenScreens.add(sid);
    }
  });

  const transactionalResult = await db.transaction(async (tx) => {
    const [snapshot] = await tx
      .insert(schema.scheduleSnapshots)
      .values({
        schedule_id: schedule.id,
        payload: snapshotPayload,
      })
      .returning();

    const [publish] = await tx
      .insert(schema.publishes)
      .values({
        schedule_id: schedule.id,
        snapshot_id: snapshot.id,
        published_by: params.publishedBy,
      })
      .returning();

    if (targetRows.length > 0) {
      await tx
        .insert(schema.publishTargets)
        .values(
          targetRows.map((t) => ({
            publish_id: publish.id,
            screen_id: t.screen_id,
            screen_group_id: t.screen_group_id,
          }))
        );
    }

    if (params.onPublished) {
      await params.onPublished({
        tx: tx as DB,
        publish,
        snapshot,
        schedule,
        scheduleItems,
        resolvedScreenIds: Array.from(resolvedScreenIds),
      });
    }

    return { snapshot, publish };
  });

  return {
    publish: transactionalResult.publish,
    snapshot: transactionalResult.snapshot,
    targets: targetRows,
    schedule,
    scheduleItems,
    resolvedScreenIds: Array.from(resolvedScreenIds),
  };
}
