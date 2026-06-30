import { ApiError } from "@/api/apiClient";

interface ValidationDetail {
  field?: string;
  message?: string;
}

export interface UsersUxError {
  code?: string;
  title: string;
  message: string;
}

const formatValidationDetails = (details: unknown) => {
  if (!Array.isArray(details)) return "";
  const messages = (details as ValidationDetail[])
    .map((item) => {
      if (!item) return "";
      if (item.field && item.message) return `${item.field}: ${item.message}`;
      return item.message || "";
    })
    .filter(Boolean);
  return messages.length > 0 ? messages.join(" • ") : "";
};

export const mapUsersErrorToUx = (
  error: unknown,
  fallbackTitle = "Request failed",
): UsersUxError => {
  if (!(error instanceof ApiError)) {
    return {
      title: fallbackTitle,
      message: error instanceof Error ? error.message : "Request failed. Please try again.",
    };
  }

  const code = error.code;
  const backendMessage = error.message || "Request failed. Please try again.";
  const validationDetails = formatValidationDetails(error.details);

  switch (code) {
    case "UNAUTHORIZED":
      if (backendMessage.toLowerCase().includes("stale")) {
        return {
          code,
          title: "Session expired",
          message: "Authorization context is stale. Please sign in again.",
        };
      }
      return {
        code,
        title: "Authentication required",
        message: backendMessage,
      };
    case "FORBIDDEN":
      return {
        code,
        title: "Access denied",
        message:
          backendMessage === "Forbidden"
            ? "You do not have permission to perform this action."
            : backendMessage,
      };
    case "NOT_FOUND":
      return {
        code,
        title: "Not found",
        message: backendMessage,
      };
    case "VALIDATION_ERROR":
      return {
        code,
        title: "Invalid input",
        message: validationDetails || backendMessage || "Some fields are invalid.",
      };
    case "CONFLICT":
      return {
        code,
        title: "Conflict",
        message: backendMessage,
      };
    case "BAD_REQUEST":
      return {
        code,
        title: "Bad request",
        message: backendMessage,
      };
    case "INTERNAL_ERROR":
      return {
        code,
        title: "Server error",
        message: "Unexpected error. Please try again.",
      };
    default:
      return {
        code,
        title: fallbackTitle,
        message: backendMessage,
      };
  }
};
