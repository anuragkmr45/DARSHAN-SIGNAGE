import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { User } from "@/api/types";
import { getRoleBadgeClass } from "@/lib/roleBadges";

interface UserCardProps {
    user: User;
    onEdit: () => void;
    onDelete: () => void;
    canEdit?: boolean;
    canDelete?: boolean;
}

export function UserCard({ user, onEdit, onDelete, canEdit = true, canDelete = true }: UserCardProps) {
    const { id, email, first_name, last_name, role, is_active } = user;
    const fullName = `${first_name || ""} ${last_name || ""}`.trim();
    const displayName = fullName || email;

    return (
        <div key={id} className="flex flex-wrap items-start justify-between gap-3 px-1 py-4 sm:flex-nowrap sm:px-3">
            <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-medium">{displayName}</h3><Badge className={getRoleBadgeClass(role)}>{role}</Badge><Badge variant="outline">{is_active ? "Active" : "Inactive"}</Badge></div>
                <p className="break-all text-sm text-muted-foreground">{email}</p>
                {user.departments?.length ? <p className="text-xs text-muted-foreground">{user.departments.map((item) => `${item.is_primary ? "Primary" : "Additional"}: ${item.name}`).join(" · ")}</p> : null}
                <details className="text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">Technical ID</summary><code className="mt-1 block break-all">{id}</code></details>
            </div>
            {(canEdit || canDelete) && (
                    <div className="flex flex-wrap gap-2">
                        {canEdit && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="min-h-9"
                                onClick={onEdit}
                            >
                                <Pencil className="mr-2 h-3 w-3" />
                                Edit
                            </Button>
                        )}
                        {canDelete && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="min-h-9 text-destructive hover:text-destructive"
                                onClick={onDelete}
                            >
                                <Trash2 className="mr-2 h-3 w-3" />
                                Delete
                            </Button>
                        )}
                    </div>
            )}
        </div>
    );
}
