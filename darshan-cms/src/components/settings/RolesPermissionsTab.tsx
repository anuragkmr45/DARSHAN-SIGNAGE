import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { usePermissionsMetadata, useRolesApi, useRolesList } from "@/hooks/useRolesApi";
import { useAuthorization } from "@/hooks/useAuthorization";
import type { Role, RolePermissionGrant } from "@/api/types";

const emptyGrant = (): RolePermissionGrant => ({ action: "", subject: "" });

export function RolesPermissionsTab() {
  const { data: rolesData, isLoading: isRolesLoading, isError: rolesError, isFetching: rolesFetching, refetch: retryRoles } = useRolesList();
  const { data: metadata, isLoading: isMetadataLoading, isError: metadataError, refetch: retryMetadata } = usePermissionsMetadata();
  const { createRole, updateRole, deleteRole } = useRolesApi();
  const { can } = useAuthorization();
  const canCreateRole = can("create", "Role");
  const canUpdateRole = can("update", "Role");
  const canDeleteRole = can("delete", "Role");

  const roles = useMemo(() => rolesData?.items ?? [], [rolesData?.items]);
  const actions = metadata?.actions ?? [];
  const subjects = metadata?.subjects ?? [];

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inherits, setInherits] = useState<string[]>([]);
  const [grants, setGrants] = useState<RolePermissionGrant[]>([]);

  const availableInherits = useMemo(
    () => roles.filter((role) => role.id !== editingRole?.id),
    [roles, editingRole],
  );

  useEffect(() => {
    if (!isDialogOpen) return;
    if (editingRole) {
      setName(editingRole.name);
      setDescription(editingRole.description ?? "");
      setInherits(editingRole.permissions?.inherits ?? []);
      setGrants(editingRole.permissions?.grants ?? []);
    } else {
      setName("");
      setDescription("");
      setInherits([]);
      setGrants([]);
    }
  }, [editingRole, isDialogOpen]);

  const toggleInherit = (roleId: string) => {
    setInherits((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  };

  const addGrant = () => {
    if (actions.length === 0 || subjects.length === 0) return;
    setGrants((prev) => [...prev, emptyGrant()]);
  };

  const updateGrant = (index: number, patch: Partial<RolePermissionGrant>) => {
    setGrants((prev) =>
      prev.map((grant, idx) => (idx === index ? { ...grant, ...patch } : grant)),
    );
  };

  const removeGrant = (index: number) => {
    setGrants((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = () => {
    if (!canSave) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (editingRole ? !canUpdateRole : !canCreateRole) return;
    if (editingRole?.is_system) return;

    const payload = {
      name: trimmedName,
      description: description.trim() || undefined,
      permissions: {
        inherits,
        grants,
      },
    };

    if (editingRole) {
      updateRole.mutate(
        { roleId: editingRole.id, payload },
        {
          onSuccess: () => {
            setIsDialogOpen(false);
            setEditingRole(null);
          },
        },
      );
    } else {
      createRole.mutate(payload, {
        onSuccess: () => {
          setIsDialogOpen(false);
        },
      });
    }
  };

  const isSaving = createRole.isPending || updateRole.isPending;
  const incompleteGrant = grants.some((grant) => !grant.action || !grant.subject);
  const duplicateGrant = new Set(grants.map((grant) => `${grant.action}:${grant.subject}`)).size !== grants.length;
  const canSave = name.trim().length > 0 && name.trim().length <= 100 && !isSaving && !isMetadataLoading && !metadataError && Boolean(metadata)
    && !incompleteGrant && !duplicateGrant && (editingRole ? canUpdateRole : canCreateRole)
    && !editingRole?.is_system;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="text-xl font-semibold">Roles & Permissions</h2>
          <p className="text-sm text-muted-foreground">
            Built-in roles are fixed. Create custom roles for permissions that need to persist.
          </p>
        </div>
        {canCreateRole ? <Button onClick={() => { setEditingRole(null); setIsDialogOpen(true); }} disabled={isMetadataLoading || metadataError}>
          <Plus className="mr-2 h-4 w-4" />
          New Role
        </Button> : null}
      </div>

      {metadataError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
        <span>Permission options could not be loaded. Role editing is unavailable.</span>
        <Button variant="outline" size="sm" onClick={() => void retryMetadata()}>Retry</Button>
      </div> : null}
      {rolesError && rolesData ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
        <span>Could not refresh roles. Showing the last loaded list.</span>
        <Button variant="outline" size="sm" onClick={() => void retryRoles()}>Retry</Button>
      </div> : null}
      <div className="divide-y rounded-xl border bg-card px-4 sm:px-5">
          {rolesError && !rolesData ? (
            <div className="space-y-3 py-6"><p className="text-sm text-destructive">Could not load roles.</p><Button variant="outline" onClick={() => void retryRoles()}>Retry</Button></div>
          ) : null}
          {isRolesLoading ? (
            <div className="py-6 text-sm text-muted-foreground">Loading roles…</div>
          ) : !rolesError && roles.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">No roles available.</div>
          ) : roles.length > 0 ? (
            <div>
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b py-4 last:border-b-0"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{role.name}</h3>
                      {role.is_system && (
                        <Badge variant="outline" className="text-xs">
                          System
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {role.description || "No description provided"}
                    </p>
                    <div className="text-xs text-muted-foreground">
                      {role.permissions?.grants?.length ?? 0} grants · {role.permissions?.inherits?.length ?? 0} inherits
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {canUpdateRole && !role.is_system ? <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setEditingRole(role); setIsDialogOpen(true); }}
                      disabled={isMetadataLoading || metadataError}
                    >
                      <Pencil className="mr-2 h-3 w-3" />
                      Edit
                    </Button> : null}
                    {canDeleteRole && !role.is_system ? <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => { setDeleteConfirmation(""); setRoleToDelete(role); }}
                    >
                      <Trash2 className="mr-2 h-3 w-3" />
                      Delete
                    </Button> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
      </div>
      {rolesFetching && rolesData ? <p className="text-xs text-muted-foreground">Updating roles…</p> : null}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{editingRole ? "Edit Role" : "Create Role"}</DialogTitle>
            <DialogDescription>
              Define role details, inherited roles, and permission grants.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-3">
              <Label htmlFor="role-name">Role name</Label>
              <Input id="role-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Role name" />
            </div>

            <div className="grid gap-3">
              <Label htmlFor="role-description">Description</Label>
              <Textarea
                id="role-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this role is for"
              />
            </div>

            <section className="space-y-3 border-t pt-4">
              <div>
                <h3 className="font-medium">Inherits from</h3>
                <p className="text-sm text-muted-foreground">This role also receives every permission of a selected role.</p>
              </div>
              <div className="space-y-2">
                {availableInherits.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No other roles available.</div>
                ) : (
                  availableInherits.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={inherits.includes(role.id)}
                        onCheckedChange={() => toggleInherit(role.id)}
                      />
                      <span>{role.name}</span>
                    </label>
                  ))
                )}
              </div>
            </section>

            <section className="space-y-3 border-t pt-4">
              <div>
                <h3 className="font-medium">Direct permissions</h3>
                <p className="text-sm text-muted-foreground">Choose both an action and a resource for each permission.</p>
              </div>
              <div className="space-y-3">
                {grants.length === 0 && (
                  <div className="text-sm text-muted-foreground">No grants added yet.</div>
                )}

                {grants.map((grant, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-[180px] flex-1">
                      <Select
                        value={grant.action}
                        onValueChange={(value) => updateGrant(index, { action: value })}
                        disabled={isMetadataLoading}
                      >
                        <SelectTrigger aria-label={`Permission ${index + 1} action`}>
                          <SelectValue placeholder="Action" />
                        </SelectTrigger>
                        <SelectContent>
                          {actions.map((action) => (
                            <SelectItem key={action} value={action}>
                              {action}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <Select
                        value={grant.subject}
                        onValueChange={(value) => updateGrant(index, { subject: value })}
                        disabled={isMetadataLoading}
                      >
                        <SelectTrigger aria-label={`Permission ${index + 1} resource`}>
                          <SelectValue placeholder="Subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {subjects.map((subject) => (
                            <SelectItem key={subject} value={subject}>
                              {subject}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="ghost" size="icon" aria-label={`Remove permission ${index + 1}`} onClick={() => removeGrant(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                {incompleteGrant ? <p className="text-sm text-destructive">Choose an action and resource for every permission before saving.</p> : null}
                {duplicateGrant ? <p className="text-sm text-destructive">Each action and resource pair can be added once.</p> : null}
                <Button variant="outline" size="sm" onClick={addGrant} disabled={isMetadataLoading || metadataError || !metadata}>
                  <Shield className="mr-2 h-4 w-4" />
                  Add Grant
                </Button>
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {isSaving ? "Saving..." : editingRole ? "Update Role" : "Create Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(roleToDelete)}
        title="Delete role?"
        description={roleToDelete ? `Type ${roleToDelete.name} to confirm. Users or other roles that still use it will block deletion.` : undefined}
        confirmLabel="Delete"
        onCancel={() => { if (!deleteRole.isPending) setRoleToDelete(null); }}
        onConfirm={() => {
          if (!roleToDelete) return;
          deleteRole.mutate(roleToDelete.id, {
            onSuccess: () => { setRoleToDelete(null); setDeleteConfirmation(""); },
          });
        }}
        isLoading={deleteRole.isPending}
        confirmDisabled={!canDeleteRole || Boolean(roleToDelete?.is_system) || deleteConfirmation !== roleToDelete?.name}
      >
        <Label htmlFor="role-delete-confirm">Role name</Label>
        <Input id="role-delete-confirm" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" />
      </ConfirmDialog>
    </div>
  );
}
