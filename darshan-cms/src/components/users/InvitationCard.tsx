import { Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRoleBadgeClass } from "@/lib/roleBadges";
import type { UserInvitation } from "@/api/domains/users";

interface InvitationCardProps {
    invitation: UserInvitation;
    onReissue?: (invitation: UserInvitation) => void;
}

const formatDate = (dateString?: string): string => {
    if (!dateString) return "N/A";
    try {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return "Unknown";
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    } catch {
        return "Invalid date";
    }
};

export function InvitationCard({ invitation, onReissue }: InvitationCardProps) {
    const { id, email, role, invited_at, invite_expires_at, invite_status } = invitation;

    return (
        <div key={id} className="flex flex-wrap items-start justify-between gap-3 px-1 py-4 sm:flex-nowrap sm:px-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2"><Mail aria-hidden="true" className="h-4 w-4 text-muted-foreground" /><h3 className="break-all font-medium">{email || "No email"}</h3>{role && <Badge className={getRoleBadgeClass(role)}>{role}</Badge>}<Badge variant="outline">{invite_status === "EXPIRED" ? "Expired" : invite_status === "ACTIVATED" ? "Activated" : "Pending"}</Badge></div>
            <p className="text-sm text-muted-foreground">Created {formatDate(invited_at)} · Expires {formatDate(invite_expires_at)}</p>
          </div>
          {onReissue && (invite_status === "PENDING" || invite_status === "EXPIRED") && <Button variant="outline" size="sm" onClick={() => onReissue(invitation)}>Renew code</Button>}
        </div>
    );
}
