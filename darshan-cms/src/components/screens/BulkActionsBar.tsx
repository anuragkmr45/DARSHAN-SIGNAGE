import { useState } from "react";
import { X, Power, Building2, Activity, Tag, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface BulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
}

export function BulkActionsBar({ selectedCount, onClearSelection }: BulkActionsBarProps) {
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showHealthCheckConfirm, setShowHealthCheckConfirm] = useState(false);
  const [showDepartmentDialog, setShowDepartmentDialog] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState("");

  const handleBulkRestart = () => {
    toast.success(`Restart command sent to ${selectedCount} screens`);
    setShowRestartConfirm(false);
    onClearSelection();
  };

  const handleBulkHealthCheck = () => {
    toast.success(`Health check initiated for ${selectedCount} screens`);
    setShowHealthCheckConfirm(false);
    onClearSelection();
  };

  const handleBulkAssignDepartment = () => {
    if (!selectedDepartment) {
      toast.error("Please select a department");
      return;
    }
    toast.success(`${selectedCount} screens assigned to ${selectedDepartment}`);
    setShowDepartmentDialog(false);
    setSelectedDepartment("");
    onClearSelection();
  };

  const handleExportSelection = () => {
    toast.success(`Exporting ${selectedCount} screens to CSV`);
  };

  if (selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <div className="bg-primary text-primary-foreground rounded-lg shadow-lg px-6 py-4 flex items-center gap-4">
          <Badge variant="secondary" className="bg-primary-foreground/20 text-primary-foreground">
            {selectedCount} selected
          </Badge>

          <div className="h-6 w-px bg-primary-foreground/20" />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowRestartConfirm(true)}
            >
              <Power className="h-3 w-3 mr-1" />
              Restart
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowDepartmentDialog(true)}
            >
              <Building2 className="h-3 w-3 mr-1" />
              Assign Department
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowHealthCheckConfirm(true)}
            >
              <Activity className="h-3 w-3 mr-1" />
              Health Check
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={handleExportSelection}
            >
              <Download className="h-3 w-3 mr-1" />
              Export
            </Button>
          </div>

          <div className="h-6 w-px bg-primary-foreground/20" />

          <Button
            size="sm"
            variant="ghost"
            onClick={onClearSelection}
            className="text-primary-foreground hover:bg-primary-foreground/20"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Restart Confirmation */}
      <AlertDialog open={showRestartConfirm} onOpenChange={setShowRestartConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart {selectedCount} Screens?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a restart command to all selected screens. Active content will be
              interrupted temporarily. Screens will automatically reconnect within 1-2 minutes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkRestart}>
              Restart Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Health Check Confirmation */}
      <AlertDialog open={showHealthCheckConfirm} onOpenChange={setShowHealthCheckConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run Health Check on {selectedCount} Screens?</AlertDialogTitle>
            <AlertDialogDescription>
              This will perform a comprehensive health diagnostic on all selected screens,
              including connectivity, performance, and storage checks. Results will be available
              in the Health Dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkHealthCheck}>
              Run Health Check
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Department Assignment Dialog */}
      <AlertDialog open={showDepartmentDialog} onOpenChange={setShowDepartmentDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign Department to {selectedCount} Screens</AlertDialogTitle>
            <AlertDialogDescription>
              Select a department to assign all selected screens. This will update department
              ownership and access permissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Marketing">Marketing</SelectItem>
                <SelectItem value="HR">HR</SelectItem>
                <SelectItem value="Sales">Sales</SelectItem>
                <SelectItem value="IT Operations">IT Operations</SelectItem>
                <SelectItem value="Food & Beverage">Food & Beverage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkAssignDepartment}>
              Assign Department
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
