import { and, desc, eq, gt, inArray, isNull, or, sql, } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
import { AppError } from '../../utils/app-error.js';
const INDEFINITE_UNTIL = new Date('9999-12-31T23:59:59.999Z');
function isAdminRole(roleName) {
    return roleName === 'ADMIN' || roleName === 'SUPER_ADMIN';
}
function normalizeDmPair(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}
export class ChatRepository {
    async getConversationById(id) {
        const db = getDatabase();
        const [conversation] = await db
            .select()
            .from(schema.chatConversations)
            .where(eq(schema.chatConversations.id, id));
        return conversation || null;
    }
    async getMessageById(id) {
        const db = getDatabase();
        const [message] = await db
            .select()
            .from(schema.chatMessages)
            .where(eq(schema.chatMessages.id, id));
        return message || null;
    }
    async getConversationForMessage(messageId) {
        const db = getDatabase();
        const [row] = await db
            .select({
            conversation: schema.chatConversations,
            message: schema.chatMessages,
        })
            .from(schema.chatMessages)
            .innerJoin(schema.chatConversations, eq(schema.chatMessages.conversation_id, schema.chatConversations.id))
            .where(eq(schema.chatMessages.id, messageId));
        return row || null;
    }
    async getMember(conversationId, userId) {
        const db = getDatabase();
        const [member] = await db
            .select()
            .from(schema.chatMembers)
            .where(and(eq(schema.chatMembers.conversation_id, conversationId), eq(schema.chatMembers.user_id, userId), isNull(schema.chatMembers.left_at)));
        return member || null;
    }
    async listMembers(conversationId) {
        const db = getDatabase();
        return db
            .select()
            .from(schema.chatMembers)
            .where(and(eq(schema.chatMembers.conversation_id, conversationId), isNull(schema.chatMembers.left_at)));
    }
    async getModeration(conversationId, userId) {
        const db = getDatabase();
        const [row] = await db
            .select()
            .from(schema.chatModeration)
            .where(and(eq(schema.chatModeration.conversation_id, conversationId), eq(schema.chatModeration.user_id, userId)));
        return row || null;
    }
    async getOrCreateDm(userId, otherUserId) {
        const db = getDatabase();
        const pairKey = normalizeDmPair(userId, otherUserId);
        const findActiveDm = async () => {
            const [row] = await db
                .select()
                .from(schema.chatConversations)
                .where(and(eq(schema.chatConversations.type, 'DM'), eq(schema.chatConversations.dm_pair_key, pairKey), eq(schema.chatConversations.state, 'ACTIVE')))
                .limit(1);
            return row || null;
        };
        const upsertMembers = async (conversationId) => {
            await db
                .insert(schema.chatMembers)
                .values([
                {
                    conversation_id: conversationId,
                    user_id: userId,
                    role: 'MEMBER',
                    is_system: false,
                },
                {
                    conversation_id: conversationId,
                    user_id: otherUserId,
                    role: 'MEMBER',
                    is_system: false,
                },
            ])
                .onConflictDoNothing({
                target: [schema.chatMembers.conversation_id, schema.chatMembers.user_id],
            });
        };
        const existing = await findActiveDm();
        if (existing) {
            await upsertMembers(existing.id);
            return existing;
        }
        let created = null;
        try {
            const [inserted] = await db
                .insert(schema.chatConversations)
                .values({
                type: 'DM',
                dm_pair_key: pairKey,
                created_by: userId,
                invite_policy: 'INVITES_DISABLED',
                metadata: {},
            })
                .returning();
            created = inserted || null;
        }
        catch (error) {
            const pgCode = typeof error === 'object' && error && 'code' in error
                ? error.code
                : undefined;
            if (pgCode !== '23505')
                throw error;
            created = await findActiveDm();
        }
        if (!created) {
            throw AppError.internal('Failed to create DM conversation');
        }
        await upsertMembers(created.id);
        return created;
    }
    async ensureSystemAdmins(conversationId) {
        const db = getDatabase();
        const rows = await db
            .select({ id: schema.users.id })
            .from(schema.users)
            .innerJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
            .where(and(eq(schema.users.is_active, true), inArray(schema.roles.name, ['ADMIN', 'SUPER_ADMIN'])));
        if (!rows.length)
            return;
        await db
            .insert(schema.chatMembers)
            .values(rows.map((row) => ({
            conversation_id: conversationId,
            user_id: row.id,
            role: 'CHAT_ADMIN',
            is_system: true,
        })))
            .onConflictDoNothing({
            target: [schema.chatMembers.conversation_id, schema.chatMembers.user_id],
        });
    }
    async createConversation(input) {
        const db = getDatabase();
        const [conversation] = await db
            .insert(schema.chatConversations)
            .values({
            type: input.type,
            title: input.title,
            topic: input.topic,
            purpose: input.purpose,
            created_by: input.createdBy,
            invite_policy: input.type === 'DM'
                ? 'INVITES_DISABLED'
                : input.invite_policy || 'ANY_MEMBER_CAN_INVITE',
            metadata: input.metadata || {},
        })
            .returning();
        const members = Array.from(new Set([input.createdBy, ...(input.members || [])]));
        await db
            .insert(schema.chatMembers)
            .values(members.map((userId) => ({
            conversation_id: conversation.id,
            user_id: userId,
            role: userId === input.createdBy ? 'OWNER' : 'MEMBER',
            is_system: false,
        })))
            .onConflictDoNothing({
            target: [schema.chatMembers.conversation_id, schema.chatMembers.user_id],
        });
        if (conversation.type !== 'DM') {
            await this.ensureSystemAdmins(conversation.id);
        }
        return conversation;
    }
    async canAccessConversation(conversationId, userId, roleName) {
        const conversation = await this.getConversationById(conversationId);
        if (!conversation || conversation.state === 'DELETED')
            return false;
        if (conversation.type === 'FORUM_OPEN')
            return true;
        const member = await this.getMember(conversationId, userId);
        if (member)
            return true;
        if (conversation.type !== 'DM' && isAdminRole(roleName))
            return true;
        return false;
    }
    async isConversationAdmin(conversationId, userId, roleName) {
        const conversation = await this.getConversationById(conversationId);
        if (!conversation)
            return false;
        if (conversation.type !== 'DM' && isAdminRole(roleName))
            return true;
        const member = await this.getMember(conversationId, userId);
        if (!member)
            return false;
        return member.role === 'OWNER' || member.role === 'CHAT_ADMIN' || member.role === 'MOD';
    }
    async listConversations(userId) {
        const db = getDatabase();
        const baseRows = await db
            .select({
            conversation: schema.chatConversations,
            member_role: schema.chatMembers.role,
            member_user_id: schema.chatMembers.user_id,
        })
            .from(schema.chatConversations)
            .leftJoin(schema.chatMembers, and(eq(schema.chatMembers.conversation_id, schema.chatConversations.id), eq(schema.chatMembers.user_id, userId), isNull(schema.chatMembers.left_at)))
            .where(and(eq(schema.chatConversations.state, 'ACTIVE'), or(eq(schema.chatConversations.type, 'FORUM_OPEN'), eq(schema.chatMembers.user_id, userId))))
            .orderBy(desc(schema.chatConversations.updated_at));
        const conversationIds = baseRows.map((row) => row.conversation.id);
        if (!conversationIds.length)
            return [];
        const lastSeqSubquery = db
            .select({
            conversation_id: schema.chatMessages.conversation_id,
            max_seq: sql `max(${schema.chatMessages.seq})`.as('max_seq'),
        })
            .from(schema.chatMessages)
            .where(inArray(schema.chatMessages.conversation_id, conversationIds))
            .groupBy(schema.chatMessages.conversation_id)
            .as('last_seq_subquery');
        const lastMessageRows = await db
            .select({ message: schema.chatMessages })
            .from(lastSeqSubquery)
            .innerJoin(schema.chatMessages, and(eq(schema.chatMessages.conversation_id, lastSeqSubquery.conversation_id), eq(schema.chatMessages.seq, lastSeqSubquery.max_seq)));
        const lastMessageByConversation = new Map(lastMessageRows.map((row) => [row.message.conversation_id, row.message]));
        const unreadRows = await db
            .select({
            conversation_id: schema.chatMessages.conversation_id,
            unread_count: sql `count(*) FILTER (
          WHERE ${schema.chatMessages.deleted_at} IS NULL
            AND ${schema.chatMessages.seq} > COALESCE(${schema.chatReceipts.last_read_seq}, 0)
        )`,
        })
            .from(schema.chatMessages)
            .leftJoin(schema.chatReceipts, and(eq(schema.chatReceipts.conversation_id, schema.chatMessages.conversation_id), eq(schema.chatReceipts.user_id, userId)))
            .where(inArray(schema.chatMessages.conversation_id, conversationIds))
            .groupBy(schema.chatMessages.conversation_id, schema.chatReceipts.last_read_seq);
        const unreadByConversation = new Map(unreadRows.map((row) => [row.conversation_id, Number(row.unread_count || 0)]));
        return baseRows.map((row) => ({
            ...row.conversation,
            last_message: lastMessageByConversation.get(row.conversation.id) || null,
            unread_count: unreadByConversation.get(row.conversation.id) || 0,
            viewer_role: row.member_role ?? null,
            viewer_is_member: Boolean(row.member_user_id),
        }));
    }
    async listMessages(conversationId, options) {
        const db = getDatabase();
        const afterSeq = options.afterSeq ?? 0;
        const limit = options.limit ?? 50;
        const conditions = [
            eq(schema.chatMessages.conversation_id, conversationId),
            gt(schema.chatMessages.seq, afterSeq),
        ];
        if (options.threadRootId) {
            conditions.push(eq(schema.chatMessages.thread_root_id, options.threadRootId));
        }
        else {
            conditions.push(or(isNull(schema.chatMessages.thread_root_id), eq(schema.chatMessages.also_to_channel, true)));
        }
        const items = await db
            .select()
            .from(schema.chatMessages)
            .where(and(...conditions))
            .orderBy(schema.chatMessages.seq)
            .limit(limit);
        const messageIds = items.map((i) => i.id);
        const attachments = messageIds.length
            ? await db
                .select()
                .from(schema.chatAttachments)
                .where(inArray(schema.chatAttachments.message_id, messageIds))
            : [];
        const reactions = messageIds.length
            ? await db
                .select()
                .from(schema.chatReactions)
                .where(inArray(schema.chatReactions.message_id, messageIds))
            : [];
        const attMap = new Map();
        for (const attachment of attachments) {
            const list = attMap.get(attachment.message_id) || [];
            list.push(attachment);
            attMap.set(attachment.message_id, list);
        }
        const reactMap = new Map();
        for (const reaction of reactions) {
            const list = reactMap.get(reaction.message_id) || [];
            list.push(reaction);
            reactMap.set(reaction.message_id, list);
        }
        return items.map((item) => {
            if (item.deleted_at) {
                return {
                    ...item,
                    body_text: null,
                    body_rich: null,
                    attachments: [],
                    reactions: [],
                };
            }
            return {
                ...item,
                attachments: attMap.get(item.id) || [],
                reactions: reactMap.get(item.id) || [],
            };
        });
    }
    async sendMessageTx(input) {
        const db = getDatabase();
        return db.transaction(async (tx) => {
            const [conversation] = await tx
                .select()
                .from(schema.chatConversations)
                .where(eq(schema.chatConversations.id, input.conversationId));
            if (!conversation)
                throw AppError.notFound('Conversation not found');
            if (conversation.state !== 'ACTIVE')
                throw AppError.conflict('Conversation is not active');
            let threadRootId = null;
            let threadRootSenderId = null;
            if (input.replyToMessageId) {
                const [parentMessage] = await tx
                    .select()
                    .from(schema.chatMessages)
                    .where(eq(schema.chatMessages.id, input.replyToMessageId));
                if (!parentMessage || parentMessage.conversation_id !== input.conversationId) {
                    throw AppError.badRequest('replyTo message is invalid');
                }
                threadRootId = parentMessage.thread_root_id || parentMessage.id;
                threadRootSenderId = parentMessage.sender_id;
            }
            const [seqRow] = await tx
                .update(schema.chatConversations)
                .set({
                last_seq: sql `${schema.chatConversations.last_seq} + 1`,
                updated_at: new Date(),
            })
                .where(eq(schema.chatConversations.id, input.conversationId))
                .returning({ seq: schema.chatConversations.last_seq });
            const nextSeq = seqRow?.seq;
            if (!nextSeq)
                throw AppError.internal('Failed to allocate sequence');
            const [message] = await tx
                .insert(schema.chatMessages)
                .values({
                conversation_id: input.conversationId,
                seq: nextSeq,
                sender_id: input.senderId,
                body_text: input.bodyText,
                body_rich: input.bodyRich,
                also_to_channel: Boolean(input.alsoToChannel),
                reply_to_message_id: input.replyToMessageId,
                thread_root_id: threadRootId,
            })
                .returning();
            if (threadRootId) {
                await tx
                    .update(schema.chatMessages)
                    .set({
                    thread_reply_count: sql `${schema.chatMessages.thread_reply_count} + 1`,
                })
                    .where(eq(schema.chatMessages.id, threadRootId));
            }
            if (input.attachmentMediaIds?.length) {
                await tx.insert(schema.chatAttachments).values(input.attachmentMediaIds.map((mediaAssetId, index) => ({
                    message_id: message.id,
                    media_asset_id: mediaAssetId,
                    ord: index,
                })));
            }
            return { conversation, message, threadRootSenderId };
        });
    }
    async editMessage(input) {
        const db = getDatabase();
        return db.transaction(async (tx) => {
            const [message] = await tx
                .select()
                .from(schema.chatMessages)
                .where(eq(schema.chatMessages.id, input.messageId));
            if (!message)
                throw AppError.notFound('Message not found');
            await tx.insert(schema.chatMessageRevisions).values({
                message_id: message.id,
                editor_id: input.editorId,
                action: 'EDIT',
                old_body_text: message.body_text,
                old_body_rich: message.body_rich,
                new_body_text: input.newBodyText,
                new_body_rich: input.newBodyRich,
            });
            const [updated] = await tx
                .update(schema.chatMessages)
                .set({
                body_text: input.newBodyText,
                body_rich: input.newBodyRich ?? message.body_rich,
                edited_at: new Date(),
            })
                .where(eq(schema.chatMessages.id, input.messageId))
                .returning();
            return updated;
        });
    }
    async softDeleteMessage(input) {
        const db = getDatabase();
        return db.transaction(async (tx) => {
            const [message] = await tx
                .select()
                .from(schema.chatMessages)
                .where(eq(schema.chatMessages.id, input.messageId));
            if (!message)
                throw AppError.notFound('Message not found');
            const attachments = await tx
                .select({ media_asset_id: schema.chatAttachments.media_asset_id })
                .from(schema.chatAttachments)
                .where(eq(schema.chatAttachments.message_id, input.messageId));
            const detachedMediaAssetIds = Array.from(new Set(attachments.map((attachment) => attachment.media_asset_id)));
            await tx.insert(schema.chatMessageRevisions).values({
                message_id: message.id,
                editor_id: input.editorId,
                action: 'DELETE',
                old_body_text: message.body_text,
                old_body_rich: message.body_rich,
            });
            const [updated] = await tx
                .update(schema.chatMessages)
                .set({
                deleted_at: new Date(),
                edited_at: new Date(),
                body_text: null,
                body_rich: null,
            })
                .where(eq(schema.chatMessages.id, input.messageId))
                .returning();
            if (attachments.length > 0) {
                await tx
                    .delete(schema.chatAttachments)
                    .where(eq(schema.chatAttachments.message_id, input.messageId));
            }
            return {
                message: updated,
                detachedMediaAssetIds,
            };
        });
    }
    async updateReaction(input) {
        const db = getDatabase();
        const [message] = await db
            .select()
            .from(schema.chatMessages)
            .where(eq(schema.chatMessages.id, input.messageId));
        if (!message)
            throw AppError.notFound('Message not found');
        if (input.op === 'add') {
            await db
                .insert(schema.chatReactions)
                .values({
                message_id: input.messageId,
                user_id: input.userId,
                emoji: input.emoji,
            })
                .onConflictDoNothing({
                target: [
                    schema.chatReactions.message_id,
                    schema.chatReactions.user_id,
                    schema.chatReactions.emoji,
                ],
            });
        }
        else {
            await db
                .delete(schema.chatReactions)
                .where(and(eq(schema.chatReactions.message_id, input.messageId), eq(schema.chatReactions.user_id, input.userId), eq(schema.chatReactions.emoji, input.emoji)));
        }
        const reactions = await db
            .select()
            .from(schema.chatReactions)
            .where(eq(schema.chatReactions.message_id, input.messageId));
        return { message, reactions };
    }
    async pinMessage(input) {
        const db = getDatabase();
        const [message] = await db
            .select()
            .from(schema.chatMessages)
            .where(and(eq(schema.chatMessages.id, input.messageId), eq(schema.chatMessages.conversation_id, input.conversationId)));
        if (!message)
            throw AppError.notFound('Message not found');
        if (message.deleted_at)
            throw AppError.badRequest('Deleted message cannot be pinned');
        const [pin] = await db
            .insert(schema.chatPins)
            .values({
            conversation_id: input.conversationId,
            message_id: input.messageId,
            pinned_by: input.pinnedBy,
        })
            .onConflictDoUpdate({
            target: [schema.chatPins.conversation_id, schema.chatPins.message_id],
            set: {
                pinned_by: input.pinnedBy,
                pinned_at: new Date(),
            },
        })
            .returning();
        return pin;
    }
    async unpinMessage(conversationId, messageId) {
        const db = getDatabase();
        const rows = await db
            .delete(schema.chatPins)
            .where(and(eq(schema.chatPins.conversation_id, conversationId), eq(schema.chatPins.message_id, messageId)))
            .returning({ id: schema.chatPins.id });
        return rows.length > 0;
    }
    async listPins(conversationId) {
        const db = getDatabase();
        const rows = await db
            .select({
            pin: schema.chatPins,
            message: schema.chatMessages,
        })
            .from(schema.chatPins)
            .innerJoin(schema.chatMessages, eq(schema.chatPins.message_id, schema.chatMessages.id))
            .where(eq(schema.chatPins.conversation_id, conversationId))
            .orderBy(desc(schema.chatPins.pinned_at));
        return rows.map((row) => ({
            ...row.pin,
            message: row.message.deleted_at
                ? {
                    ...row.message,
                    body_text: null,
                    body_rich: null,
                }
                : row.message,
        }));
    }
    async createBookmark(input) {
        const db = getDatabase();
        if (input.type === 'LINK' && !input.url) {
            throw AppError.badRequest('url is required for LINK bookmark');
        }
        if (input.type === 'FILE' && !input.mediaAssetId) {
            throw AppError.badRequest('mediaAssetId is required for FILE bookmark');
        }
        if (input.type === 'MESSAGE' && !input.messageId) {
            throw AppError.badRequest('messageId is required for MESSAGE bookmark');
        }
        if (input.messageId) {
            const [message] = await db
                .select()
                .from(schema.chatMessages)
                .where(eq(schema.chatMessages.id, input.messageId));
            if (!message || message.conversation_id !== input.conversationId) {
                throw AppError.badRequest('messageId is invalid for this conversation');
            }
        }
        const uniqueTargetCondition = input.type === 'LINK'
            ? and(eq(schema.chatBookmarks.conversation_id, input.conversationId), eq(schema.chatBookmarks.type, 'LINK'), eq(schema.chatBookmarks.url, input.url))
            : input.type === 'FILE'
                ? and(eq(schema.chatBookmarks.conversation_id, input.conversationId), eq(schema.chatBookmarks.type, 'FILE'), eq(schema.chatBookmarks.media_asset_id, input.mediaAssetId))
                : and(eq(schema.chatBookmarks.conversation_id, input.conversationId), eq(schema.chatBookmarks.type, 'MESSAGE'), eq(schema.chatBookmarks.message_id, input.messageId));
        const [existing] = await db
            .select()
            .from(schema.chatBookmarks)
            .where(uniqueTargetCondition)
            .orderBy(desc(schema.chatBookmarks.created_at))
            .limit(1);
        if (existing) {
            return { bookmark: existing, created: false };
        }
        const [bookmark] = await db
            .insert(schema.chatBookmarks)
            .values({
            conversation_id: input.conversationId,
            type: input.type,
            label: input.label,
            emoji: input.emoji,
            url: input.url,
            media_asset_id: input.mediaAssetId,
            message_id: input.messageId,
            created_by: input.createdBy,
            metadata: input.metadata,
        })
            .returning();
        return { bookmark, created: true };
    }
    async listBookmarks(conversationId) {
        const db = getDatabase();
        return db
            .select()
            .from(schema.chatBookmarks)
            .where(eq(schema.chatBookmarks.conversation_id, conversationId))
            .orderBy(desc(schema.chatBookmarks.created_at));
    }
    async getBookmarkById(id) {
        const db = getDatabase();
        const [bookmark] = await db
            .select()
            .from(schema.chatBookmarks)
            .where(eq(schema.chatBookmarks.id, id));
        return bookmark || null;
    }
    async deleteBookmark(id) {
        const db = getDatabase();
        const [deleted] = await db
            .delete(schema.chatBookmarks)
            .where(eq(schema.chatBookmarks.id, id))
            .returning();
        return deleted || null;
    }
    async markRead(conversationId, userId, lastReadSeq) {
        const db = getDatabase();
        const [receipt] = await db
            .insert(schema.chatReceipts)
            .values({
            conversation_id: conversationId,
            user_id: userId,
            last_read_seq: lastReadSeq,
            last_delivered_seq: lastReadSeq,
            updated_at: new Date(),
        })
            .onConflictDoUpdate({
            target: [schema.chatReceipts.conversation_id, schema.chatReceipts.user_id],
            set: {
                last_read_seq: sql `GREATEST(${schema.chatReceipts.last_read_seq}, ${lastReadSeq})`,
                last_delivered_seq: sql `GREATEST(${schema.chatReceipts.last_delivered_seq}, ${lastReadSeq})`,
                updated_at: new Date(),
            },
        })
            .returning();
        return receipt;
    }
    async applyModerationAction(input) {
        const db = getDatabase();
        const [existing] = await db
            .select()
            .from(schema.chatModeration)
            .where(and(eq(schema.chatModeration.conversation_id, input.conversationId), eq(schema.chatModeration.user_id, input.userId)));
        if (input.action === 'UNMUTE' || input.action === 'UNBAN') {
            if (!existing)
                return null;
            const [updated] = await db
                .update(schema.chatModeration)
                .set({
                muted_until: input.action === 'UNMUTE' ? null : existing.muted_until,
                banned_until: input.action === 'UNBAN' ? null : existing.banned_until,
                reason: input.reason ?? existing.reason,
                updated_at: new Date(),
            })
                .where(eq(schema.chatModeration.id, existing.id))
                .returning();
            return updated || null;
        }
        const until = input.until ?? INDEFINITE_UNTIL;
        if (until.getTime() <= Date.now()) {
            throw AppError.badRequest('Moderation expiry must be in the future');
        }
        if (existing) {
            const [updated] = await db
                .update(schema.chatModeration)
                .set({
                muted_until: input.action === 'MUTE' ? until : existing.muted_until,
                banned_until: input.action === 'BAN' ? until : existing.banned_until,
                reason: input.reason ?? existing.reason,
                updated_at: new Date(),
            })
                .where(eq(schema.chatModeration.id, existing.id))
                .returning();
            return updated || null;
        }
        const [created] = await db
            .insert(schema.chatModeration)
            .values({
            conversation_id: input.conversationId,
            user_id: input.userId,
            muted_until: input.action === 'MUTE' ? until : null,
            banned_until: input.action === 'BAN' ? until : null,
            reason: input.reason ?? null,
            updated_at: new Date(),
        })
            .returning();
        return created || null;
    }
    async inviteMembers(conversationId, userIds, role = 'MEMBER') {
        const db = getDatabase();
        if (!userIds.length)
            return;
        await db
            .insert(schema.chatMembers)
            .values(userIds.map((userId) => ({
            conversation_id: conversationId,
            user_id: userId,
            role,
            is_system: false,
            left_at: null,
        })))
            .onConflictDoUpdate({
            target: [schema.chatMembers.conversation_id, schema.chatMembers.user_id],
            set: {
                left_at: null,
                role,
            },
        });
    }
    async removeMember(conversationId, userId) {
        const db = getDatabase();
        const [member] = await db
            .select()
            .from(schema.chatMembers)
            .where(and(eq(schema.chatMembers.conversation_id, conversationId), eq(schema.chatMembers.user_id, userId), isNull(schema.chatMembers.left_at)));
        if (!member)
            throw AppError.notFound('Member not found');
        if (member.is_system)
            throw AppError.forbidden('System member cannot be removed');
        await db
            .update(schema.chatMembers)
            .set({ left_at: new Date() })
            .where(eq(schema.chatMembers.id, member.id));
    }
    async updateConversation(conversationId, patch) {
        const db = getDatabase();
        const [updated] = await db
            .update(schema.chatConversations)
            .set({
            ...patch,
            updated_at: new Date(),
        })
            .where(eq(schema.chatConversations.id, conversationId))
            .returning();
        return updated || null;
    }
    async archiveConversation(conversationId) {
        const db = getDatabase();
        const [updated] = await db
            .update(schema.chatConversations)
            .set({
            state: 'ARCHIVED',
            archived_at: new Date(),
            updated_at: new Date(),
        })
            .where(eq(schema.chatConversations.id, conversationId))
            .returning();
        return updated || null;
    }
    async unarchiveConversation(conversationId) {
        const db = getDatabase();
        const [updated] = await db
            .update(schema.chatConversations)
            .set({
            state: 'ACTIVE',
            archived_at: null,
            updated_at: new Date(),
        })
            .where(eq(schema.chatConversations.id, conversationId))
            .returning();
        return updated || null;
    }
    async hardDeleteConversation(conversationId) {
        const db = getDatabase();
        return db.transaction(async (tx) => {
            const [conversation] = await tx
                .select()
                .from(schema.chatConversations)
                .where(eq(schema.chatConversations.id, conversationId));
            if (!conversation)
                throw AppError.notFound('Conversation not found');
            const messageIdsRows = await tx
                .select({ id: schema.chatMessages.id })
                .from(schema.chatMessages)
                .where(eq(schema.chatMessages.conversation_id, conversationId));
            const messageIds = messageIdsRows.map((row) => row.id);
            const mediaRows = messageIds.length
                ? await tx
                    .select({ media_asset_id: schema.chatAttachments.media_asset_id })
                    .from(schema.chatAttachments)
                    .where(inArray(schema.chatAttachments.message_id, messageIds))
                : [];
            const mediaAssetIds = Array.from(new Set(mediaRows.map((row) => row.media_asset_id)));
            if (messageIds.length) {
                await tx
                    .delete(schema.chatReactions)
                    .where(inArray(schema.chatReactions.message_id, messageIds));
                await tx
                    .delete(schema.chatAttachments)
                    .where(inArray(schema.chatAttachments.message_id, messageIds));
                await tx
                    .delete(schema.chatMessageRevisions)
                    .where(inArray(schema.chatMessageRevisions.message_id, messageIds));
            }
            await tx
                .delete(schema.chatMessages)
                .where(eq(schema.chatMessages.conversation_id, conversationId));
            await tx
                .delete(schema.chatReceipts)
                .where(eq(schema.chatReceipts.conversation_id, conversationId));
            await tx
                .delete(schema.chatModeration)
                .where(eq(schema.chatModeration.conversation_id, conversationId));
            await tx
                .delete(schema.chatMembers)
                .where(eq(schema.chatMembers.conversation_id, conversationId));
            await tx
                .delete(schema.chatPins)
                .where(eq(schema.chatPins.conversation_id, conversationId));
            await tx
                .delete(schema.chatBookmarks)
                .where(eq(schema.chatBookmarks.conversation_id, conversationId));
            const [updated] = await tx
                .update(schema.chatConversations)
                .set({
                state: 'DELETED',
                deleted_at: new Date(),
                updated_at: new Date(),
            })
                .where(eq(schema.chatConversations.id, conversationId))
                .returning();
            return { conversation: updated, mediaAssetIds };
        });
    }
}
export function createChatRepository() {
    return new ChatRepository();
}
