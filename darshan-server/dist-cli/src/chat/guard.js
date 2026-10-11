import { AppError } from '../utils/app-error.js';
function normalizeDate(value) {
    if (!value)
        return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
export function getActiveModeration(input) {
    const now = Date.now();
    const mutedUntil = normalizeDate(input?.muted_until);
    const bannedUntil = normalizeDate(input?.banned_until);
    return {
        mutedUntil: mutedUntil && mutedUntil.getTime() > now ? mutedUntil : null,
        bannedUntil: bannedUntil && bannedUntil.getTime() > now ? bannedUntil : null,
    };
}
export function assertNotBanned(input) {
    const { bannedUntil } = getActiveModeration(input);
    if (!bannedUntil)
        return;
    throw new AppError({
        statusCode: 403,
        code: 'CHAT_BANNED',
        message: 'You are banned from this conversation',
        details: { banned_until: bannedUntil.toISOString() },
    });
}
export function assertConversationWritable(conversation) {
    if (conversation.state === 'ARCHIVED') {
        throw new AppError({
            statusCode: 409,
            code: 'CHAT_ARCHIVED',
            message: 'Conversation is archived and read-only',
            details: null,
        });
    }
}
export function assertCanWriteToConversation(conversation, moderation) {
    assertConversationWritable(conversation);
    assertNotBanned(moderation);
    const { mutedUntil } = getActiveModeration(moderation);
    if (!mutedUntil)
        return;
    throw new AppError({
        statusCode: 403,
        code: 'CHAT_MUTED',
        message: 'You are muted in this conversation',
        details: { muted_until: mutedUntil.toISOString() },
    });
}
