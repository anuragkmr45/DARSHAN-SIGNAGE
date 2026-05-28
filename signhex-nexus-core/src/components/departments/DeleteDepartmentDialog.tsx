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
import { useToast } from "@/hooks/use-toast";

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

interface DeleteDepartmentDialogProps {
  open: boolean;
  onClose: () => void;
  department?: Department | null;
}

export const DeleteDepartmentDialog = ({ open, onClose, department }: DeleteDepartmentDialogProps) => {
  const { toast } = useToast();

  const handleDelete = () => {
    toast({
      title: "Department deleted",
      description: `${department?.name} has been deleted successfully.`,
    });
    onClose();
  };

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Department?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <span className="font-semibold">{department?.name}</span>?
            This action cannot be undone.
            {department && department.screenCount > 0 && (
              <span className="block mt-2 text-destructive">
                Warning: This department has {department.screenCount} screen(s) assigned. They will be
                unassigned.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete Department
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
