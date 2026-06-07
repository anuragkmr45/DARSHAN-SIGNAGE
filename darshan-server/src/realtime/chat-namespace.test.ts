import { AddressInfo } from 'net';
import { FastifyInstance } from 'fastify';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';
import { canSocketSubscribe, resolveSocketAuthToken } from '@/realtime/chat-namespace';
import { closeTestServer, createTestServer, generateTestToken, testUser } from '@/test/helpers';
import { createChatRepository } from '@/db/repositories/chat';

function waitForSocketConnect(socket: ClientSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitWithAck<T = any>(socket: ClientSocket, event: string, payload: unknown) {
  return new Promise<T>((resolve) => {
    socket.emit(event, payload, (result: T) => resolve(result));
  });
}

describe('chat namespace auth resolution', () => {
  const allowlist = ['http://localhost:8080'];

  it('rejects cookie auth when origin is not allowlisted', () => {
    const result = resolveSocketAuthToken({
      cookieHeader: 'access_token=cookie-token',
      origin: 'http://malicious.local',
      allowlist,
    });
    expect(result.token).toBeUndefined();
    expect(result.error).toContain('Origin not allowed');
  });

  it('rejects cookie auth when origin is missing', () => {
    const result = resolveSocketAuthToken({
      cookieHeader: 'access_token=cookie-token',
      allowlist,
    });
    expect(result.token).toBeUndefined();
    expect(result.error).toContain('Origin is required');
  });

  it('accepts cookie auth when origin is allowlisted', () => {
    const result = resolveSocketAuthToken({
      cookieHeader: 'access_token=cookie-token',
      origin: 'http://localhost:8080',
      allowlist,
    });
    expect(result.token).toBe('cookie-token');
    expect(result.source).toBe('cookie');
  });

  it('accepts handshake auth token without origin', () => {
    const result = resolveSocketAuthToken({
      authToken: 'token-123',
      allowlist,
    });
    expect(result.token).toBe('token-123');
    expect(result.source).toBe('handshake_auth');
  });

  it('uses authorization header bearer token when handshake token is absent', () => {
    const result = resolveSocketAuthToken({
      authorizationHeader: 'Bearer header-token',
      allowlist,
    });
    expect(result.token).toBe('header-token');
    expect(result.source).toBe('authorization_header');
  });

  it('prefers handshake auth token over authorization header and cookie', () => {
    const result = resolveSocketAuthToken({
      authToken: 'preferred-token',
      authorizationHeader: 'Bearer header-token',
      cookieHeader: 'access_token=cookie-token',
      origin: 'http://localhost:8080',
      allowlist,
    });
    expect(result.token).toBe('preferred-token');
    expect(result.source).toBe('handshake_auth');
  });

  it('rejects socket subscription when user is actively banned', () => {
    const allowed = canSocketSubscribe(true, {
      banned_until: new Date(Date.now() + 60_000),
    });
    expect(allowed).toBe(false);
  });

  it('rejects socket subscription when user cannot access the conversation', () => {
    const allowed = canSocketSubscribe(false, null);
    expect(allowed).toBe(false);
  });

  it('allows socket subscription for muted users', () => {
    const allowed = canSocketSubscribe(true, {
      muted_until: new Date(Date.now() + 60_000),
    });
    expect(allowed).toBe(true);
  });
});

describe('chat namespace socket payload hardening', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let token: string;
  let socket: ClientSocket | null = null;

  beforeAll(async () => {
    server = await createTestServer();
    token = await generateTestToken(testUser.id, 'ADMIN');
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  });

  afterAll(async () => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    await closeTestServer(server);
  });

  async function connectChatSocket() {
    socket = createClient(`${baseUrl}/chat`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      forceNew: true,
    });
    await waitForSocketConnect(socket);
    return socket;
  }

  it('rejects malformed chat socket payloads safely', async () => {
    const chatSocket = await connectChatSocket();

    const subscribeResult = await emitWithAck<any>(chatSocket, 'chat:subscribe', {
      conversationIds: ['not-a-uuid'],
    });
    expect(subscribeResult).toMatchObject({
      error: {
        code: 'INVALID_PAYLOAD',
      },
    });

    const typingResult = await emitWithAck<any>(chatSocket, 'chat:typing', {
      conversationId: 'not-a-uuid',
      isTyping: true,
    });
    expect(typingResult).toMatchObject({
      error: {
        code: 'INVALID_PAYLOAD',
      },
    });

    const readResult = await emitWithAck<any>(chatSocket, 'chat:read', {
      conversationId: 'not-a-uuid',
      lastReadSeq: -1,
    });
    expect(readResult).toMatchObject({
      error: {
        code: 'INVALID_PAYLOAD',
      },
    });
    expect(chatSocket.connected).toBe(true);
  });

  it('allows valid chat subscribe and rate-limits chat typing floods', async () => {
    const conversation = await createChatRepository().createConversation({
      type: 'GROUP_CLOSED',
      title: 'Typing Flood Test',
      createdBy: testUser.id,
    });
    const chatSocket = await connectChatSocket();

    const subscribeResult = await emitWithAck<any>(chatSocket, 'chat:subscribe', {
      conversationIds: [conversation.id],
    });
    expect(subscribeResult.subscribed).toContain(conversation.id);

    const responses: any[] = [];
    for (let i = 0; i < 8; i += 1) {
      responses.push(
        await emitWithAck<any>(chatSocket, 'chat:typing', {
          conversationId: conversation.id,
          isTyping: true,
        })
      );
    }

    expect(responses.some((response) => response?.ok === true)).toBe(true);
    expect(responses.some((response) => response?.error?.code === 'RATE_LIMITED')).toBe(true);
    expect(chatSocket.connected).toBe(true);
  });
});
