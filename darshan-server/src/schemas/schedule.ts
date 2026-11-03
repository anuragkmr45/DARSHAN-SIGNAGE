import { z } from 'zod';

export const createScheduleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  timezone: z.string().min(1).max(100).optional(),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
});

export type CreateScheduleRequest = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  timezone: z.string().min(1).max(100).optional().nullable(),
  is_active: z.boolean().optional(),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
});

export type UpdateScheduleRequest = z.infer<typeof updateScheduleSchema>;

export const createScheduleItemSchema = z.object({
  presentation_id: z.string().uuid(),
  source_kind: z.enum(['PRESENTATION', 'LIVE']).default('PRESENTATION'),
  live_session_id: z.string().uuid().nullable().optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  priority: z.number().int().default(0),
  screen_ids: z.array(z.string().uuid()).default([]),
  screen_group_ids: z.array(z.string().uuid()).default([]),
}).superRefine((item, context) => {
  if ((item.source_kind === 'LIVE') !== Boolean(item.live_session_id)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['live_session_id'],
      message: item.source_kind === 'LIVE' ? 'A live source is required for a live schedule item' : 'Only live schedule items may reference a live source' });
  }
});

export type CreateScheduleItemRequest = z.infer<typeof createScheduleItemSchema>;

export const liveFallbackPreparationIdsSchema = z.record(z.string().uuid(), z.string().uuid());

export const publishScheduleSchema = z.object({
  screen_ids: z.array(z.string().uuid()).optional(),
  screen_group_ids: z.array(z.string().uuid()).optional(),
  notes: z.string().optional(),
  schedule_request_id: z.string().uuid().optional(),
  fallback_preparation_ids: liveFallbackPreparationIdsSchema.default({}),
  expected_live_fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  aspect_override: z
    .object({
      acknowledged: z.literal(true),
      issue_hash: z.string().regex(/^[a-f0-9]{64}$/),
      reason: z.string().min(3).max(500).optional(),
    })
    .optional(),
});

export type PublishScheduleRequest = z.infer<typeof publishScheduleSchema>;

export const livePreflightSchema = z.object({
  schedule_id: z.string().uuid(),
  screen_ids: z.array(z.string().uuid()).optional(),
  screen_group_ids: z.array(z.string().uuid()).optional(),
  fallback_preparation_ids: liveFallbackPreparationIdsSchema.default({}),
}).strict();

export const displayPreflightSchema = z.object({
  schedule_id: z.string().uuid(),
  screen_ids: z.array(z.string().uuid()).optional(),
  screen_group_ids: z.array(z.string().uuid()).optional(),
});

export const scheduleResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  timezone: z.string().nullable().optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  is_active: z.boolean(),
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;

export const scheduleSnapshotResponseSchema = z.object({
  id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  payload: z.record(z.any()),
  created_at: z.string().datetime(),
});

export type ScheduleSnapshotResponse = z.infer<typeof scheduleSnapshotResponseSchema>;

export const listSchedulesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  is_active: z.enum(['true', 'false']).optional(),
});

export type ListSchedulesQuery = z.infer<typeof listSchedulesQuerySchema>;
