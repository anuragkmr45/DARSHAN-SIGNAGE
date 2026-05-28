import { io, type Socket } from "socket.io-client";

let screensSocketInstance: Socket | null = null;

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
    transports: ["websocket"],
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
  screensSocketInstance.disconnect();
};
