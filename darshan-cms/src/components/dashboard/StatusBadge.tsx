import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Status = 
  | "pending" 
  | "in_review" 
  | "changes_requested" 
  | "approved" 
  | "scheduled" 
  | "published"
  | "live" 
  | "expired" 
  | "rejected"
  | "cancelled"
  | "failed"
  | "online"
  | "offline"
  | "maintenance"
  | "stale"
  | "error"
  | "recovery_required";

interface StatusBadgeProps {
  status?: Status | string;
  className?: string;
}

const statusConfig: Record<Status, { label: string; variant: "outline" | "secondary"; className?: string }> = {
  pending: { label: "Pending", variant: "outline", className: "status-tone-warning" },
  in_review: { label: "In Review", variant: "outline", className: "status-tone-info" },
  changes_requested: { label: "Changes Requested", variant: "outline", className: "status-tone-warning" },
  approved: { label: "Approved", variant: "outline", className: "status-tone-success" },
  scheduled: { label: "Scheduled", variant: "outline", className: "status-tone-info" },
  published: { label: "Published", variant: "outline", className: "status-tone-info" },
  live: { label: "Live", variant: "outline", className: "status-tone-success" },
  expired: { label: "Expired", variant: "secondary" },
  rejected: { label: "Rejected", variant: "outline", className: "status-tone-error" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  failed: { label: "Failed", variant: "outline", className: "status-tone-error" },
  online: { label: "Online", variant: "outline", className: "status-tone-success" },
  offline: { label: "Offline", variant: "outline", className: "status-tone-error" },
  maintenance: { label: "Maintenance", variant: "outline", className: "status-tone-warning" },
  stale: { label: "Stale", variant: "outline", className: "status-tone-warning" },
  error: { label: "Error", variant: "outline", className: "status-tone-error" },
  recovery_required: { label: "Recovery Required", variant: "outline", className: "status-tone-error" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = (status || "offline").toLowerCase().replace(/\s+/g, "_") as Status;
  const config =
    statusConfig[normalized] ?? { label: status ?? "Unknown", variant: "secondary" as const };
  
  return (
    <Badge 
      variant={config.variant}
      className={cn(config.className, className)}
    >
      {config.label}
    </Badge>
  );
}
