import { io, type Socket } from "socket.io-client";

let socketInstance: Socket | null = null;

const resolveSocketUrl = () => {
  const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL;
  const wsUrl = import.meta.env.VITE_WS_URL;
  const apiUrl = import.meta.env.VITE_API_BASE_URL;
  if (wsBaseUrl) return wsBaseUrl;
  if (wsUrl) return wsUrl;
  if (apiUrl) return apiUrl;
  if (typeof window !== "undefined") return window.location.origin;
  return undefined;
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
    transports: ["websocket", "polling"],
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
  socketInstance.disconnect();
};
