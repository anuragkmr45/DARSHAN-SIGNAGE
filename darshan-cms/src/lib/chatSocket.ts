import { io, type Socket } from "socket.io-client";
import { getCmsSocketBaseUrl, getCmsSocketTransports } from "@/config/runtimeConfig";

let socketInstance: Socket | null = null;

const resolveSocketUrl = () => {
  return getCmsSocketBaseUrl();
};

const resolveChatNamespaceUrl = (baseUrl: string) => {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}/chat`;
};

export const getChatSocket = (authToken?: string) => {
  if (socketInstance) {
    if (authToken) {
      socketInstance.auth = { token: authToken };
    }
    return socketInstance;
  }

  const url = resolveSocketUrl();
  if (!url) return undefined;

  socketInstance = io(resolveChatNamespaceUrl(url), {
    autoConnect: false,
    withCredentials: true,
    transports: getCmsSocketTransports(),
    auth: authToken ? { token: authToken } : undefined,
  });

  return socketInstance;
};

export const connectChatSocket = (authToken?: string) => {
  const socket = getChatSocket(authToken);
  if (!socket) return undefined;
  if (!socket.connected) socket.connect();
  return socket;
};

export const disconnectChatSocket = () => {
  if (!socketInstance) return;
  const socket = socketInstance;
  socketInstance = null;
  socket.auth = {};
  try {
    socket.disconnect();
  } catch {
    // Logout/auth-clear cleanup must not be blocked by a stale socket.
  }
  try {
    socket.removeAllListeners();
  } catch {
    // Listener cleanup is best-effort for already broken socket instances.
  }
};
