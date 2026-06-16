import { io, type Socket } from "socket.io-client";
import { getCmsSocketBaseUrl, getCmsSocketTransports } from "@/config/runtimeConfig";

let notificationsSocketInstance: Socket | null = null;

const resolveSocketUrl = () => {
  return getCmsSocketBaseUrl();
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
    transports: getCmsSocketTransports(),
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
  const socket = notificationsSocketInstance;
  notificationsSocketInstance = null;
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
