import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Mail, Clock, UserPlus, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { UserForm } from "@/components/users/UserForm";
import { InviteUserForm } from "@/components/users/InviteUserForm";
import { InvitationCard } from "@/components/users/InvitationCard";
import type { User } from "@/api/types";
import type { UserFormData, InviteFormData } from "@/types/user";
import { useUsersApi } from "@/hooks/useUsersApi";
import { ApiError } from "@/api/apiClient";
import { departmentUpdateValue } from "@/api/domains/users";
import { UserCard } from "@/components/users/UserCard";
import { DeleteUserDialog } from "@/components/users/DeleteUserDialog";
import { mapUsersErrorToUx } from "@/lib/usersErrors";
import { PageNavigation } from "@/components/common/PageNavigation";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useAppSelector } from "@/store/hooks";
import { invitationActivationLink } from "@/lib/invitationLink";

const PAGE_SIZE = 9;

export default function Users() {
    const currentUserId = useAppSelector((state) => state.auth.user?.id);
    const currentUserIdRef = useRef(currentUserId);
    currentUserIdRef.current = currentUserId;
    const { can, isLoading: isAuthorizationLoading } = useAuthorization();
    const canCreateUsers = !isAuthorizationLoading && can("create", "User");
    const canCreateUsersRef = useRef(canCreateUsers);
    canCreateUsersRef.current = canCreateUsers;
    const canUpdateUsers = !isAuthorizationLoading && can("update", "User");
    const canDeleteUsers = !isAuthorizationLoading && can("delete", "User");
    const canManageUsers = !isAuthorizationLoading && (canCreateUsers || can("update", "User") || can("delete", "User"));
    const [searchQuery, setSearchQuery] = useState("");
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isInviteOpen, setIsInviteOpen] = useState(false);
    const [activationLink, setActivationLink] = useState<{ url: string; email: string; expiresAt: string; kind: "created" | "replaced"; managerId: string } | null>(null);
    const [replacementTarget, setReplacementTarget] = useState<{ id: string; email: string; updatedAt: string } | null>(null);
    const [copyError, setCopyError] = useState("");
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [deletingUser, setDeletingUser] = useState<User | null>(null);
    const [activeTab, setActiveTab] = useState("users");
    const [usersPage, setUsersPage] = useState(1);
    const [invitationsPage, setInvitationsPage] = useState(1);

    const { listUsers, createUser, updateUser, deleteUser, listInvitations, inviteUser, replaceInvite } = useUsersApi({
        usersPage,
        usersLimit: PAGE_SIZE,
        invitationsPage,
        invitationsLimit: PAGE_SIZE,
        enableInvitations: canManageUsers,
    });
    const resetInviteMutation = inviteUser.reset;
    const resetReplaceMutation = replaceInvite.reset;
    const { data, isLoading, error: usersError } = listUsers;
    const { data: invitationsData, isLoading: isLoadingInvitations, error: invitationsError } = listInvitations;
    const users = useMemo(() => data?.items ?? [], [data?.items]);
    const invitations = useMemo(() => invitationsData?.items ?? [], [invitationsData?.items]);
    const usersErrorMessage = usersError ? mapUsersErrorToUx(usersError, "Failed to load users") : null;
    const invitationsErrorMessage = invitationsError
        ? mapUsersErrorToUx(invitationsError, "Failed to load invitations")
        : null;

    const filteredUsers = useMemo(
        () =>
            users.filter((user) => {
                const query = searchQuery.toLowerCase();
                const { email, first_name, last_name, role } = user;

                return (
                    query === "" ||
                    email.toLowerCase().includes(query) ||
                    (first_name || "").toLowerCase().includes(query) ||
                    (last_name || "").toLowerCase().includes(query) ||
                        (role || "").toLowerCase().includes(query)
                );
            }),
        [users, searchQuery],
    );

    const filteredInvitations = useMemo(
        () =>
            invitations.filter((invitation) => {
                const query = searchQuery.toLowerCase();
                const { email, role } = invitation;

                return (
                    query === "" ||
                    (email || "").toLowerCase().includes(query) ||
                    (role || "").toLowerCase().includes(query)
                );
            }),
        [invitations, searchQuery],
    );
    const visibleUsers = useMemo(
        () =>
            filteredUsers.map((user) => ({
                user,
                canManageTarget: user.permissions?.can_update === true,
                canDeleteTarget: user.permissions?.can_delete === true,
            })),
        [filteredUsers],
    );
    const currentEditingUser = editingUser && data?.items.find((user) => user.id === editingUser.id);
    const currentDeletingUser = deletingUser && data?.items.find((user) => user.id === deletingUser.id);
    const editingUserIsCurrent = Boolean(editingUser && currentEditingUser && currentEditingUser.updated_at === editingUser.updated_at);

    useEffect(() => {
        setIsCreateOpen(false);
        setIsInviteOpen(false);
        setActivationLink(null);
        setReplacementTarget(null);
        setCopyError("");
        resetInviteMutation();
        resetReplaceMutation();
        setEditingUser(null);
        setDeletingUser(null);
    }, [currentUserId, resetInviteMutation, resetReplaceMutation]);

    useEffect(() => {
        if (!canCreateUsers) {
            setIsCreateOpen(false);
            setIsInviteOpen(false);
            setActivationLink(null);
            setReplacementTarget(null);
            resetInviteMutation();
            resetReplaceMutation();
        }
        if (editingUser && (!canUpdateUsers || (data && currentEditingUser?.permissions?.can_update !== true))) {
            setEditingUser(null);
        } else if (editingUser && currentEditingUser && currentEditingUser.updated_at !== editingUser.updated_at) {
            // Another writer changed the account while this form was open. Do not
            // silently reset unsaved fields or submit a stale role/department.
            setEditingUser(null);
        }
        if (deletingUser && (!canDeleteUsers || (data && currentDeletingUser?.permissions?.can_delete !== true))) {
            setDeletingUser(null);
        }
    }, [canCreateUsers, canDeleteUsers, canUpdateUsers, currentDeletingUser, currentEditingUser, data, deletingUser, editingUser, resetInviteMutation, resetReplaceMutation]);

    useEffect(() => {
        if (!canManageUsers && activeTab === "invitations") {
            setActiveTab("users");
        }
    }, [activeTab, canManageUsers]);

    const usersTotalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
    const invitationsTotalPages = Math.max(1, Math.ceil((invitationsData?.total ?? 0) / PAGE_SIZE));

    useEffect(() => {
        setUsersPage(1);
        setInvitationsPage(1);
    }, [searchQuery]);

    useEffect(() => {
        if (usersPage > usersTotalPages) {
            setUsersPage(usersTotalPages);
        }
    }, [usersPage, usersTotalPages]);

    useEffect(() => {
        if (invitationsPage > invitationsTotalPages) {
            setInvitationsPage(invitationsTotalPages);
        }
    }, [invitationsPage, invitationsTotalPages]);

    const handleCreateUser = (formData: UserFormData) => {
        if (!canCreateUsers) return;
        createUser.mutate(
            {
                email: formData.email,
                password: formData.password || "",
                first_name: formData.first_name,
                last_name: formData.last_name,
                role_id: formData.role_id,
                department_id: formData.department_id || undefined,
            },
            {
                onSuccess: () => {
                    setIsCreateOpen(false);
                },
                onError: (error) => {
                    if (error instanceof ApiError && [403, 404].includes(error.status)) setIsCreateOpen(false);
                },
            }
        );
    };

    const handleInviteUser = (formData: InviteFormData) => {
        if (!canCreateUsers) return;
        const invitingUserId = currentUserId;
        inviteUser.mutate(
            {
                email: formData.email,
                role_id: formData.role_id,
                department_id: formData.department_id || undefined,
            },
            {
                onSuccess: (result) => {
                    if (currentUserIdRef.current !== invitingUserId || !canCreateUsersRef.current) {
                        inviteUser.reset();
                        return;
                    }
                    setIsInviteOpen(false);
                    setCopyError("");
                    setActivationLink({
                        url: invitationActivationLink(window.location.origin, result.invite_token),
                        email: result.email,
                        expiresAt: result.invite_expires_at,
                        kind: "created",
                        managerId: invitingUserId ?? "",
                    });
                },
                onError: (error) => {
                    if (error instanceof ApiError && [403, 404].includes(error.status)) setIsInviteOpen(false);
                },
            }
        );
    };

    const handleReplaceInvite = () => {
        if (!canCreateUsers || !replacementTarget || replaceInvite.isPending) return;
        const current = invitations.find((invitation) => invitation.id === replacementTarget.id);
        if (!current || current.can_replace !== true || !current.updated_at || current.updated_at !== replacementTarget.updatedAt) {
            setReplacementTarget(null);
            return;
        }
        const invitingUserId = currentUserId;
        replaceInvite.mutate({ inviteId: current.id, expectedUpdatedAt: replacementTarget.updatedAt }, {
            onSuccess: (result) => {
                setReplacementTarget(null);
                if (currentUserIdRef.current !== invitingUserId || !canCreateUsersRef.current) {
                    replaceInvite.reset();
                    return;
                }
                setCopyError("");
                setActivationLink({
                    url: invitationActivationLink(window.location.origin, result.invite_token),
                    email: result.email,
                    expiresAt: result.invite_expires_at,
                    kind: "replaced",
                    managerId: invitingUserId ?? "",
                });
            },
            onError: (error) => {
                if (error instanceof ApiError && [403, 404, 409].includes(error.status)) setReplacementTarget(null);
            },
        });
    };

    const closeActivationLink = () => {
        setActivationLink(null);
        setCopyError("");
        inviteUser.reset();
        replaceInvite.reset();
    };

    const copyActivationLink = async () => {
        if (!activationLink) return;
        try {
            await navigator.clipboard.writeText(activationLink.url);
            setCopyError("");
        } catch {
            setCopyError("Copy failed. Select the link above and copy it manually.");
        }
    };

    const handleUpdateUser = (formData: UserFormData) => {
        if (!canUpdateUsers || !editingUserIsCurrent || !currentEditingUser || currentEditingUser.permissions?.can_update !== true) return;

        updateUser.mutate(
            {
                userId: currentEditingUser.id,
                payload: {
                    first_name: formData.first_name,
                    last_name: formData.last_name,
                    role_id: formData.role_id,
                    department_id: departmentUpdateValue(formData.department_id),
                    is_active: formData.is_active,
                },
            },
            {
                onSuccess: () => {
                    setEditingUser(null);
                },
                onError: (error) => {
                    if (error instanceof ApiError && [403, 404].includes(error.status)) setEditingUser(null);
                },
            }
        );
    };

    const handleDeleteUser = () => {
        if (!canDeleteUsers || !currentDeletingUser || currentDeletingUser.permissions?.can_delete !== true) return;

        deleteUser.mutate(currentDeletingUser.id, {
            onSuccess: () => {
                setDeletingUser(null);
            },
            onError: (error) => {
                if (error instanceof ApiError && [403, 404].includes(error.status)) setDeletingUser(null);
            },
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">Users Management</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage user accounts, roles, and permissions
                    </p>
                </div>
                {canCreateUsers ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button>
                                <Plus className="mr-2 h-4 w-4" />
                                Add User
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setIsCreateOpen(true)}>
                                <UserPlus className="mr-2 h-4 w-4" />
                                Create User Directly
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setIsInviteOpen(true)}>
                                <Mail className="mr-2 h-4 w-4" />
                                Create Invitation Link
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="users">
                        Active Users ({users.length})
                    </TabsTrigger>
                    {canManageUsers ? (
                        <TabsTrigger value="invitations">
                            <Mail className="mr-2 h-4 w-4" />
                            Awaiting Activation ({invitations.length})
                        </TabsTrigger>
                    ) : null}
                </TabsList>

                <div className="mt-6 flex items-center gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={activeTab === "users" ? "Search users by name, email, or role..." : "Search invitations by email or role..."}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <div className="text-sm text-muted-foreground">
                        {activeTab === "users" || !canManageUsers
                            ? `${data?.total ?? filteredUsers.length} ${(data?.total ?? filteredUsers.length) === 1 ? "user" : "users"}`
                            : `${invitationsData?.total ?? filteredInvitations.length} ${(invitationsData?.total ?? filteredInvitations.length) === 1 ? "invitation" : "invitations"}`
                        }
                    </div>
                </div>

                <TabsContent value="users" className="mt-6">
                    {usersErrorMessage ? (
                        <Alert variant="destructive">
                            <AlertDescription>
                                {usersErrorMessage.message}
                            </AlertDescription>
                        </Alert>
                    ) : isLoading ? (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {Array.from({ length: 6 }).map((_, idx) => (
                                <Skeleton key={idx} className="h-40" />
                            ))}
                        </div>
                    ) : filteredUsers.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-muted-foreground">No users found</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {visibleUsers.map(({ user, canManageTarget, canDeleteTarget }) => (
                                    <UserCard
                                        key={user.id}
                                        user={user}
                                        onEdit={() => setEditingUser(user)}
                                        onDelete={() => setDeletingUser(user)}
                                        canEdit={canManageTarget}
                                        canDelete={canDeleteTarget}
                                    />
                                ))}
                            </div>
                            <PageNavigation
                                currentPage={usersPage}
                                totalPages={usersTotalPages}
                                onPageChange={setUsersPage}
                            />
                        </div>
                    )}
                </TabsContent>

                {canManageUsers ? (
                <TabsContent value="invitations" className="mt-6">
                    {invitationsErrorMessage ? (
                        <Alert variant="destructive">
                            <AlertDescription>
                                {invitationsErrorMessage.message}
                            </AlertDescription>
                        </Alert>
                    ) : isLoadingInvitations ? (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {Array.from({ length: 3 }).map((_, idx) => (
                                <Skeleton key={idx} className="h-32" />
                            ))}
                        </div>
                    ) : filteredInvitations.length === 0 ? (
                        <div className="text-center py-12">
                            <Clock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                            <p className="text-muted-foreground">No invitations awaiting activation</p>
                            <Button variant="outline" className="mt-4" onClick={() => setIsInviteOpen(true)} disabled={!canCreateUsers}>
                                <Mail className="mr-2 h-4 w-4" />
                                Create First Invitation Link
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {filteredInvitations.map((invitation) => (
                                    <InvitationCard
                                        key={invitation.id}
                                        invitation={invitation}
                                        onReplace={canCreateUsers && invitation.can_replace === true
                                            ? () => invitation.updated_at && setReplacementTarget({
                                                id: invitation.id,
                                                email: invitation.email ?? "this user",
                                                updatedAt: invitation.updated_at,
                                            })
                                            : undefined}
                                        isReplacing={replaceInvite.isPending && replacementTarget?.id === invitation.id}
                                    />
                                ))}
                            </div>
                            <PageNavigation
                                currentPage={invitationsPage}
                                totalPages={invitationsTotalPages}
                                onPageChange={setInvitationsPage}
                            />
                        </div>
                    )}
                </TabsContent>
                ) : null}
            </Tabs>

            {/* Create User Dialog */}
            <Dialog open={canCreateUsers && isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create New User</DialogTitle>
                        <DialogDescription>
                            Add a new user to the system with their role and permissions. The user will be created immediately.
                        </DialogDescription>
                    </DialogHeader>
                    <UserForm
                        onSubmit={handleCreateUser}
                        onCancel={() => setIsCreateOpen(false)}
                        isLoading={createUser.isPending}
                    />
                </DialogContent>
            </Dialog>

            {/* Invite User Dialog */}
            <Dialog open={canCreateUsers && isInviteOpen} onOpenChange={setIsInviteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Invite User</DialogTitle>
                        <DialogDescription>
                            Create a one-time activation link to share securely with the new user. No email is sent automatically.
                        </DialogDescription>
                    </DialogHeader>
                    <InviteUserForm
                        onSubmit={handleInviteUser}
                        onCancel={() => setIsInviteOpen(false)}
                        isLoading={inviteUser.isPending}
                    />
                </DialogContent>
            </Dialog>

            <Dialog open={canCreateUsers && replacementTarget !== null} onOpenChange={(open) => {
                if (!open && !replaceInvite.isPending) setReplacementTarget(null);
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Replace invitation link?</DialogTitle>
                        <DialogDescription>
                            The existing link for {replacementTarget?.email} will stop working immediately. The new link will be shown only once; copy and share it securely.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setReplacementTarget(null)} disabled={replaceInvite.isPending}>Cancel</Button>
                        <Button type="button" onClick={handleReplaceInvite} disabled={replaceInvite.isPending}>
                            {replaceInvite.isPending ? "Replacing..." : "Replace link"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={canCreateUsers && activationLink !== null && activationLink.managerId === currentUserId} onOpenChange={(open) => !open && closeActivationLink()}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{activationLink?.kind === "replaced" ? "Replacement link created" : "Invitation link created"}</DialogTitle>
                        <DialogDescription>
                            Copy and share this link securely with {activationLink?.email}. It is shown only now and cannot be retrieved from the invitation list.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Input aria-label="Activation link" value={activationLink?.url ?? ""} readOnly onFocus={(event) => event.currentTarget.select()} />
                        <Button type="button" onClick={copyActivationLink} disabled={!activationLink}>
                            <Copy className="mr-2 h-4 w-4" /> Copy link
                        </Button>
                        {copyError ? <p role="alert" className="text-sm text-destructive">{copyError}</p> : null}
                        <p className="text-sm text-muted-foreground">
                            Expires {activationLink?.expiresAt ? new Date(activationLink.expiresAt).toLocaleString() : "at the time specified by the server"}. The user must activate before signing in.
                        </p>
                        <Button type="button" variant="outline" onClick={closeActivationLink}>Done</Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Edit User Dialog */}
            <Dialog open={canUpdateUsers && editingUserIsCurrent && currentEditingUser?.permissions?.can_update === true} onOpenChange={(open) => !open && setEditingUser(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit User</DialogTitle>
                        <DialogDescription>
                            Update user information, role, and permissions.
                        </DialogDescription>
                    </DialogHeader>
                    <UserForm
                        user={editingUser}
                        onSubmit={handleUpdateUser}
                        onCancel={() => setEditingUser(null)}
                        isLoading={updateUser.isPending}
                    />
                </DialogContent>
            </Dialog>

            {/* Delete User Dialog */}
            <DeleteUserDialog
                user={currentDeletingUser || null}
                open={canDeleteUsers && currentDeletingUser?.permissions?.can_delete === true}
                onOpenChange={(open) => !open && setDeletingUser(null)}
                onConfirm={handleDeleteUser}
            />
        </div>
    );
}
