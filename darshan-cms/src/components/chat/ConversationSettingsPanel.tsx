import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type {
  ChatBookmark,
  ChatConversationListItem,
  ChatConversationMember,
  ChatConversationSettings,
  ChatEditDeletePolicy,
  ChatInvitePolicy,
  ChatMentionPolicy,
  ChatPin,
  ChatMentionRule,
  MediaAsset,
} from "@/api/types";
import { BookmarksPanel } from "@/components/chat/BookmarksPanel";
import { PinsPanel } from "@/components/chat/PinsPanel";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_SETTINGS: ChatConversationSettings = {
  mention_policy: {
    everyone: "ADMINS_ONLY",
    channel: "ADMINS_ONLY",
    here: "ANY_MEMBER",
  },
  edit_policy: "OWN",
  delete_policy: "OWN",
};

const resolveConversationSettings = (conversation?: ChatConversationListItem): ChatConversationSettings =>
  conversation?.settings || conversation?.metadata?.settings || DEFAULT_SETTINGS;

interface ConversationSettingsPanelProps {
  conversation?: ChatConversationListItem;
  open: boolean;
  canManage: boolean;
  canManageLifecycle: boolean;
  canMutateItems?: boolean;
  isSuperAdmin?: boolean;
  pins?: ChatPin[];
  pinsLoading?: boolean;
  bookmarks?: ChatBookmark[];
  bookmarksLoading?: boolean;
  bookmarkMediaById?: Record<string, MediaAsset>;
  members?: ChatConversationMember[];
  membersLoading?: boolean;
  membersError?: string | null;
  memberRemovalPending?: boolean;
  currentUserId?: string;
  onRefreshMembers?: () => void;
  onRemoveMember?: (userId: string) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: {
    title?: string | null;
    topic?: string | null;
    purpose?: string | null;
    invite_policy?: ChatInvitePolicy;
    settings?: ChatConversationSettings;
  }) => Promise<void> | void;
  onArchive: () => Promise<void> | void;
  onUnarchive: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onJumpToMessage?: (messageId: string) => void;
  onUnpinMessage?: (messageId: string) => Promise<void> | void;
  onCreateBookmark?: (payload: {
    type: "LINK" | "FILE" | "MESSAGE";
    label: string;
    emoji?: string;
    url?: string;
    mediaAssetId?: string;
    messageId?: string;
  }) => Promise<void> | void;
  onDeleteBookmark?: (bookmarkId: string) => Promise<void> | void;
}

export function ConversationSettingsPanel({
  conversation,
  open,
  canManage,
  canManageLifecycle,
  canMutateItems = false,
  isSuperAdmin = false,
  pins = [],
  pinsLoading = false,
  bookmarks = [],
  bookmarksLoading = false,
  bookmarkMediaById = {},
  members = [],
  membersLoading = false,
  membersError = null,
  memberRemovalPending = false,
  currentUserId,
  onRefreshMembers,
  onRemoveMember,
  onOpenChange,
  onSave,
  onArchive,
  onUnarchive,
  onDelete,
  onJumpToMessage,
  onUnpinMessage,
  onCreateBookmark,
  onDeleteBookmark,
}: ConversationSettingsPanelProps) {
  const [tab, setTab] = useState("settings");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [purpose, setPurpose] = useState("");
  const [invitePolicy, setInvitePolicy] = useState<ChatInvitePolicy>("ANY_MEMBER_CAN_INVITE");
  const [mentionPolicy, setMentionPolicy] = useState<ChatMentionPolicy>(DEFAULT_SETTINGS.mention_policy);
  const [editPolicy, setEditPolicy] = useState<ChatEditDeletePolicy>("OWN");
  const [deletePolicy, setDeletePolicy] = useState<ChatEditDeletePolicy>("OWN");
  const [removeTarget, setRemoveTarget] = useState<ChatConversationMember | null>(null);

  useEffect(() => { setRemoveTarget(null); }, [conversation?.id]);
  useEffect(() => { if (!open) setRemoveTarget(null); }, [open]);

  useEffect(() => {
    if (!conversation) return;
    const settings = resolveConversationSettings(conversation);
    setTitle(conversation.title || "");
    setTopic(conversation.topic || "");
    setPurpose(conversation.purpose || "");
    setInvitePolicy(conversation.invite_policy || "ANY_MEMBER_CAN_INVITE");
    setMentionPolicy(settings.mention_policy);
    setEditPolicy(settings.edit_policy);
    setDeletePolicy(settings.delete_policy);
  }, [conversation]);

  const isArchived = conversation?.state === "ARCHIVED";

  const mentionPolicyField = (
    audience: keyof ChatMentionPolicy,
    label: string,
    value: ChatMentionRule,
    onChange: (value: ChatMentionRule) => void,
  ) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as ChatMentionRule)} disabled={!canManage}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ANY_MEMBER">Any member</SelectItem>
          <SelectItem value="ADMINS_ONLY">Admins only</SelectItem>
          <SelectItem value="DISABLED">Disabled</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">Controls @{audience} mentions.</p>
    </div>
  );

  const memberName = (member: ChatConversationMember) =>
    `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.email || "Former user";

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[460px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Conversation Details</SheetTitle>
          <SheetDescription>Settings, members, pins, and bookmarks.</SheetDescription>
        </SheetHeader>

        {!conversation ? (
          <p className="mt-4 text-sm text-muted-foreground">No conversation selected.</p>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="mt-4">
            <TabsList className="w-full">
              <TabsTrigger value="settings" className="flex-1">Settings</TabsTrigger>
              {conversation.type !== "DM" && canManage && <TabsTrigger value="members" className="flex-1">Members</TabsTrigger>}
              <TabsTrigger value="pins" className="flex-1">Pins</TabsTrigger>
              <TabsTrigger value="bookmarks" className="flex-1">Bookmarks</TabsTrigger>
            </TabsList>

            <TabsContent value="settings" className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="chat-title">Title</Label>
                <Input
                  id="chat-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={!canManage}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chat-topic">Topic</Label>
                <Input
                  id="chat-topic"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  disabled={!canManage}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chat-purpose">Purpose</Label>
                <Input
                  id="chat-purpose"
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  disabled={!canManage}
                />
              </div>

              {conversation.type !== "DM" && (
                <>
                  <div className="space-y-2">
                    <Label>Invite Policy</Label>
                    <Select
                      value={invitePolicy}
                      onValueChange={(value) => setInvitePolicy(value as ChatInvitePolicy)}
                      disabled={!canManage}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ANY_MEMBER_CAN_INVITE">Any member can invite</SelectItem>
                        <SelectItem value="ADMINS_ONLY_CAN_INVITE">Admins only can invite</SelectItem>
                        <SelectItem value="INVITES_DISABLED">Invites disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 rounded-md border p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Mention Policy</p>
                    {mentionPolicyField("everyone", "@everyone", mentionPolicy.everyone, (value) =>
                      setMentionPolicy((prev) => ({ ...prev, everyone: value })))}
                    {mentionPolicyField("channel", "@channel", mentionPolicy.channel, (value) =>
                      setMentionPolicy((prev) => ({ ...prev, channel: value })))}
                    {mentionPolicyField("here", "@here", mentionPolicy.here, (value) =>
                      setMentionPolicy((prev) => ({ ...prev, here: value })))}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Edit Policy</Label>
                      <Select value={editPolicy} onValueChange={(value) => setEditPolicy(value as ChatEditDeletePolicy)} disabled={!canManage}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OWN">Own messages</SelectItem>
                          <SelectItem value="ADMINS_ONLY">Admins only</SelectItem>
                          <SelectItem value="DISABLED">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Delete Policy</Label>
                      <Select value={deletePolicy} onValueChange={(value) => setDeletePolicy(value as ChatEditDeletePolicy)} disabled={!canManage}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OWN">Own messages</SelectItem>
                          <SelectItem value="ADMINS_ONLY">Admins only</SelectItem>
                          <SelectItem value="DISABLED">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}

              <Button
                className="w-full"
                onClick={() =>
                  onSave({
                    title: title || null,
                    topic: topic || null,
                    purpose: purpose || null,
                    invite_policy: invitePolicy,
                    settings: {
                      mention_policy: mentionPolicy,
                      edit_policy: editPolicy,
                      delete_policy: deletePolicy,
                    },
                  })
                }
                disabled={!canManage}
              >
                Save settings
              </Button>

              {canManageLifecycle && <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Lifecycle</p>
                {isArchived ? (
                  <Button className="w-full" variant="outline" onClick={() => onUnarchive()}>
                    Unarchive conversation
                  </Button>
                ) : (
                  <Button className="w-full" variant="outline" onClick={() => onArchive()}>
                    Archive conversation
                  </Button>
                )}
              </div>}

              {isSuperAdmin && (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="flex items-center gap-1 text-xs font-semibold uppercase text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Danger Zone
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hard delete purges message history and removes conversation from all users.
                  </p>
                  <Button className="w-full" variant="destructive" onClick={() => onDelete()}>
                    Delete conversation permanently
                  </Button>
                </div>
              )}
            </TabsContent>

            {conversation.type !== "DM" && canManage && <TabsContent value="members" className="space-y-3">
              {conversation.type === "FORUM_OPEN" && <p className="text-sm text-muted-foreground">This forum is open to authorized site users. Removing a membership would not revoke access; ask a site administrator to moderate a participant.</p>}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">{conversation.type === "FORUM_OPEN" ? "Recorded forum members." : "People with access to this conversation."}</p>
                <Button variant="ghost" size="sm" onClick={onRefreshMembers} disabled={membersLoading}>Refresh</Button>
              </div>
              {membersLoading && <p role="status" className="text-sm text-muted-foreground">Loading members…</p>}
              {membersError && <p role="alert" className="text-sm text-destructive">{membersError}</p>}
              {!membersLoading && !membersError && members.length === 0 && <p className="text-sm text-muted-foreground">{conversation.type === "FORUM_OPEN" ? "No recorded members." : "No members found."}</p>}
              <div className="divide-y rounded-lg border">
                {members.map((member) => <div key={member.user_id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{memberName(member)}{member.user_id === currentUserId ? " (you)" : ""}</p>
                    {member.email && memberName(member) !== member.email && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
                    <p className="text-xs text-muted-foreground">{member.is_system ? "Site administrator" : member.role === "OWNER" ? "Owner" : member.role === "CHAT_ADMIN" ? "Chat admin" : member.role === "MOD" ? "Moderator" : "Member"}</p>
                  </div>
                  {conversation.type === "GROUP_CLOSED" && !member.is_system && member.role !== "OWNER" && member.user_id !== currentUserId && <Button variant="outline" size="sm" onClick={() => setRemoveTarget(member)} aria-label={`Remove ${memberName(member)}`} disabled={memberRemovalPending || isArchived}>Remove</Button>}
                </div>)}
              </div>
              {isArchived && <p className="text-xs text-muted-foreground">Unarchive this conversation before changing its members.</p>}
            </TabsContent>}

            <TabsContent value="pins">
              <PinsPanel
                pins={pins}
                isLoading={pinsLoading}
                canMutate={canMutateItems}
                onJumpToMessage={onJumpToMessage}
                onUnpinMessage={onUnpinMessage}
              />
            </TabsContent>

            <TabsContent value="bookmarks">
              <BookmarksPanel
                bookmarks={bookmarks}
                isLoading={bookmarksLoading}
                canMutate={canMutateItems}
                mediaById={bookmarkMediaById}
                onCreateBookmark={async (payload) => {
                  await onCreateBookmark?.(payload);
                }}
                onDeleteBookmark={async (bookmarkId) => {
                  await onDeleteBookmark?.(bookmarkId);
                }}
                onJumpToMessage={onJumpToMessage}
              />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
    <ConfirmDialog
      open={Boolean(removeTarget)}
      title="Remove member?"
      description={`${removeTarget ? memberName(removeTarget) : "This member"} will lose access to this conversation and its shared files. Past messages stay in the conversation.`}
      confirmLabel="Remove member"
      isLoading={memberRemovalPending}
      onCancel={() => setRemoveTarget(null)}
      onConfirm={() => {
        if (!removeTarget || !onRemoveMember) return;
        void Promise.resolve(onRemoveMember(removeTarget.user_id)).then(() => setRemoveTarget(null)).catch(() => {});
      }}
    />
    </>
  );
}
