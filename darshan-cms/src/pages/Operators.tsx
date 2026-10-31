import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Shield, User, MoreVertical, Edit, Trash2, RefreshCw, CheckCircle, Plus, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { departmentUpdateValue, usersApi } from "@/api/domains/users";
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
import { getRoleBadgeClass } from "@/lib/roleBadges";
import { PageNavigation } from "@/components/common/PageNavigation";
import { useAppSelector } from "@/store/hooks";
import { useAuthorization } from "@/hooks/useAuthorization";
import { refreshUserManagementQueries, shouldRefreshAfterUserManagementError } from "@/lib/userManagementRefresh";
import {
  canSubmitUserMutation,
  isManagementDepartmentSelectionValid,
} from "@/lib/userProposalAuthorization";

const PAGE_SIZE = 9;

export default function Operators() {
  const currentUser = useAppSelector((state) => state.auth.user);
  const { can, canRecord, isLoading: isAuthorizationLoading } = useAuthorization();
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
    password: "",
    confirm_password: "",
  });
  const [pendingActionUser, setPendingActionUser] = useState<ApiUser | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isActivateConfirmOpen, setIsActivateConfirmOpen] = useState(false);
  const operatorsQueryKey = queryKeys.operatorDirectory(currentUser?.id, page, PAGE_SIZE);

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: operatorsQueryKey,
    queryFn: () => usersApi.list({ page, limit: PAGE_SIZE, role: "OPERATOR" }),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const canCreateOperators = !isAuthorizationLoading && can("create", "User");
  const canUpdateOperators = !isAuthorizationLoading && can("update", "User");
  const canDeleteOperators = !isAuthorizationLoading && can("delete", "User");
  const optionsQuery = useQuery({
    queryKey: queryKeys.userManagementOptions(currentUser?.id),
    queryFn: usersApi.managementOptions,
    enabled: Boolean(currentUser) && (canCreateOperators || canUpdateOperators),
  });
  const operatorRole = useMemo(() => optionsQuery.data?.roles.find((role) => role.name === "OPERATOR") ?? null, [optionsQuery.data?.roles]);
  const canPickDepartment = optionsQuery.data?.is_global_user_manager === true;
  const isRolesLoading = optionsQuery.isLoading;
  const isDepartmentsLoading = optionsQuery.isLoading;
  const departments = useMemo(() => optionsQuery.data?.departments ?? [], [optionsQuery.data?.departments]);
  const departmentMap = useMemo(() => new Map(departments.map((department) => [department.id, department.name])), [departments]);
  const departmentSelectionValid = isManagementDepartmentSelectionValid(
    canPickDepartment,
    formData.department_id,
    departments,
  );
  const passwordMismatch = !selectedUser && Boolean(formData.confirm_password) && formData.password !== formData.confirm_password;
  const proposedOperator = selectedUser
    ? {
        ...selectedUser,
        first_name: formData.first_name.trim() || undefined,
        last_name: formData.last_name.trim() || undefined,
        role_id: formData.role_id,
        department_id: departmentUpdateValue(formData.department_id),
      }
    : {
        email: formData.email.trim(),
        first_name: formData.first_name.trim() || undefined,
        last_name: formData.last_name.trim() || undefined,
        role_id: formData.role_id,
        department_id: formData.department_id.trim() || undefined,
        is_active: true,
      };
  const proposalAllowed = !isAuthorizationLoading &&
    (!selectedUser || selectedUser.permissions?.can_update === true) &&
    canSubmitUserMutation(canRecord, selectedUser ? "update" : "create", selectedUser, proposedOperator);
  const handleRejectedMutation = (error: unknown) => {
    if (shouldRefreshAfterUserManagementError(error)) void refreshUserManagementQueries(queryClient);
    if (error instanceof ApiError && [403, 404].includes(error.status)) {
      setIsFormOpen(false);
      setSelectedUser(null);
      setPendingActionUser(null);
      setIsDeleteConfirmOpen(false);
      setIsResetConfirmOpen(false);
      setIsActivateConfirmOpen(false);
    }
  };

  useEffect(() => {
    if (isError) {
      const message = error instanceof ApiError ? error.message : "Unable to load operators.";
      toast({ title: "Load failed", description: message, variant: "destructive" });
    }
  }, [isError, error, toast]);

  const users = useMemo(() => data?.items ?? [], [data]);
  const currentSelectedUser = selectedUser && users.find((user) => user.id === selectedUser.id);
  const currentPendingUser = pendingActionUser && users.find((user) => user.id === pendingActionUser.id);
  const selectedUserIsCurrent = Boolean(selectedUser && currentSelectedUser && currentSelectedUser.updated_at === selectedUser.updated_at);

  useEffect(() => {
    setIsFormOpen(false);
    setSelectedUser(null);
    setPendingActionUser(null);
    setIsDeleteConfirmOpen(false);
    setIsResetConfirmOpen(false);
    setIsActivateConfirmOpen(false);
  }, [currentUser?.id]);

  useEffect(() => {
    if (isFormOpen && (selectedUser
      ? !canUpdateOperators || (data && currentSelectedUser?.permissions?.can_update !== true)
      : !canCreateOperators)) {
      setIsFormOpen(false);
      setSelectedUser(null);
    } else if (isFormOpen && selectedUser && currentSelectedUser && currentSelectedUser.updated_at !== selectedUser.updated_at) {
      setIsFormOpen(false);
      setSelectedUser(null);
    }
    if (!pendingActionUser) return;
    if (isDeleteConfirmOpen && (!canDeleteOperators || (data && currentPendingUser?.permissions?.can_delete !== true))) {
      setIsDeleteConfirmOpen(false);
      setPendingActionUser(null);
    } else if (isResetConfirmOpen && (!canUpdateOperators || (data && currentPendingUser?.permissions?.can_reset_password !== true))) {
      setIsResetConfirmOpen(false);
      setPendingActionUser(null);
    } else if (isActivateConfirmOpen && (!canUpdateOperators || (data && currentPendingUser?.permissions?.can_update !== true))) {
      setIsActivateConfirmOpen(false);
      setPendingActionUser(null);
    }
  }, [canCreateOperators, canDeleteOperators, canUpdateOperators, currentPendingUser, currentSelectedUser,
    data, isActivateConfirmOpen, isDeleteConfirmOpen, isFormOpen, isResetConfirmOpen, pendingActionUser, selectedUser]);

  const filtered = useMemo(
    () =>
      users.filter((user) => {
        const q = searchQuery.toLowerCase();
        return (
          q === "" ||
          user.email.toLowerCase().includes(q) ||
          (user.first_name || "").toLowerCase().includes(q) ||
          (user.last_name || "").toLowerCase().includes(q)
        );
      }),
    [users, searchQuery]
  );
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (selectedUser) {
      setFormData({
        email: selectedUser.email,
        first_name: selectedUser.first_name ?? "",
        last_name: selectedUser.last_name ?? "",
        role_id: operatorRole?.id ?? selectedUser.role_id,
        department_id:
          !canPickDepartment ? currentUser?.department_id ?? "" : selectedUser.department_id ?? "",
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
      if (selectedUser
        ? !canUpdateOperators || !selectedUserIsCurrent || currentSelectedUser?.permissions?.can_update !== true ||
          !proposalAllowed || !departmentSelectionValid
        : !canCreateOperators || !proposalAllowed || !departmentSelectionValid) {
        throw new ApiError({ status: 403, message: "Account permissions changed. Refresh and try again." });
      }
      if (!selectedUser && formData.password !== formData.confirm_password) {
        throw new Error("Password and confirm password must match.");
      }

      if (selectedUser) {
        // Update existing user
        const payload = {
          first_name: formData.first_name.trim() || undefined,
          last_name: formData.last_name.trim() || undefined,
          role_id: formData.role_id,
          department_id: departmentUpdateValue(formData.department_id),
        };
        return usersApi.update(currentSelectedUser!.id, payload);
      }

      // Create new user with password
      const payload = {
        email: formData.email.trim(),
        first_name: formData.first_name.trim() || undefined,
        last_name: formData.last_name.trim() || undefined,
        role_id: formData.role_id,
        department_id: formData.department_id.trim() || undefined,
        password: formData.password,
      };
      return usersApi.create(payload);
    },
    onSuccess: () => {
      void refreshUserManagementQueries(queryClient);
      setIsFormOpen(false);
      setSelectedUser(null);
    },
    onError: handleRejectedMutation,
  }, "Unable to save operator.");

  const deleteUser = useSafeMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      void refreshUserManagementQueries(queryClient);
      setPendingActionUser(null);
      setIsDeleteConfirmOpen(false);
    },
    onError: handleRejectedMutation,
  }, "Unable to delete operator.");

  const resetPassword = useSafeMutation({
    mutationFn: (id: string) => usersApi.resetPassword(id),
    onSuccess: (data) => {
      void refreshUserManagementQueries(queryClient);
      setPendingActionUser(null);
      setIsResetConfirmOpen(false);
      toast({
        title: "Password reset",
        description: `Temporary password: ${data.temp_password}`,
        duration: 10000,
      });
    },
    onError: handleRejectedMutation,
  }, "Unable to reset password.");

  const activateUser = useSafeMutation({
    mutationFn: (id: string) => usersApi.update(id, { is_active: true } as Partial<ApiUser>),
    onSuccess: () => {
      void refreshUserManagementQueries(queryClient);
      setPendingActionUser(null);
      setIsActivateConfirmOpen(false);
    },
    onError: handleRejectedMutation,
  }, "Unable to activate operator.");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operators"
        description="Manage system operators and their permissions."
        actionLabel={canCreateOperators ? "Add Operator" : undefined}
        actionIcon={canCreateOperators ? <Plus className="h-4 w-4" /> : undefined}
        onAction={
          canCreateOperators && operatorRole
            ? () => {
                setSelectedUser(null);
                setIsFormOpen(true);
              }
            : undefined
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-md">
          <SearchBar placeholder="Search operators..." onSearch={setSearchQuery} initialValue={searchQuery} />
        </div>
        <div className="text-sm text-muted-foreground">
          {isFetching ? "Refreshing..." : `${data?.total ?? filtered.length} operators`}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-md border p-6">
          <LoadingIndicator label="Loading operators..." />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No operators found" description="Try adjusting your search or add a new operator." />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((operator: ApiUser) => (
              <Card key={operator.id} className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-start justify-between p-5 pb-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="p-2 rounded-full bg-primary/10">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="break-words font-semibold">
                      {operator.first_name || operator.last_name
                        ? `${operator.first_name ?? ""} ${operator.last_name ?? ""}`.trim()
                        : operator.email}
                    </div>
                    <div className="break-all text-xs text-muted-foreground">{operator.id}</div>
                  </div>
                </div>
                {(operator.permissions?.can_update || operator.permissions?.can_delete || operator.permissions?.can_reset_password) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${operator.email}`}>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {operator.permissions?.can_update && <DropdownMenuItem
                      onClick={() => {
                        setSelectedUser(operator);
                        setIsFormOpen(true);
                      }}
                      className="gap-2"
                    >
                      <Edit className="h-4 w-4" />
                      Edit
                    </DropdownMenuItem>}
                    {!operator.is_active && operator.permissions?.can_update && (
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
                    {operator.permissions?.can_reset_password && <DropdownMenuItem
                      onClick={() => {
                        setPendingActionUser(operator);
                        setIsResetConfirmOpen(true);
                      }}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reset Password
                    </DropdownMenuItem>}
                    {operator.permissions?.can_delete && <DropdownMenuItem
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
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge className={getRoleBadgeClass(operator.role)}>
                    <Shield className="h-3 w-3 mr-1" />
                    {operator.role}
                  </Badge>
                  {!operator.is_active && (
                    <Badge variant="outline" className="text-xs text-destructive border-destructive/40">
                      Inactive
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span className="truncate">{operator.email}</span>
                </div>
                {operator.department_id && (
                  <Badge variant="outline" className="text-xs">
                    Department: {departmentMap.get(operator.department_id) ?? operator.department_id}
                  </Badge>
                )}
              </CardContent>
              </Card>
            ))}
          </div>
          <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
      <Dialog open={isFormOpen && (selectedUser ? canUpdateOperators && selectedUserIsCurrent && currentSelectedUser?.permissions?.can_update === true : canCreateOperators)} onOpenChange={setIsFormOpen}>
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
                disabled={createOrUpdate.isPending || Boolean(selectedUser)}
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
                  Set an initial password for the new operator with atleast 8 characters with special character, number, and uppercase letter.
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
                <Label htmlFor="department">Department</Label>
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
                    onValueChange={(val) => setFormData((p) => ({ ...p, department_id: val === "none" ? "" : val }))}
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
            {optionsQuery.data && !departmentSelectionValid ? (
              <p role="alert" className="text-sm text-destructive">
                {formData.department_id
                  ? "The selected department is no longer available for this operator action."
                  : "No permitted department is available for this operator action."}
              </p>
            ) : null}
            {formData.email.trim() && formData.role_id && !isAuthorizationLoading && !proposalAllowed ? (
              <p role="alert" className="text-sm text-destructive">
                These operator details are outside your current permission scope.
              </p>
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
                !proposalAllowed ||
                !departmentSelectionValid ||
                !(selectedUser ? canUpdateOperators && selectedUserIsCurrent && currentSelectedUser?.permissions?.can_update : canCreateOperators) ||
                !operatorRole
              }
            >
              {createOrUpdate.isPending ? "Saving..." : selectedUser ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={isDeleteConfirmOpen && canDeleteOperators && currentPendingUser?.permissions?.can_delete === true}
        title="Delete operator?"
        description={`Delete ${currentPendingUser?.email ?? "the operator"}? Sign-in and active sessions will stop immediately. Existing content and schedule history will be kept under its current department ownership and will show a deleted creator. This cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => {
          setPendingActionUser(null);
          setIsDeleteConfirmOpen(false);
        }}
        onConfirm={() => {
          if (canDeleteOperators && currentPendingUser?.permissions?.can_delete) deleteUser.mutate(currentPendingUser.id);
        }}
        isLoading={deleteUser.isPending}
      />

      <ConfirmDialog
        open={isResetConfirmOpen && canUpdateOperators && currentPendingUser?.permissions?.can_reset_password === true}
        title="Reset password?"
        description={`A temporary password will be generated for ${currentPendingUser?.email ?? "this operator"}.`}
        confirmLabel="Reset"
        onCancel={() => {
          setPendingActionUser(null);
          setIsResetConfirmOpen(false);
        }}
        onConfirm={() => {
          if (canUpdateOperators && currentPendingUser?.permissions?.can_reset_password) resetPassword.mutate(currentPendingUser.id);
        }}
        isLoading={resetPassword.isPending}
      />

      <ConfirmDialog
        open={isActivateConfirmOpen && canUpdateOperators && currentPendingUser?.permissions?.can_update === true}
        title="Activate operator?"
        description={`Reactivate access for ${currentPendingUser?.email ?? "this operator"}.`}
        confirmLabel="Activate"
        onCancel={() => {
          setPendingActionUser(null);
          setIsActivateConfirmOpen(false);
        }}
        onConfirm={() => {
          if (canUpdateOperators && currentPendingUser?.permissions?.can_update) activateUser.mutate(currentPendingUser.id);
        }}
        isLoading={activateUser.isPending}
      />
    </div>
  );
}
