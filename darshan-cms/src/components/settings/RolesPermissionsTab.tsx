import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { actionsForPermissionSubject } from "@/lib/permissionMetadata";

const emptyGrant = (
  actions: string[],
  subjects: string[],
  subjectActions?: Record<string, string[]>,
): RolePermissionGrant => {
  const selectedSubject = subjects[0] ?? "";
  return {
    action: actionsForPermissionSubject(selectedSubject, actions, subjectActions)[0] ?? "",
    subject: selectedSubject,
  };
};

export function RolesPermissionsTab() {
  const { data: rolesData, isLoading: isRolesLoading } = useRolesList();
  const { data: metadata, isLoading: isMetadataLoading } = usePermissionsMetadata();
  const { createRole, updateRole, deleteRole } = useRolesApi();
  const { can, canRecord } = useAuthorization();
  const canCreateRole = can("create", "Role");

  const roles = useMemo(() => rolesData?.items ?? [], [rolesData?.items]);
  const actions = metadata?.actions ?? [];
  const subjects = metadata?.subjects ?? [];
  const subjectActions = metadata?.subject_actions;

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);

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
      setGrants((editingRole.permissions?.grants ?? []).map((grant) => grant.subject === "Backup"
        ? { action: grant.action, subject: grant.subject }
        : grant));
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
    setGrants((prev) => [...prev, emptyGrant(actions, subjects, subjectActions)]);
  };

  const updateGrant = (index: number, patch: Partial<RolePermissionGrant>) => {
    setGrants((prev) =>
      prev.map((grant, idx) => (idx === index ? { ...grant, ...patch } : grant)),
    );
  };

  const removeGrant = (index: number) => {
    setGrants((prev) => prev.filter((_, idx) => idx !== index));
  };

  const draftRole = {
    name: name.trim(),
    description: description.trim(),
    permissions: {
      inherits,
      grants: grants.filter((grant) => grant.action && grant.subject),
    },
  };

  const handleSave = () => {
    if (!draftRole.name) return;
    if (editingRole
      ? !canRecord("update", "Role", editingRole) ||
        !canRecord("update", "Role", { ...editingRole, ...draftRole })
      : !canRecord("create", "Role", draftRole)) return;
    if (editingRole?.is_system) return;

    const payload = draftRole;

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
  const canSave = draftRole.name.length > 0 && !isSaving && !editingRole?.is_system && (editingRole
    ? canRecord("update", "Role", editingRole) &&
      canRecord("update", "Role", { ...editingRole, ...draftRole })
    : canRecord("create", "Role", draftRole));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Roles & Permissions</h2>
          <p className="text-sm text-muted-foreground">
            Manage role definitions and permission grants across the workspace.
          </p>
        </div>
        <Button onClick={() => { setEditingRole(null); setIsDialogOpen(true); }} disabled={!canCreateRole}>
          <Plus className="mr-2 h-4 w-4" />
          New Role
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <CardDescription>
            Built-in roles are read-only; custom roles follow their permission grants.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isRolesLoading ? (
            <div className="text-sm text-muted-foreground">Loading roles...</div>
          ) : roles.length === 0 ? (
            <div className="text-sm text-muted-foreground">No roles available.</div>
          ) : (
            <div className="space-y-3">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (role.is_system || !canRecord("update", "Role", role)) return;
                        setEditingRole(role);
                        setIsDialogOpen(true);
                      }}
                      disabled={!canRecord("update", "Role", role) || role.is_system}
                    >
                      <Pencil className="mr-2 h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      disabled={!canRecord("delete", "Role", role) || role.is_system}
                      onClick={() => {
                        if (role.is_system || !canRecord("delete", "Role", role)) return;
                        setRoleToDelete(role);
                      }}
                    >
                      <Trash2 className="mr-2 h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
              <label className="text-sm font-medium">Role Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Role name" />
            </div>

            <div className="grid gap-3">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this role is for"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inherits From</CardTitle>
                <CardDescription>Select roles to inherit permissions from.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Permission Grants</CardTitle>
                <CardDescription>
                  Add action and subject pairs. Available actions/subjects come from metadata.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {grants.length === 0 && (
                  <div className="text-sm text-muted-foreground">No grants added yet.</div>
                )}

                {grants.map((grant, index) => (
                  <div key={`${grant.action}-${grant.subject}-${index}`} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-[180px] flex-1">
                      <Select
                        value={grant.action}
                        onValueChange={(value) => updateGrant(index, { action: value })}
                        disabled={isMetadataLoading}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Action" />
                        </SelectTrigger>
                        <SelectContent>
                          {actionsForPermissionSubject(grant.subject, actions, subjectActions).map((action) => (
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
                        onValueChange={(value) => {
                          const allowed = actionsForPermissionSubject(value, actions, subjectActions);
                          updateGrant(index, {
                            subject: value,
                            action: allowed.includes(grant.action) ? grant.action : (allowed[0] ?? ""),
                            ...(value === "Backup" ? { conditions: undefined } : {}),
                          });
                        }}
                        disabled={isMetadataLoading}
                      >
                        <SelectTrigger>
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
                    <Button variant="ghost" size="icon" onClick={() => removeGrant(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  {grant.subject === "Backup" ? (
                    <p className="w-full text-xs text-muted-foreground">
                      Backup access is installation-wide and cannot have conditions. Available actions come from server metadata.
                    </p>
                  ) : grant.conditions && Object.keys(grant.conditions).length > 0 && (
                    <p className="w-full text-xs text-muted-foreground">
                      Conditions: {JSON.stringify(grant.conditions)}
                    </p>
                  )}
                  </div>
                ))}

                <Button variant="outline" size="sm" onClick={addGrant} disabled={isMetadataLoading}>
                  <Shield className="mr-2 h-4 w-4" />
                  Add Grant
                </Button>
              </CardContent>
            </Card>
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
        description={roleToDelete ? `This will delete ${roleToDelete.name}.` : undefined}
        confirmLabel="Delete"
        onCancel={() => setRoleToDelete(null)}
        onConfirm={() => {
          if (!roleToDelete || roleToDelete.is_system || !canRecord("delete", "Role", roleToDelete)) return;
          deleteRole.mutate(roleToDelete.id, {
            onSuccess: () => setRoleToDelete(null),
          });
        }}
        isLoading={deleteRole.isPending}
        confirmDisabled={!roleToDelete || roleToDelete.is_system || !canRecord("delete", "Role", roleToDelete)}
      />
    </div>
  );
}
