import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { createRequestRepository } from '../db/repositories/request.js';
import { createRequestMessageRepository } from '../db/repositories/request-message.js';
import { extractTokenFromHeader, verifyAccessToken } from '../auth/jwt.js';
import { createLogger } from '../utils/logger.js';
import { createUserRepository } from '../db/repositories/user.js';
import { getDatabase, schema } from '../db/index.js';
import { getPresignedUrl } from '../s3/index.js';
import { apiEndpoints } from '../config/apiEndpoints.js';
import { HTTP_STATUS } from '../http-status-codes.js';
import { respondWithError } from '../utils/errors.js';
import { AppError } from '../utils/app-error.js';
const logger = createLogger('request-routes');
const { CREATED } = HTTP_STATUS;
const createRequestSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    assigned_to: z.string().optional(),
});
const listRequestsQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']).optional(),
});
const createMessageSchema = z.object({
    message: z.string().min(1),
    attachments: z.array(z.string()).optional(),
});
export async function requestRoutes(fastify) {
    const reqRepo = createRequestRepository();
    const msgRepo = createRequestMessageRepository();
    const userRepo = createUserRepository();
    const db = getDatabase();
    const resolveAttachments = async (storageIds) => {
        if (!storageIds || storageIds.length === 0)
            return [];
        const rows = await db
            .select()
            .from(schema.storageObjects)
            .where(inArray(schema.storageObjects.id, storageIds));
        const map = new Map(rows.map((r) => [r.id, r]));
        return Promise.all(storageIds.map(async (id) => {
            const r = map.get(id);
            if (!r)
                return { id, url: null };
            return { id: r.id, url: await getPresignedUrl(r.bucket, r.object_key, 3600) };
        }));
    };
    // Create request
    fastify.post(apiEndpoints.requests.create, {
        schema: {
            description: 'Create a new request',
            tags: ['Requests'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            const payload = await verifyAccessToken(token);
            const data = createRequestSchema.parse(request.body);
            const req = await reqRepo.create({
                ...data,
                status: 'OPEN',
                created_by: payload.sub,
            });
            return reply.status(CREATED).send({
                id: req.id,
                title: req.title,
                description: req.description,
                status: req.status,
                priority: req.priority,
                created_by: req.created_by,
                assigned_to: req.assigned_to,
                attachments: [],
                created_at: req.created_at.toISOString(),
                updated_at: req.updated_at.toISOString(),
            });
        }
        catch (error) {
            logger.error(error, 'Create request error');
            return respondWithError(reply, error);
        }
    });
    // List requests
    fastify.get(apiEndpoints.requests.list, {
        schema: {
            description: 'List requests with pagination',
            tags: ['Requests'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            await verifyAccessToken(token);
            const query = listRequestsQuerySchema.parse(request.query);
            const result = await reqRepo.list({
                page: query.page,
                limit: query.limit,
                status: query.status,
            });
            return reply.send({
                items: result.items.map((r) => ({
                    id: r.id,
                    title: r.title,
                    description: r.description,
                    status: r.status,
                    priority: r.priority,
                    created_by: r.created_by,
                    assigned_to: r.assigned_to,
                    attachments: [],
                    created_at: r.created_at.toISOString(),
                    updated_at: r.updated_at.toISOString(),
                })),
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                },
            });
        }
        catch (error) {
            logger.error(error, 'List requests error');
            return respondWithError(reply, error);
        }
    });
    // Get request by ID
    fastify.get(apiEndpoints.requests.get, {
        schema: {
            description: 'Get request by ID',
            tags: ['Requests'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            await verifyAccessToken(token);
            const req = await reqRepo.findById(request.params.id);
            if (!req) {
                throw AppError.notFound('Request not found');
            }
            const attachments = await db
                .select()
                .from(schema.requestAttachments)
                .where(eq(schema.requestAttachments.request_id, req.id));
            const attachmentIds = attachments.map((a) => a.storage_object_id);
            const attachmentUrls = await resolveAttachments(attachmentIds);
            return reply.send({
                id: req.id,
                title: req.title,
                description: req.description,
                status: req.status,
                priority: req.priority,
                created_by: req.created_by,
                assigned_to: req.assigned_to,
                attachments: attachmentUrls,
                created_at: req.created_at.toISOString(),
                updated_at: req.updated_at.toISOString(),
            });
        }
        catch (error) {
            logger.error(error, 'Get request error');
            return respondWithError(reply, error);
        }
    });
    // Update request
    fastify.patch(apiEndpoints.requests.update, {
        schema: {
            description: 'Update request',
            tags: ['Requests'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            await verifyAccessToken(token);
            const data = createRequestSchema.partial().parse(request.body);
            const req = await reqRepo.update(request.params.id, data);
            if (!req) {
                throw AppError.notFound('Request not found');
            }
            return reply.send({
                id: req.id,
                title: req.title,
                description: req.description,
                status: req.status,
                priority: req.priority,
                created_by: req.created_by,
                assigned_to: req.assigned_to,
                attachments: [],
                created_at: req.created_at.toISOString(),
                updated_at: req.updated_at.toISOString(),
            });
        }
        catch (error) {
            logger.error(error, 'Update request error');
            return respondWithError(reply, error);
        }
    });
    // Add message to request
    fastify.post(apiEndpoints.requests.addMessage, {
        schema: {
            description: 'Add message to request',
            tags: ['Requests'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            const payload = await verifyAccessToken(token);
            const data = createMessageSchema.parse(request.body);
            const message = await msgRepo.create({
                request_id: request.params.id,
                user_id: payload.sub,
                message: data.message,
                attachments: data.attachments,
            });
            const author = await userRepo.findById(payload.sub);
            const attachmentUrls = await resolveAttachments(data.attachments);
            return reply.status(CREATED).send({
                id: message.id,
                request_id: message.request_id,
                user_id: message.author_id,
                author: author
                    ? {
                        id: author.id,
                        email: author.email,
                        first_name: author.first_name,
                        last_name: author.last_name,
                    }
                    : null,
                message: message.content,
                attachments: attachmentUrls,
                created_at: message.created_at.toISOString(),
                updated_at: null,
            });
        }
        catch (error) {
            logger.error(error, 'Add message error');
            return respondWithError(reply, error);
        }
    });
    // List messages for request
    fastify.get(apiEndpoints.requests.listMessages, {
        schema: {
            description: 'List messages for request',
            tags: ['Requests'],
            security: [{ bearerAuth: [] }],
        },
    }, async (request, reply) => {
        try {
            const token = extractTokenFromHeader(request.headers.authorization);
            if (!token) {
                throw AppError.unauthorized('Missing authorization header');
            }
            await verifyAccessToken(token);
            const page = request.query.page ? parseInt(request.query.page) : 1;
            const limit = request.query.limit ? parseInt(request.query.limit) : 50;
            const result = await msgRepo.listByRequest(request.params.id, { page, limit });
            // Fetch authors for messages
            const authorIds = Array.from(new Set(result.items.map((m) => m.author_id))).filter(Boolean);
            const authors = authorIds.length
                ? await db.select().from(schema.users).where(inArray(schema.users.id, authorIds))
                : [];
            const authorMap = new Map(authors.map((a) => [a.id, a]));
            // Resolve attachments for all messages
            const allAttachmentIds = result.items.flatMap((m) => m.attachments || []);
            const attachmentUrlMap = new Map();
            if (allAttachmentIds.length) {
                const attachmentRows = await db
                    .select()
                    .from(schema.storageObjects)
                    .where(inArray(schema.storageObjects.id, allAttachmentIds));
                for (const row of attachmentRows) {
                    attachmentUrlMap.set(row.id, {
                        id: row.id,
                        url: await getPresignedUrl(row.bucket, row.object_key, 3600),
                    });
                }
            }
            return reply.send({
                items: result.items.map((m) => ({
                    id: m.id,
                    request_id: m.request_id,
                    user_id: m.author_id,
                    author: authorMap.get(m.author_id)
                        ? {
                            id: authorMap.get(m.author_id).id,
                            email: authorMap.get(m.author_id).email,
                            first_name: authorMap.get(m.author_id).first_name,
                            last_name: authorMap.get(m.author_id).last_name,
                        }
                        : null,
                    message: m.content,
                    attachments: m.attachments
                        ? m.attachments.map((id) => attachmentUrlMap.get(id) || { id, url: null })
                        : [],
                    created_at: m.created_at.toISOString(),
                    updated_at: null,
                })),
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                },
            });
        }
        catch (error) {
            logger.error(error, 'List messages error');
            return respondWithError(reply, error);
        }
    });
}
