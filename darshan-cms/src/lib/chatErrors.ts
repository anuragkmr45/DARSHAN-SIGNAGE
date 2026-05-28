import { ApiError } from "@/api/apiClient";

export type ChatBlockMode = "READ_ONLY" | "MUTED" | "BANNED" | null;
export type ChatErrorSeverity = "info" | "warning" | "error";

export interface ChatUxError {
  code?: string;
  message: string;
  details?: unknown;
  severity: ChatErrorSeverity;
  blockMode: ChatBlockMode;
  retryable: boolean;
  toastTitle: string;
}

const fallbackError: ChatUxError = {
  message: "Chat action failed. Please try again.",
  severity: "error",
  blockMode: null,
  retryable: true,
  toastTitle: "Chat action failed",
};

export const mapChatErrorToUx = (error: unknown): ChatUxError => {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error) {
      return {
        ...fallbackError,
        message: error.message || fallbackError.message,
      };
    }
    return fallbackError;
  }

  const code = error.code;
  const base = {
    code,
    message: error.message,
    details: error.details,
    severity: "error" as ChatErrorSeverity,
    blockMode: null as ChatBlockMode,
    retryable: true,
    toastTitle: code || "Chat action failed",
  };

  switch (code) {
    case "CHAT_ARCHIVED":
      return { ...base, blockMode: "READ_ONLY", retryable: false, severity: "warning", toastTitle: "Read-only chat" };
    case "CHAT_MUTED":
      return { ...base, blockMode: "MUTED", retryable: false, severity: "warning", toastTitle: "You are muted" };
    case "CHAT_BANNED":
    case "FORBIDDEN":
      return { ...base, blockMode: "BANNED", retryable: false, severity: "error", toastTitle: "Access removed" };
    case "UNAUTHORIZED":
      return { ...base, retryable: false, severity: "error", toastTitle: "Session expired" };
    case "MEDIA_NOT_READY":
      return { ...base, retryable: true, severity: "warning", toastTitle: "Attachment not ready" };
    case "RATE_LIMITED":
      return { ...base, retryable: true, severity: "warning", toastTitle: "Rate limited" };
    case "CHAT_TOO_MANY_ATTACHMENTS":
      return { ...base, retryable: false, severity: "warning", toastTitle: "Too many attachments" };
    case "CHAT_MENTION_POLICY_VIOLATION":
      return { ...base, retryable: false, severity: "warning", toastTitle: "Mention blocked" };
    case "CHAT_EDIT_POLICY_DISABLED":
    case "CHAT_EDIT_POLICY_FORBIDDEN":
      return { ...base, retryable: false, severity: "warning", toastTitle: "Edit blocked" };
    case "CHAT_DELETE_POLICY_DISABLED":
    case "CHAT_DELETE_POLICY_FORBIDDEN":
      return { ...base, retryable: false, severity: "warning", toastTitle: "Delete blocked" };
    default:
      return base;
  }
};
