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

interface Operator {
  id: string;
  name: string;
  email: string;
}

interface DeleteOperatorDialogProps {
  operator: Operator | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteOperatorDialog({
  operator,
  open,
  onOpenChange,
}: DeleteOperatorDialogProps) {
  const { toast } = useToast();

  const handleDelete = () => {
    if (operator) {
      console.log("Deleting operator:", operator.id);
      toast({
        title: "Operator Deleted",
        description: `${operator.name} has been removed from the system.`,
        variant: "destructive",
      });
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Operator</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{operator?.name}</strong>? This action
            cannot be undone and will remove all associated permissions and access.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete Operator
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
