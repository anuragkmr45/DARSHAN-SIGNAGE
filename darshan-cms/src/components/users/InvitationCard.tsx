import { Mail, Calendar, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRoleBadgeClass } from "@/lib/roleBadges";
import { Button } from "@/components/ui/button";

interface Invitation {
    id: string;
    email?: string;
    role?: string;
    invited_at?: string | null;
    invite_expires_at?: string | null;
    invite_status?: string | null;
    can_replace?: boolean;
    updated_at?: string;
}

interface InvitationCardProps {
    invitation: Invitation;
    onReplace?: () => void;
    isReplacing?: boolean;
}

const formatDate = (dateString?: string): string => {
    if (!dateString) return "N/A";
    try {
        return new Date(dateString).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    } catch {
        return "Invalid date";
    }
};

export function InvitationCard({ invitation, onReplace, isReplacing = false }: InvitationCardProps) {
    const { id, email, role, invited_at, invite_expires_at, invite_status, can_replace } = invitation;

    return (
        <Card key={id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg leading-tight flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {email || "No email"}
                    </CardTitle>
                    {role && <Badge className={getRoleBadgeClass(role)}>{role}</Badge>}
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>Invited: {formatDate(invited_at ?? undefined)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Expires: {formatDate(invite_expires_at ?? undefined)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700">
                        {invite_status || "Pending"}
                    </Badge>
                </div>
                {can_replace && onReplace ? (
                    <Button type="button" variant="outline" onClick={onReplace} disabled={isReplacing}>
                        Replace link
                    </Button>
                ) : null}
            </CardContent>
        </Card>
    );
}
