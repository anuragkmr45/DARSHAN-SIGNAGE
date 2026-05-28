import { useMemo, useState } from "react";
import { ExternalLink, Link2, MessageSquare, Paperclip, Trash2 } from "lucide-react";
import type { ChatBookmark, MediaAsset } from "@/api/types";
import type { ChatPendingAttachment } from "@/components/chat/types";
import { AttachmentPicker } from "@/components/chat/AttachmentPicker";
import { resolveMediaDisplayName } from "@/lib/media";
import { MediaPreview } from "@/components/common/MediaPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface BookmarksPanelProps {
  bookmarks: ChatBookmark[];
  isLoading?: boolean;
  canMutate?: boolean;
  mediaById?: Record<string, MediaAsset>;
  onCreateBookmark: (payload: {
    type: "LINK" | "FILE" | "MESSAGE";
    label: string;
    emoji?: string;
    url?: string;
    mediaAssetId?: string;
    messageId?: string;
  }) => Promise<void> | void;
  onDeleteBookmark: (bookmarkId: string) => Promise<void> | void;
  onJumpToMessage?: (messageId: string) => void;
}

export function BookmarksPanel({
  bookmarks,
  isLoading = false,
  canMutate = false,
  mediaById = {},
  onCreateBookmark,
  onDeleteBookmark,
  onJumpToMessage,
}: BookmarksPanelProps) {
  const [mode, setMode] = useState<"LINK" | "FILE">("LINK");
  const [pickerTab, setPickerTab] = useState<"existing" | "upload">("existing");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [emoji, setEmoji] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [pickedFile, setPickedFile] = useState<ChatPendingAttachment | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const canCreateLink = label.trim().length > 0 && url.trim().length > 0;
  const canCreateFile = fileLabel.trim().length > 0 && Boolean(pickedFile?.mediaId);
  const normalizedUrl = url.trim().toLowerCase();
  const selectedMediaId = pickedFile?.mediaId;
  const linkBookmarkUrls = useMemo(
    () =>
      new Set(
        bookmarks
          .filter((bookmark) => bookmark.type === "LINK" && Boolean(bookmark.url))
          .map((bookmark) => bookmark.url!.trim().toLowerCase()),
      ),
    [bookmarks],
  );
  const fileBookmarkAssetIds = useMemo(
    () =>
      new Set(
        bookmarks
          .filter((bookmark) => bookmark.type === "FILE" && Boolean(bookmark.media_asset_id))
          .map((bookmark) => bookmark.media_asset_id as string),
      ),
    [bookmarks],
  );
  const isDuplicateLink = Boolean(normalizedUrl) && linkBookmarkUrls.has(normalizedUrl);
  const isDuplicateFile = selectedMediaId ? fileBookmarkAssetIds.has(selectedMediaId) : false;

  const sortedBookmarks = useMemo(
    () => [...bookmarks].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [bookmarks],
  );

  return (
    <div className="space-y-3">
      {canMutate && (
        <div className="rounded-md border p-3">
          <Tabs value={mode} onValueChange={(value) => setMode(value as "LINK" | "FILE")}>
            <TabsList>
              <TabsTrigger value="LINK">Link</TabsTrigger>
              <TabsTrigger value="FILE">File</TabsTrigger>
            </TabsList>
            <TabsContent value="LINK" className="space-y-2">
              <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label" />
              <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." />
              <Input value={emoji} onChange={(event) => setEmoji(event.target.value)} placeholder="Emoji (optional)" />
              <Button
                size="sm"
                disabled={!canCreateLink || isDuplicateLink}
                onClick={async () => {
                  await onCreateBookmark({
                    type: "LINK",
                    label: label.trim(),
                    url: url.trim(),
                    emoji: emoji.trim() || undefined,
                  });
                  setLabel("");
                  setUrl("");
                  setEmoji("");
                }}
              >
                {isDuplicateLink ? "Already bookmarked" : "Add link bookmark"}
              </Button>
            </TabsContent>
            <TabsContent value="FILE" className="space-y-2">
              <Input value={fileLabel} onChange={(event) => setFileLabel(event.target.value)} placeholder="Label" />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPickerTab("existing");
                    setPickerOpen(true);
                  }}
                >
                  <Paperclip className="mr-1 h-3.5 w-3.5" />
                  Choose media
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPickerTab("upload");
                    setPickerOpen(true);
                  }}
                >
                  Upload from device
                </Button>
              </div>
              {pickedFile?.fileName && (
                <p className="text-xs text-muted-foreground">Selected: {pickedFile.fileName}</p>
              )}
              <Button
                size="sm"
                disabled={!canCreateFile || isDuplicateFile}
                onClick={async () => {
                  if (!pickedFile) return;
                  await onCreateBookmark({
                    type: "FILE",
                    label: fileLabel.trim(),
                    mediaAssetId: pickedFile.mediaId,
                  });
                  setFileLabel("");
                  setPickedFile(null);
                }}
              >
                {isDuplicateFile ? "Already bookmarked" : "Add file bookmark"}
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading bookmarks...</p>
      ) : sortedBookmarks.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No bookmarks yet.</p>
      ) : (
        <div className="space-y-2">
          {sortedBookmarks.map((bookmark) => {
            const media = bookmark.media_asset_id ? mediaById[bookmark.media_asset_id] : undefined;
            return (
              <div key={bookmark.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">
                    {bookmark.emoji ? `${bookmark.emoji} ` : ""}
                    {bookmark.label}
                  </p>
                  {canMutate && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void onDeleteBookmark(bookmark.id)}
                      aria-label="Delete bookmark"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {bookmark.type === "LINK" && bookmark.url && (
                  <a
                    href={bookmark.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {bookmark.url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {bookmark.type === "MESSAGE" && bookmark.message_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => onJumpToMessage?.(bookmark.message_id!)}
                  >
                    <MessageSquare className="mr-1 h-3.5 w-3.5" />
                    Open message
                  </Button>
                )}
                {bookmark.type === "FILE" && (
                  <div className="mt-2 flex items-center gap-2">
                    <MediaPreview
                      media={media}
                      url={media?.media_url}
                      type={media?.content_type}
                      alt={resolveMediaDisplayName(media) || bookmark.label}
                      className="h-16 w-16"
                    />
                    <p className="truncate text-xs text-muted-foreground">
                      {resolveMediaDisplayName(media) || bookmark.media_asset_id || "File bookmark"}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AttachmentPicker
        open={pickerOpen}
        initialTab={pickerTab}
        onOpenChange={setPickerOpen}
        onAddAttachments={(attachments) => {
          if (!attachments.length) return;
          setPickedFile(attachments[0]);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
