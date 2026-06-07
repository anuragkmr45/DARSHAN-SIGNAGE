import { beforeEach, describe, expect, test, vi } from "vitest";

type FakeSocket = {
  auth?: unknown;
  connected: boolean;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
};

const socketState = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  const io = vi.fn((_url: string, options: { auth?: unknown }) => {
    const socket: FakeSocket = {
      auth: options.auth,
      connected: false,
      connect: vi.fn(function connect(this: FakeSocket) {
        this.connected = true;
        return this;
      }),
      disconnect: vi.fn(function disconnect(this: FakeSocket) {
        this.connected = false;
        return this;
      }),
      removeAllListeners: vi.fn(function removeAllListeners(this: FakeSocket) {
        return this;
      }),
    };
    sockets.push(socket);
    return socket;
  });
  return { io, sockets };
});

vi.mock("socket.io-client", () => ({
  io: socketState.io,
}));

const loadRealtimeSocketModules = async () => {
  const screens = await import("@/lib/screensSocket");
  const chat = await import("@/lib/chatSocket");
  const notifications = await import("@/lib/notificationsSocket");
  const realtime = await import("@/lib/realtimeSockets");
  return { screens, chat, notifications, realtime };
};

describe("CMS realtime socket lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    socketState.io.mockClear();
    socketState.sockets.length = 0;
    vi.stubGlobal("window", { location: { origin: "https://cms.test" } });
  });

  test("disconnectAllRealtimeSockets disconnects screens, chat, and notifications sockets", async () => {
    const { screens, chat, notifications, realtime } = await loadRealtimeSocketModules();

    screens.connectScreensSocket("token-a");
    chat.connectChatSocket("token-a");
    notifications.connectNotificationsSocket("token-a");

    realtime.disconnectAllRealtimeSockets();

    expect(socketState.sockets).toHaveLength(3);
    socketState.sockets.forEach((socket) => {
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(socket.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(socket.auth).toEqual({});
      expect(socket.connected).toBe(false);
    });
  });

  test("disconnectAllRealtimeSockets is safe when called twice", async () => {
    const { screens, chat, notifications, realtime } = await loadRealtimeSocketModules();

    screens.connectScreensSocket("token-a");
    chat.connectChatSocket("token-a");
    notifications.connectNotificationsSocket("token-a");

    realtime.disconnectAllRealtimeSockets();
    realtime.disconnectAllRealtimeSockets();

    socketState.sockets.forEach((socket) => {
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(socket.removeAllListeners).toHaveBeenCalledTimes(1);
    });
  });

  test("socket cleanup errors do not block logout cleanup", async () => {
    const { screens, chat, notifications, realtime } = await loadRealtimeSocketModules();

    screens.connectScreensSocket("token-a");
    chat.connectChatSocket("token-a");
    notifications.connectNotificationsSocket("token-a");
    socketState.sockets[0].disconnect.mockImplementationOnce(function disconnect(this: FakeSocket) {
      this.connected = false;
      throw new Error("stale socket");
    });

    expect(() => realtime.disconnectAllRealtimeSockets()).not.toThrow();

    socketState.sockets.forEach((socket) => {
      expect(socket.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(socket.auth).toEqual({});
      expect(socket.connected).toBe(false);
    });
  });

  test("fresh login creates new sockets instead of reconnecting stale auth", async () => {
    const { screens, chat, notifications, realtime } = await loadRealtimeSocketModules();

    screens.connectScreensSocket("token-a");
    chat.connectChatSocket("token-a");
    notifications.connectNotificationsSocket("token-a");
    const staleSockets = [...socketState.sockets];

    realtime.disconnectAllRealtimeSockets();

    screens.connectScreensSocket("token-b");
    chat.connectChatSocket("token-b");
    notifications.connectNotificationsSocket("token-b");

    expect(socketState.sockets).toHaveLength(6);
    staleSockets.forEach((socket) => {
      expect(socket.auth).toEqual({});
      expect(socket.connect).toHaveBeenCalledTimes(1);
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });
    socketState.sockets.slice(3).forEach((socket) => {
      expect(socket.auth).toEqual({ token: "token-b" });
      expect(socket.connected).toBe(true);
    });
  });
});
