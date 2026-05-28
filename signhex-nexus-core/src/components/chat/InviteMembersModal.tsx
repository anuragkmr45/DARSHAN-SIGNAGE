import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { usersApi } from "@/api/domains/users";
import type { ChatConversationListItem } from "@/api/types";
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

interface InviteMembersModalProps {
  open: boolean;
  conversation?: ChatConversationListItem;
  currentUserId?: string;
  canInvite: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (userIds: string[]) => Promise<void> | void;
}

export function InviteMembersModal({
  open,
  conversation,
  currentUserId,
  canInvite,
  onOpenChange,
  onInvite,
}: InviteMembersModalProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const usersQuery = useQuery({
    queryKey: ["chat", "invite", "users"],
    queryFn: () => usersApi.list({ page: 1, limit: 100, is_active: true }),
    enabled: open,
  });

  const users = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data?.items]);
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      if (user.id === currentUserId) return false;
      if (!query) return true;
      const text = `${user.email} ${user.first_name || ""} ${user.last_name || ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [currentUserId, search, users]);

  const selectedIds = Object.keys(selected).filter((key) => selected[key]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Members</DialogTitle>
          <DialogDescription>
            Add members to {conversation?.title || "this conversation"}.
          </DialogDescription>
        </DialogHeader>

        {conversation?.type === "DM" ? (
          <p className="text-sm text-muted-foreground">Direct messages cannot have additional members.</p>
        ) : !canInvite ? (
          <p className="text-sm text-muted-foreground">
            Invites are disabled by policy or limited to admins for this conversation.
          </p>
        ) : (
          <div className="space-y-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search users..."
            />

            <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-2">
              {usersQuery.isLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading users...
                </div>
              ) : filteredUsers.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">No users found.</p>
              ) : (
                filteredUsers.map((user) => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/60">
                    <Checkbox
                      checked={Boolean(selected[user.id])}
                      onCheckedChange={(checked) =>
                        setSelected((prev) => ({ ...prev, [user.id]: Boolean(checked) }))
                      }
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{user.first_name || user.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </label>
                ))
              )}
            </div>

            <Button
              className="w-full"
              disabled={!selectedIds.length}
              onClick={async () => {
                await onInvite(selectedIds);
                setSelected({});
                onOpenChange(false);
              }}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Invite {selectedIds.length || ""} member{selectedIds.length === 1 ? "" : "s"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
