import { z } from 'zod';
import { config as appConfig } from '../config/index.js';
const sharedMediaCreateSchema = z.object({
    name: z.string().min(1, 'Name is required').max(255),
    display_name: z
        .string()
        .trim()
        .min(1, 'Display name is required')
        .max(255)
        .optional(),
});
export const createMediaSchema = z.union([
    sharedMediaCreateSchema.extend({
        type: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT']),
    }),
    sharedMediaCreateSchema.extend({
        type: z.literal('WEBPAGE'),
        source_url: z.string().url('A valid webpage URL is required'),
    }),
]);
const allowedContentTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
export const presignUploadSchema = z.object({
    filename: z
        .string()
        .min(1)
        .transform((val) => val.replace(/[^\\w.\\-]+/g, '_')),
    content_type: z.enum(allowedContentTypes),
    display_name: z.string().trim().min(1).max(255).optional(),
    size: z
        .number()
        .positive()
        .max(appConfig.MAX_UPLOAD_MB * 1024 * 1024, `File too large (max ${appConfig.MAX_UPLOAD_MB} MB)`),
});
const uploadSessionFileSchema = z.object({
    filename: z
        .string()
        .min(1)
        .transform((val) => val.replace(/[^\w.-]+/g, '_')),
    display_name: z.string().trim().min(1).max(255).optional(),
    content_type: z.enum(allowedContentTypes),
    size: z
        .number()
        .int()
        .positive()
        .max(appConfig.MAX_UPLOAD_MB * 1024 * 1024, `File too large (max ${appConfig.MAX_UPLOAD_MB} MB)`),
    checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/, 'checksum_sha256 must be a lowercase SHA-256 hex digest'),
});
export const createUploadSessionSchema = uploadSessionFileSchema;
export const uploadSessionParamsSchema = z.object({
    sessionId: z.string().uuid(),
});
export const uploadPartPresignSchema = z.object({
    part_numbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(20),
});
export const completeUploadSessionSchema = z.object({
    parts: z
        .array(z.object({
        part_number: z.number().int().min(1).max(10_000),
        etag: z.string().min(1).max(512),
    }))
        .optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    duration_seconds: z.number().int().positive().optional(),
});
export const presignUploadResponseSchema = z.object({
    upload_url: z.string().url(),
    media_id: z.string().uuid(),
    expires_in: z.number(),
    bucket: z.string().optional(),
    object_key: z.string().optional(),
    original_filename: z.string().optional(),
});
export const completeUploadSchema = z.object({
    content_type: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    duration_seconds: z.number().int().positive().optional(),
});
export const processMediaSchema = z.object({
    quality: z.enum(['low', 'medium', 'high']).optional().default('medium'),
});
export const mediaResponseSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'WEBPAGE']),
    status: z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']),
    duration_seconds: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    created_by: z.string().uuid(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
});
export const listMediaQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    type: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'WEBPAGE']).optional()),
    status: z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']).optional(),
});
