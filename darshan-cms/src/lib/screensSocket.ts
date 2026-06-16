import { io, type Socket } from "socket.io-client";
import { getCmsSocketBaseUrl, getCmsSocketTransports } from "@/config/runtimeConfig";

let screensSocketInstance: Socket | null = null;

const resolveSocketUrl = () => {
  return getCmsSocketBaseUrl();
};

const resolveScreensNamespaceUrl = (baseUrl: string) => {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}/screens`;
};

export const getScreensSocket = (authToken?: string) => {
  if (screensSocketInstance) {
    if (authToken) {
      screensSocketInstance.auth = { token: authToken };
    }
    return screensSocketInstance;
  }

  const url = resolveSocketUrl();
  if (!url) return undefined;

  screensSocketInstance = io(resolveScreensNamespaceUrl(url), {
    autoConnect: false,
    withCredentials: true,
    transports: getCmsSocketTransports(),
    auth: authToken ? { token: authToken } : undefined,
  });

  return screensSocketInstance;
};

export const connectScreensSocket = (authToken?: string) => {
  const socket = getScreensSocket(authToken);
  if (!socket) return undefined;
  if (!socket.connected) socket.connect();
  return socket;
};

export const disconnectScreensSocket = () => {
  if (!screensSocketInstance) return;
  const socket = screensSocketInstance;
  screensSocketInstance = null;
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
