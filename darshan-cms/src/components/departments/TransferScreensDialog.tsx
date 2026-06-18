import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Department {
  id: string;
  name: string;
  description: string;
  screenCount: number;
  owners: string[];
  operators: string[];
  storageUsed: string;
  storageQuota: string;
}

interface TransferScreensDialogProps {
  open: boolean;
  onClose: () => void;
  department?: Department | null;
}

const mockScreens = [
  { id: "scr-1", name: "Lobby Display 1", status: "online" },
  { id: "scr-2", name: "Lobby Display 2", status: "online" },
  { id: "scr-3", name: "Conference Room A", status: "offline" },
  { id: "scr-4", name: "Cafeteria Main", status: "online" },
  { id: "scr-5", name: "Entrance Hall", status: "online" },
];

const mockTargetDepartments = [
  { id: "dept-2", name: "HR & Internal Comms" },
  { id: "dept-3", name: "Operations" },
  { id: "dept-4", name: "Sales" },
];

export const TransferScreensDialog = ({ open, onClose, department }: TransferScreensDialogProps) => {
  const { toast } = useToast();
  const [targetDept, setTargetDept] = useState("");
  const [selectedScreens, setSelectedScreens] = useState<string[]>([]);

  const handleToggleScreen = (screenId: string) => {
    setSelectedScreens((prev) =>
      prev.includes(screenId) ? prev.filter((id) => id !== screenId) : [...prev, screenId]
    );
  };

  const handleTransfer = () => {
    if (!targetDept || selectedScreens.length === 0) {
      toast({
        title: "Invalid selection",
        description: "Please select a target department and at least one screen.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Screens transferred",
      description: `${selectedScreens.length} screen(s) transferred successfully.`,
    });
    setSelectedScreens([]);
    setTargetDept("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Transfer Screens</DialogTitle>
          <DialogDescription>
            Move screens from <span className="font-semibold">{department?.name}</span> to another department
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="targetDept">Target Department *</Label>
            <Select value={targetDept} onValueChange={setTargetDept}>
              <SelectTrigger id="targetDept">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {mockTargetDepartments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Select Screens ({selectedScreens.length} selected)</Label>
            <ScrollArea className="h-[200px] border rounded-md p-3">
              <div className="space-y-3">
                {mockScreens.map((screen) => (
                  <div key={screen.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={screen.id}
                      checked={selectedScreens.includes(screen.id)}
                      onCheckedChange={() => handleToggleScreen(screen.id)}
                    />
                    <label
                      htmlFor={screen.id}
                      className="flex-1 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {screen.name}
                      <span
                        className={`ml-2 text-xs ${
                          screen.status === "online" ? "text-success" : "text-muted-foreground"
                        }`}
                      >
                        ({screen.status})
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleTransfer}>
            Transfer Screens
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
