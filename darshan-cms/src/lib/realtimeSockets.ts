import { disconnectChatSocket } from "@/lib/chatSocket";
import { disconnectNotificationsSocket } from "@/lib/notificationsSocket";
import { disconnectScreensSocket } from "@/lib/screensSocket";

export const disconnectAllRealtimeSockets = () => {
  disconnectScreensSocket();
  disconnectChatSocket();
  disconnectNotificationsSocket();
};
