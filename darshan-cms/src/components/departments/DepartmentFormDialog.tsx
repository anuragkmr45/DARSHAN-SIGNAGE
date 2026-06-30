import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import type { Department } from "@/api/types";

interface DepartmentFormDialogProps {
  open: boolean;
  onClose: () => void;
  department?: Department | null;
  onSubmit: (payload: { name: string; description?: string }, id?: string) => Promise<void> | void;
  isSubmitting?: boolean;
  onDelete?: (id: string) => Promise<void> | void;
}

export const DepartmentFormDialog = ({
  open,
  onClose,
  department,
  onSubmit,
  isSubmitting,
  onDelete,
}: DepartmentFormDialogProps) => {
  const [formData, setFormData] = useState({ name: "", description: "" });

  useEffect(() => {
    if (department) {
      setFormData({
        name: department.name,
        description: department.description || "",
      });
    } else {
      setFormData({ name: "", description: "" });
    }
  }, [department, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(
      { name: formData.name.trim(), description: formData.description.trim() || "" },
      department?.id
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{department ? "Edit Department" : "Create New Department"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Department Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Marketing"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What content and screens belong here?"
              rows={3}
              disabled={isSubmitting}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !formData.name.trim()}>
              {isSubmitting ? "Saving..." : department ? "Update" : "Create"} Department
            </Button>
          </DialogFooter>
        </form>
        {department?.id && onDelete && (
          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-muted-foreground">Deleting will remove this department permanently.</div>
            <Button
              variant="destructive"
              type="button"
              onClick={() => onDelete(department.id)}
              disabled={isSubmitting}
            >
              Delete
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
