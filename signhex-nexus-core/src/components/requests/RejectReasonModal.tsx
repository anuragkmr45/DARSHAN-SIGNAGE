import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RejectReasonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestTitle: string;
  onConfirm: (reason: string) => void;
}

export function RejectReasonModal({
  open,
  onOpenChange,
  requestTitle,
  onConfirm,
}: RejectReasonModalProps) {
  const [reason, setReason] = useState("");
  const { toast } = useToast();

  const handleConfirm = () => {
    if (!reason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for rejecting this request.",
        variant: "destructive",
      });
      return;
    }

    onConfirm(reason);
    setReason("");
    onOpenChange(false);
  };

  const handleCancel = () => {
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Reject Request
          </DialogTitle>
          <DialogDescription>
            You are about to reject "<strong>{requestTitle}</strong>". This action will route the request back to the department for revision.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="rejection-reason">
              Reason for Rejection <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="rejection-reason"
              placeholder="Please provide a detailed reason for rejecting this request. This will help the team understand what needs to be changed."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={5}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Minimum 10 characters required. Be specific about what needs to be changed.
            </p>
          </div>

          <div className="bg-muted p-3 rounded-lg">
            <p className="text-sm font-medium mb-2">What happens next:</p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Request status changes to "Changes Requested"</li>
              <li>Request returns to department for revision</li>
              <li>Team receives notification with your feedback</li>
              <li>Action is logged in audit trail</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleConfirm}
            disabled={!reason.trim() || reason.trim().length < 10}
          >
            Reject Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
