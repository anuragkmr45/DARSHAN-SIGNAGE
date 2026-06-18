import { ApiError } from "@/api/apiClient";

export type MediaDeleteToastConfig = {
  title: string;
  description: string;
  variant: "default" | "destructive";
  dismissDeleteDialog: boolean;
  helpRoute?: string;
  helpLabel?: string;
};

const mediaInUseRoutes: Record<string, { helpRoute: string; helpLabel: string }> = {
  chat_attachments: { helpRoute: "/chat", helpLabel: "Open chat" },
  screens: { helpRoute: "/screens", helpLabel: "Open screens" },
  settings: { helpRoute: "/settings", helpLabel: "Open settings" },
  proof_of_play: { helpRoute: "/proof-of-play", helpLabel: "Open proof of play" },
};

const fallbackConfig = (description: string): MediaDeleteToastConfig => ({
  title: "Delete failed",
  description,
  variant: "destructive",
  dismissDeleteDialog: false,
});

export const mapMediaDeleteError = (error: unknown): MediaDeleteToastConfig => {
  if (!(error instanceof ApiError)) {
    return fallbackConfig(error instanceof Error ? error.message : "Unable to delete media.");
  }

  const message = error.message || "Unable to delete media.";

  if (error.code === "MEDIA_DELETE_FORBIDDEN_OWNER") {
    const ownerDisplayName =
      error.details && typeof error.details === "object" && "owner_display_name" in error.details
        ? String((error.details as { owner_display_name?: unknown }).owner_display_name || "")
        : "";
    const description =
      ownerDisplayName && !message.includes(ownerDisplayName) ? `${message} Uploaded by ${ownerDisplayName}.` : message;

    return {
      title: "Delete not allowed",
      description,
      variant: "destructive",
      dismissDeleteDialog: true,
    };
  }

  if (error.code === "MEDIA_IN_USE") {
    const firstReference =
      error.details &&
      typeof error.details === "object" &&
      "references" in error.details &&
      Array.isArray((error.details as { references?: unknown }).references)
        ? String(((error.details as { references?: unknown[] }).references || [])[0] || "")
        : "";

    return {
      title: "Media in use",
      description: message,
      variant: "destructive",
      dismissDeleteDialog: true,
      helpRoute: mediaInUseRoutes[firstReference]?.helpRoute,
      helpLabel: mediaInUseRoutes[firstReference]?.helpLabel,
    };
  }

  if (error.code === "FORBIDDEN") {
    return {
      title: "Delete not allowed",
      description: message,
      variant: "destructive",
      dismissDeleteDialog: true,
    };
  }

  if (error.code === "NOT_FOUND") {
    return {
      title: "Media not found",
      description: message,
      variant: "destructive",
      dismissDeleteDialog: true,
    };
  }

  if (error.code === "UNAUTHORIZED") {
    return {
      title: "Session expired",
      description: message,
      variant: "destructive",
      dismissDeleteDialog: true,
    };
  }

  return fallbackConfig(message);
};
