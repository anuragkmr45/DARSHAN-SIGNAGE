import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeNotificationRecipients, notifyMessageEvent } from '@/chat/notify';

const createMock = vi.fn();

vi.mock('@/db/repositories/notification', () => ({
  createNotificationRepository: () => ({
    create: createMock,
  }),
}));

describe('computeNotificationRecipients', () => {
  it('creates DM notification for the other participant only', () => {
    const recipients = computeNotificationRecipients({
      conversation: {
        id: 'conv-1',
        type: 'DM',
        participantA: 'user-a',
        participantB: 'user-b',
      },
      message: { id: 'm1', body_text: 'hello' },
      senderId: 'user-a',
    });

    expect(recipients).toEqual([{ userId: 'user-b', type: 'DM' }]);
  });

  it('creates mention notifications and excludes sender', () => {
    const recipients = computeNotificationRecipients({
      conversation: {
        id: 'conv-2',
        type: 'GROUP_CLOSED',
      },
      message: { id: 'm2', body_text: 'hi' },
      senderId: 'user-a',
      mentionedUserIds: ['user-a', 'user-b', 'user-c'],
    });

    expect(recipients).toEqual([
      { userId: 'user-b', type: 'MENTION' },
      { userId: 'user-c', type: 'MENTION' },
    ]);
  });

  it('adds thread reply notification for root sender when different', () => {
    const recipients = computeNotificationRecipients({
      conversation: {
        id: 'conv-3',
        type: 'GROUP_CLOSED',
      },
      message: { id: 'm3', body_text: 'reply' },
      senderId: 'user-a',
      mentionedUserIds: ['user-b'],
      threadRootSenderId: 'user-c',
    });

    expect(recipients).toEqual([
      { userId: 'user-b', type: 'MENTION' },
      { userId: 'user-c', type: 'THREAD_REPLY' },
    ]);
  });

  it('labels a DM thread reply as a thread reply for its root author', () => {
    expect(computeNotificationRecipients({
      conversation: { id: 'dm', type: 'DM', participantA: 'author', participantB: 'replier' },
      message: { id: 'reply', threadRootId: 'root' },
      senderId: 'replier',
      threadRootSenderId: 'author',
    })).toEqual([{ userId: 'author', type: 'THREAD_REPLY' }]);
  });
});

describe('notifyMessageEvent', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('does not throw when notification persistence fails', async () => {
    createMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      notifyMessageEvent({
        conversation: {
          id: 'conv-dm',
          type: 'DM',
          participantA: 'user-a',
          participantB: 'user-b',
        },
        message: { id: 'msg-1', body_text: 'hello' },
        senderId: 'user-a',
      })
    ).resolves.toBeUndefined();
  });

  it('does not notify mentioned or thread users who cannot read the conversation', async () => {
    createMock.mockResolvedValue({ id: 'notification-1' });
    const canNotifyUser = vi.fn(async (userId: string) => userId === 'member');
    await notifyMessageEvent({
      conversation: { id: 'private-group', type: 'GROUP_CLOSED' },
      message: { id: 'message-1', body_text: 'private message snippet' },
      senderId: 'sender',
      mentionedUserIds: ['member', 'outsider'],
      threadRootSenderId: 'banned-root-author',
      canNotifyUser,
    });
    expect(canNotifyUser).toHaveBeenCalledTimes(3);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].user_id).toBe('member');
  });

  it('includes the thread root in a reply notification for a direct thread link', async () => {
    createMock.mockResolvedValue({ id: 'notification-1' });
    await notifyMessageEvent({
      conversation: { id: 'dm', type: 'DM', participantA: 'author', participantB: 'replier' },
      message: { id: 'reply', body_text: 'answer', threadRootId: 'root' },
      senderId: 'replier',
      threadRootSenderId: 'author',
    });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'author',
      type: 'THREAD_REPLY',
      data: expect.objectContaining({ threadRootId: 'root', messageId: 'reply' }),
    }));
  });

  it('renders mention tokens as readable notification text without exposing raw IDs', async () => {
    createMock.mockResolvedValue({ id: 'notification-1' });
    const recipientId = 'fe171dd2-226a-4228-91d8-597e9d4658d4';
    await notifyMessageEvent({
      conversation: { id: 'group', type: 'GROUP_CLOSED' },
      message: { id: 'message', body_text: `Hi @${recipientId}` },
      senderId: 'sender',
      mentionedUserIds: [recipientId],
    });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ snippet: 'Hi @you' }),
    }));
  });
});
