export type UploadStatus = "queued" | "uploading" | "processing" | "uploaded" | "failed";

export interface ChatPendingAttachment {
  mediaId: string;
  fileName: string;
  contentType?: string;
  size?: number;
  previewUrl?: string | null;
}

export interface ComposerUploadItem {
  localId: string;
  fileName: string;
  size: number;
  contentType: string;
  progress: number;
  status: UploadStatus;
  mediaId?: string;
  previewUrl?: string;
  error?: string;
  didCompress?: boolean;
  originalSize?: number;
  finalSize?: number;
}

export interface ChatPendingUiMessage {
  localId: string;
  conversationId: string;
  text: string;
  attachmentMediaIds: string[];
  replyTo?: string;
  alsoToChannel?: boolean;
  createdAt: string;
  status: "sending" | "failed";
  errorCode?: string;
  errorMessage?: string;
}
