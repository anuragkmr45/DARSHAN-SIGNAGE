import { Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        <Card key={id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg leading-tight">{displayName}</CardTitle>
                    <Badge className={getRoleBadgeClass(role)}>{role}</Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                    <p className="truncate">{email}</p>
                    {first_name && last_name && (
                        <p className="text-xs mt-1">
                            {first_name} {last_name}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant={is_active ? "default" : "secondary"}>
                        {is_active ? "Active" : "Inactive"}
                    </Badge>
                </div>
                {(canEdit || canDelete) && (
                    <div className="flex gap-2 pt-2">
                        {canEdit && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
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
                                className="flex-1 text-destructive hover:text-destructive"
                                onClick={onDelete}
                            >
                                <Trash2 className="mr-2 h-3 w-3" />
                                Delete
                            </Button>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
