import { Mail, Calendar, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRoleBadgeClass } from "@/lib/roleBadges";

interface Invitation {
    id: string;
    email?: string;
    role?: string;
    invited_at?: string;
    expires_at?: string;
    status?: string;
}

interface InvitationCardProps {
    invitation: Invitation;
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

export function InvitationCard({ invitation }: InvitationCardProps) {
    const { id, email, role, invited_at, expires_at, status } = invitation;

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
                    <span>Invited: {formatDate(invited_at)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Expires: {formatDate(expires_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700">
                        {status || "Pending"}
                    </Badge>
                </div>
            </CardContent>
        </Card>
    );
}
