import { io, type Socket } from "socket.io-client";

let notificationsSocketInstance: Socket | null = null;

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

const resolveNotificationsNamespaceUrl = (baseUrl: string) => {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}/notifications`;
};

export const getNotificationsSocket = (authToken?: string) => {
  if (notificationsSocketInstance) {
    if (authToken) {
      notificationsSocketInstance.auth = { token: authToken };
    }
    return notificationsSocketInstance;
  }

  const url = resolveSocketUrl();
  if (!url) return undefined;

  notificationsSocketInstance = io(resolveNotificationsNamespaceUrl(url), {
    autoConnect: false,
    withCredentials: true,
    transports: ["websocket"],
    auth: authToken ? { token: authToken } : undefined,
  });

  return notificationsSocketInstance;
};

export const connectNotificationsSocket = (authToken?: string) => {
  const socket = getNotificationsSocket(authToken);
  if (!socket) return undefined;
  if (!socket.connected) socket.connect();
  return socket;
};

export const disconnectNotificationsSocket = () => {
  if (!notificationsSocketInstance) return;
  notificationsSocketInstance.disconnect();
};

