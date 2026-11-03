import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MoreVertical, Edit, Trash2, RefreshCw, CheckCircle, Plus, Loader2, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usersApi } from "@/api/domains/users";
import type { User as ApiUser } from "@/api/types";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/api/apiClient";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common/PageHeader";
import { SearchBar } from "@/components/common/SearchBar";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { queryKeys } from "@/api/queryKeys";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { useRolesList } from "@/hooks/useRolesApi";
import { getRoleBadgeClass } from "@/lib/roleBadges";
import { PageNavigation } from "@/components/common/PageNavigation";
import { useAppSelector } from "@/store/hooks";
import { departmentsApi } from "@/api/domains/departments";
import { useAuthorization } from "@/hooks/useAuthorization";
import { AdditionalDepartmentsPicker } from "@/components/users/AdditionalDepartmentsPicker";

const PAGE_SIZE = 9;

export default function Operators() {
  const currentUser = useAppSelector((state) => state.auth.user);
  const { can } = useAuthorization();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ApiUser | null>(null);
  const [formData, setFormData] = useState({
    email: "",
    first_name: "",
    last_name: "",
    role_id: "",
    department_id: "",
    additional_department_ids: [] as string[],
    password: "",
    confirm_password: "",
  });
  const [pendingActionUser, setPendingActionUser] = useState<ApiUser | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isActivateConfirmOpen, setIsActivateConfirmOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const operatorsQueryKey = ["users", "operators", page, PAGE_SIZE, searchQuery] as const;

  const { data, isLoading, isFetching, isError, error, isPlaceholderData, refetch } = useQuery({
    queryKey: operatorsQueryKey,
    queryFn: () => usersApi.list({ page, limit: PAGE_SIZE, role: "OPERATOR", search: searchQuery || undefined }),
    placeholderData: (previousData) => previousData,
  });

  const { data: rolesData, isLoading: isRolesLoading } = useRolesList();
  const roles = useMemo(() => rolesData?.items ?? [], [rolesData?.items]);
  const operatorRole = useMemo(() => roles.find((role) => role.name === "OPERATOR") ?? null, [roles]);
  const canCreate = can("create", "User");
  const canUpdate = can("update", "User");
  const canDelete = can("delete", "User");
  const canPickDepartment = can("manage", "User") && can("read", "Department");
  const { data: departmentsData, isLoading: isDepartmentsLoading } = useQuery({
    queryKey: [...queryKeys.departments, "all"],
    queryFn: departmentsApi.listAll,
    enabled: canPickDepartment,
  });
  const departments = useMemo(() => departmentsData ?? [], [departmentsData]);
  const departmentMap = useMemo(() => new Map(departments.map((department) => [department.id, department.name])), [departments]);
  const passwordMismatch = !selectedUser && Boolean(formData.confirm_password) && formData.password !== formData.confirm_password;

  const users = useMemo(() => data?.items ?? [], [data]);

  const filtered = users;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  useEffect(() => {
    if (data && !isPlaceholderData && page > totalPages) {
      setPage(totalPages);
    }
  }, [data, isPlaceholderData, page, totalPages]);

  useEffect(() => {
    if (selectedUser) {
      setFormData({
        email: selectedUser.email,
        first_name: selectedUser.first_name ?? "",
        last_name: selectedUser.last_name ?? "",
        role_id: operatorRole?.id ?? selectedUser.role_id,
        department_id:
          !canPickDepartment ? currentUser?.department_id ?? "" : selectedUser.department_id ?? "",
        additional_department_ids: selectedUser.additional_department_ids ?? [],
        password: "",
        confirm_password: "",
      });
    } else {
      setFormData({
        email: "",
        first_name: "",
        last_name: "",
        role_id: operatorRole?.id ?? "",
        department_id: !canPickDepartment ? currentUser?.department_id ?? "" : "",
        additional_department_ids: [],
        password: "",
        confirm_password: "",
      });
    }
  }, [canPickDepartment, currentUser?.department_id, isFormOpen, operatorRole?.id, selectedUser]);

  useEffect(() => {
    if (operatorRole && formData.role_id !== operatorRole.id) {
      setFormData((prev) => ({ ...prev, role_id: operatorRole.id }));
    }
  }, [formData.role_id, operatorRole]);

  const createOrUpdate = useSafeMutation({
    mutationFn: async () => {
      if (!selectedUser && formData.password !== formData.confirm_password) {
        throw new Error("Password and confirm password must match.");
      }

      if (selectedUser) {
        // Update existing user
        const payload = {
          email: formData.email.trim(),
          first_name: formData.first_name.trim() || undefined,
          last_name: formData.last_name.trim() || undefined,
          role_id: formData.role_id,
          department_id: formData.department_id.trim() || undefined,
          additional_department_ids: canPickDepartment ? formData.additional_department_ids : undefined,
        };
        return usersApi.update(selectedUser.id, payload);
      }

      // Create new user with password
      const payload = {
        email: formData.email.trim(),
        first_name: formData.first_name.trim() || undefined,
        last_name: formData.last_name.trim() || undefined,
        role_id: formData.role_id,
        department_id: formData.department_id.trim() || undefined,
        additional_department_ids: canPickDepartment ? formData.additional_department_ids : undefined,
        password: formData.password,
      };
      return usersApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
      queryClient.invalidateQueries({ queryKey: ["users", "operators"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.departments });
      setIsFormOpen(false);
      setSelectedUser(null);
    },
  }, "Unable to save operator.");

  const deleteUser = useSafeMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
      queryClient.invalidateQueries({ queryKey: ["users", "operators"] });
      setPendingActionUser(null);
      setIsDeleteConfirmOpen(false);
    },
  }, "Unable to delete operator.");

  const resetPassword = useSafeMutation({
    mutationFn: (id: string) => usersApi.resetPassword(id),
    onSuccess: (data) => {
      setPendingActionUser(null);
      setIsResetConfirmOpen(false);
      setTemporaryPassword(data.temp_password);
    },
  }, "Unable to reset password.");

  const activateUser = useSafeMutation({
    mutationFn: (id: string) => usersApi.update(id, { is_active: true } as Partial<ApiUser>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
      queryClient.invalidateQueries({ queryKey: ["users", "operators"] });
      setPendingActionUser(null);
      setIsActivateConfirmOpen(false);
    },
  }, "Unable to activate operator.");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title="Operators"
        description="Manage operator access and department membership."
        actionLabel={canCreate ? "New Operator" : undefined}
        actionIcon={canCreate ? <Plus className="h-4 w-4" /> : undefined}
        onAction={
          canCreate
            ? () => {
                setSelectedUser(null);
                setIsFormOpen(true);
              }
            : undefined
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-sm">
          <SearchBar placeholder="Search operators..." onSearch={setSearchQuery} initialValue={searchQuery} />
        </div>
        <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground" aria-live="polite">{data?.total ?? 0} {(data?.total ?? 0) === 1 ? "operator" : "operators"}{isFetching && !isLoading ? " · Updating" : ""}</span><Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh</Button></div>
      </div>

      {isLoading ? (
        <LoadingIndicator label="Loading operators..." />
      ) : isError && !data ? (
        <EmptyState title="Could not load operators" description={error instanceof ApiError ? error.message : "Please try again."} actionLabel="Retry" onAction={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState title={searchQuery ? "No matching operators" : "No operators yet"} description={searchQuery ? "Try another search." : "Create an operator to assign access."} />
      ) : (
        <div className="space-y-4">
          <div className="divide-y border-y">
            {filtered.map((operator: ApiUser) => (
              <div key={operator.id} className="flex flex-wrap items-start justify-between gap-3 px-1 py-4 sm:flex-nowrap sm:px-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-medium">
                      {operator.first_name || operator.last_name
                        ? `${operator.first_name ?? ""} ${operator.last_name ?? ""}`.trim()
                        : operator.email}
                    </span>
                    {!operator.is_active && <Badge variant="outline" className="text-xs text-destructive border-destructive/40">Inactive</Badge>}
                  </div>
                  <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><Mail aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="truncate">{operator.email}</span></div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge className={getRoleBadgeClass(operator.role)}>{operator.role}</Badge>
                    {Array.from(new Set(operator.department_ids ?? (operator.department_id ? [operator.department_id] : []))).map((id) => (
                      <Badge key={id} variant="outline" className="max-w-full text-xs"><span className="truncate">{id === operator.department_id ? "Primary" : "Additional"}: {departmentMap.get(id) ?? operator.departments?.find((item) => item.id === id)?.name ?? id}</span></Badge>
                    ))}
                  </div>
                  <details className="text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">Technical ID</summary><code className="mt-1 block break-all">{operator.id}</code></details>
                </div>
                {(canUpdate || canDelete) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${operator.email}`}>
                      <MoreVertical className="h-4 w-4" />
                      <span className="sr-only">Actions for {operator.email}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canUpdate && <DropdownMenuItem
                      onClick={() => {
                        setSelectedUser(operator);
                        setIsFormOpen(true);
                      }}
                      className="gap-2"
                    >
                      <Edit className="h-4 w-4" />
                      Edit
                    </DropdownMenuItem>}
                    {canUpdate && !operator.is_active && (
                      <DropdownMenuItem
                        onClick={() => {
                          setPendingActionUser(operator);
                          setIsActivateConfirmOpen(true);
                        }}
                        className="gap-2"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Activate
                      </DropdownMenuItem>
                    )}
                    {canUpdate && <DropdownMenuItem
                      onClick={() => {
                        setPendingActionUser(operator);
                        setIsResetConfirmOpen(true);
                      }}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reset Password
                    </DropdownMenuItem>}
                    {canDelete && <DropdownMenuItem
                      onClick={() => {
                        setPendingActionUser(operator);
                        setIsDeleteConfirmOpen(true);
                      }}
                      className="gap-2 text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
                ) : null}
              </div>
            ))}
          </div>
          {data && data.total > PAGE_SIZE && <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} />}
        </div>
      )}
      {isError && data && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">Could not refresh operators. Showing the last loaded page. <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button></div>}
      <Dialog open={(canCreate || canUpdate) && isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[520px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedUser ? "Edit Operator" : "Add Operator"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                placeholder="operator@company.com"
                disabled={createOrUpdate.isPending}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first-name">First name</Label>
                <Input
                  id="first-name"
                  value={formData.first_name}
                  onChange={(e) => setFormData((p) => ({ ...p, first_name: e.target.value }))}
                  disabled={createOrUpdate.isPending}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last-name">Last name</Label>
                <Input
                  id="last-name"
                  value={formData.last_name}
                  onChange={(e) => setFormData((p) => ({ ...p, last_name: e.target.value }))}
                  disabled={createOrUpdate.isPending}
                  placeholder="Optional"
                />
              </div>
            </div>
            {!selectedUser && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                    placeholder="Enter initial password"
                    disabled={createOrUpdate.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={formData.confirm_password}
                    onChange={(e) => setFormData((p) => ({ ...p, confirm_password: e.target.value }))}
                    placeholder="Confirm password"
                    disabled={createOrUpdate.isPending}
                  />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">
                  Use at least eight characters, including an uppercase letter, a number, and a special character.
                </p>
                {passwordMismatch ? (
                  <p className="col-span-2 text-xs text-destructive">Password and confirm password must match.</p>
                ) : null}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                {isRolesLoading ? (
                  <div className="flex items-center gap-2 p-2 border rounded-md">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Loading roles...</span>
                  </div>
                ) : !operatorRole ? (
                  <div className="p-2 border rounded-md text-sm text-muted-foreground">
                    Operator role is not available
                  </div>
                ) : (
                  <Input id="role" value="Operator" disabled />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Primary department</Label>
                {!canPickDepartment ? (
                  <Input id="department" value={currentUser?.department_id ? "Assigned to your department" : "No department assigned"} disabled />
                ) : isDepartmentsLoading ? (
                  <div className="flex items-center gap-2 p-2 border rounded-md">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Loading departments...</span>
                  </div>
                ) : departments.length === 0 ? (
                  <div className="p-2 border rounded-md text-sm text-muted-foreground">
                    No departments available
                  </div>
                ) : (
                  <Select
                    value={formData.department_id || "none"}
                    onValueChange={(val) => setFormData((p) => {
                      const previousPrimary = p.department_id;
                      const additional = p.additional_department_ids.filter((id) => id !== val);
                      if (selectedUser && previousPrimary && val !== "none" && previousPrimary !== val) {
                        additional.push(previousPrimary);
                      }
                      return {
                        ...p,
                        department_id: val === "none" ? "" : val,
                        additional_department_ids: val === "none" ? [] : Array.from(new Set(additional)),
                      };
                    })}
                    disabled={createOrUpdate.isPending}
                  >
                    <SelectTrigger id="department">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {departments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            {canPickDepartment ? (
              <AdditionalDepartmentsPicker
                departments={departments}
                primaryDepartmentId={formData.department_id}
                value={formData.additional_department_ids}
                onChange={(ids) => setFormData((prev) => ({ ...prev, additional_department_ids: ids }))}
                disabled={createOrUpdate.isPending || isDepartmentsLoading}
              />
            ) : null}
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={createOrUpdate.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => createOrUpdate.mutate()}
              disabled={
                createOrUpdate.isPending ||
                !formData.email.trim() ||
                (!selectedUser && (!formData.password.trim() || !formData.confirm_password.trim() || passwordMismatch)) ||
                !formData.role_id ||
                !(selectedUser ? canUpdate : canCreate)
              }
            >
              {createOrUpdate.isPending ? "Saving..." : selectedUser ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={isDeleteConfirmOpen}
        title="Delete operator?"
        description={`Delete ${pendingActionUser?.email ?? "the operator"}? Sign-in and active sessions will stop immediately. Existing content and schedule history will be kept under its current department ownership and will show a deleted creator. This cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => {
          setPendingActionUser(null);
          setIsDeleteConfirmOpen(false);
        }}
        onConfirm={() => {
          if (pendingActionUser) deleteUser.mutate(pendingActionUser.id);
        }}
        isLoading={deleteUser.isPending}
      />
      <Dialog open={Boolean(temporaryPassword)} onOpenChange={(open) => { if (!open) setTemporaryPassword(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Temporary password</DialogTitle><p className="text-sm text-muted-foreground">Copy this password now and give it to the operator through your approved channel. It will not be shown again. Their previous sessions were ended.</p></DialogHeader>
          <div className="space-y-3"><code className="block break-all rounded-md border bg-muted/40 p-3 text-sm" aria-label="Temporary password">{temporaryPassword}</code><Button variant="outline" onClick={async () => { try { if (temporaryPassword) { await navigator.clipboard.writeText(temporaryPassword); toast({ title: "Password copied" }); } } catch { toast({ title: "Copy failed", description: "Select and copy the password manually.", variant: "destructive" }); } }}><Copy aria-hidden="true" className="mr-2 h-4 w-4" />Copy password</Button></div>
          <DialogFooter><Button onClick={() => setTemporaryPassword(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={isResetConfirmOpen}
        title="Reset password?"
        description={`A temporary password will be generated for ${pendingActionUser?.email ?? "this operator"}.`}
        confirmLabel="Reset"
        onCancel={() => {
          setPendingActionUser(null);
          setIsResetConfirmOpen(false);
        }}
        onConfirm={() => {
          if (pendingActionUser) resetPassword.mutate(pendingActionUser.id);
        }}
        isLoading={resetPassword.isPending}
      />

      <ConfirmDialog
        open={isActivateConfirmOpen}
        title="Activate operator?"
        description={`Reactivate access for ${pendingActionUser?.email ?? "this operator"}.`}
        confirmLabel="Activate"
        onCancel={() => {
          setPendingActionUser(null);
          setIsActivateConfirmOpen(false);
        }}
        onConfirm={() => {
          if (pendingActionUser) activateUser.mutate(pendingActionUser.id);
        }}
        isLoading={activateUser.isPending}
      />
    </div>
  );
}
