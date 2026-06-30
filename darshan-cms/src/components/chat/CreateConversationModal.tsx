import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/api/domains/users";
import type { ChatConversationType, ChatInvitePolicy } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CreateConversationModalProps {
  open: boolean;
  currentUserId?: string;
  onOpenChange: (open: boolean) => void;
  onCreateDm: (otherUserId: string) => Promise<void> | void;
  onCreateConversation: (payload: {
    type: "GROUP_CLOSED" | "FORUM_OPEN";
    title?: string;
    topic?: string;
    purpose?: string;
    members?: string[];
    invite_policy?: ChatInvitePolicy;
  }) => Promise<void> | void;
}

export function CreateConversationModal({
  open,
  currentUserId,
  onOpenChange,
  onCreateDm,
  onCreateConversation,
}: CreateConversationModalProps) {
  const [type, setType] = useState<ChatConversationType>("DM");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [purpose, setPurpose] = useState("");
  const [invitePolicy, setInvitePolicy] = useState<ChatInvitePolicy>("ANY_MEMBER_CAN_INVITE");
  const [selectedMembers, setSelectedMembers] = useState<Record<string, boolean>>({});

  const usersQuery = useQuery({
    queryKey: ["chat", "create", "users"],
    queryFn: () => usersApi.list({ page: 1, limit: 100, is_active: true }),
    enabled: open,
  });

  const users = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data?.items]);
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => {
      if (user.id === currentUserId) return false;
      if (!q) return true;
      const text = `${user.email} ${user.first_name || ""} ${user.last_name || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [currentUserId, search, users]);

  const selectedIds = Object.keys(selectedMembers).filter((id) => selectedMembers[id]);
  const submitDisabled = type === "DM" ? selectedIds.length !== 1 : !title.trim();

  const submit = async () => {
    if (submitDisabled) return;
    if (type === "DM") {
      await onCreateDm(selectedIds[0]);
    } else {
      await onCreateConversation({
        type: type as "GROUP_CLOSED" | "FORUM_OPEN",
        title: title.trim(),
        topic: topic.trim() || undefined,
        purpose: purpose.trim() || undefined,
        members: type === "GROUP_CLOSED" ? selectedIds : undefined,
        invite_policy: type === "GROUP_CLOSED" ? invitePolicy : undefined,
      });
    }
    setSelectedMembers({});
    setTitle("");
    setTopic("");
    setPurpose("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create Conversation</DialogTitle>
          <DialogDescription>
            Start a DM, private group, or open forum conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Conversation type</Label>
            <Select value={type} onValueChange={(value) => setType(value as ChatConversationType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DM">Direct Message</SelectItem>
                <SelectItem value="GROUP_CLOSED">Private Group</SelectItem>
                <SelectItem value="FORUM_OPEN">Open Forum</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type !== "DM" && (
            <>
              <div className="space-y-1">
                <Label>Title</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Conversation title" />
              </div>
              <div className="space-y-1">
                <Label>Topic</Label>
                <Input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Optional topic" />
              </div>
              <div className="space-y-1">
                <Label>Purpose</Label>
                <Input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Optional purpose" />
              </div>
            </>
          )}

          {type === "GROUP_CLOSED" && (
            <div className="space-y-1">
              <Label>Invite policy</Label>
              <Select value={invitePolicy} onValueChange={(value) => setInvitePolicy(value as ChatInvitePolicy)}>
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
          )}

          {(type === "DM" || type === "GROUP_CLOSED") && (
            <div className="space-y-2">
              <Label>{type === "DM" ? "Select one user" : "Select members"}</Label>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search users..."
              />
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
                {filteredUsers.map((user) => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/60">
                    <Checkbox
                      checked={Boolean(selectedMembers[user.id])}
                      onCheckedChange={(checked) => {
                        setSelectedMembers((prev) => {
                          if (type === "DM") return { [user.id]: Boolean(checked) };
                          return { ...prev, [user.id]: Boolean(checked) };
                        });
                      }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{user.first_name || user.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Button onClick={() => void submit()} disabled={submitDisabled} className="w-full">
            Create conversation
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
