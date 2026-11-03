import { z } from 'zod';

const editableFields = {
  name: z.string().trim().min(1).max(255),
  description: z.string().max(4000).nullable().optional(),
  presenter_user_id: z.string().uuid(),
  microphone: z.boolean().optional(),
  screen_share_audio: z.boolean().optional(),
  is_active: z.boolean().optional(),
};

export const createLiveSessionSchema = z.object(editableFields).strict();
export const updateLiveSessionSchema = createLiveSessionSchema.partial().extend({
  expected_revision: z.number().int().positive(),
}).strict().refine(value => Object.keys(value).some(key => key !== 'expected_revision'), {
  message: 'At least one editable field is required',
});
export const deleteLiveSessionSchema = z.object({ expected_revision: z.number().int().positive() }).strict();
export const liveSessionParamsSchema = z.object({ id: z.string().uuid() });
export const listLiveSessionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(255).optional(),
  active_only: z.enum(['true', 'false']).optional(),
}).strict();

export type CreateLiveSession = z.infer<typeof createLiveSessionSchema>;
export type UpdateLiveSession = z.infer<typeof updateLiveSessionSchema>;
