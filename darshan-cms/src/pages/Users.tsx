import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Mail, Clock, UserPlus } from "lucide-react";
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
import { UserCard } from "@/components/users/UserCard";
import { DeleteUserDialog } from "@/components/users/DeleteUserDialog";
import { mapUsersErrorToUx } from "@/lib/usersErrors";
import { PageNavigation } from "@/components/common/PageNavigation";
import { useAppSelector } from "@/store/hooks";
import { canManageUserTarget } from "@/lib/access";

const PAGE_SIZE = 9;

export default function Users() {
    const currentUser = useAppSelector((state) => state.auth.user);
    const canManageUsers = currentUser?.role === "SUPER_ADMIN" || currentUser?.role === "ADMIN" || currentUser?.role === "DEPARTMENT";
    const [searchQuery, setSearchQuery] = useState("");
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isInviteOpen, setIsInviteOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [deletingUser, setDeletingUser] = useState<User | null>(null);
    const [activeTab, setActiveTab] = useState("users");
    const [usersPage, setUsersPage] = useState(1);
    const [invitationsPage, setInvitationsPage] = useState(1);

    const { listUsers, createUser, updateUser, deleteUser, listInvitations, inviteUser } = useUsersApi({
        usersPage,
        usersLimit: PAGE_SIZE,
        invitationsPage,
        invitationsLimit: PAGE_SIZE,
        enableInvitations: canManageUsers,
    });
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
                canManageTarget: canManageUserTarget(currentUser, user.role, user.department_id),
            })),
        [currentUser, filteredUsers],
    );

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
            }
        );
    };

    const handleInviteUser = (formData: InviteFormData) => {
        inviteUser.mutate(
            {
                email: formData.email,
                role_id: formData.role_id,
                department_id: formData.department_id || undefined,
            },
            {
                onSuccess: () => {
                    setIsInviteOpen(false);
                },
            }
        );
    };

    const handleUpdateUser = (formData: UserFormData) => {
        if (!editingUser) return;

        updateUser.mutate(
            {
                userId: editingUser.id,
                payload: {
                    first_name: formData.first_name,
                    last_name: formData.last_name,
                    role_id: formData.role_id,
                    department_id: formData.department_id || undefined,
                    is_active: formData.is_active,
                },
            },
            {
                onSuccess: () => {
                    setEditingUser(null);
                },
            }
        );
    };

    const handleDeleteUser = () => {
        if (!deletingUser) return;

        deleteUser.mutate(deletingUser.id, {
            onSuccess: () => {
                setDeletingUser(null);
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
                {canManageUsers ? (
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
                                Send Invitation
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
                            Pending Invitations ({invitations.length})
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
                                {visibleUsers.map(({ user, canManageTarget }) => (
                                    <UserCard
                                        key={user.id}
                                        user={user}
                                        onEdit={() => setEditingUser(user)}
                                        onDelete={() => setDeletingUser(user)}
                                        canEdit={canManageTarget}
                                        canDelete={canManageTarget}
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
                            <p className="text-muted-foreground">No pending invitations</p>
                            <Button variant="outline" className="mt-4" onClick={() => setIsInviteOpen(true)}>
                                <Mail className="mr-2 h-4 w-4" />
                                Send First Invitation
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {filteredInvitations.map((invitation) => (
                                    <InvitationCard
                                        key={invitation.id}
                                        invitation={invitation}
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
            <Dialog open={canManageUsers && isCreateOpen} onOpenChange={setIsCreateOpen}>
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
            <Dialog open={canManageUsers && isInviteOpen} onOpenChange={setIsInviteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Invite User</DialogTitle>
                        <DialogDescription>
                            Send an invitation email to a new user. They will receive a link to set up their account.
                        </DialogDescription>
                    </DialogHeader>
                    <InviteUserForm
                        onSubmit={handleInviteUser}
                        onCancel={() => setIsInviteOpen(false)}
                        isLoading={inviteUser.isPending}
                    />
                </DialogContent>
            </Dialog>

            {/* Edit User Dialog */}
            <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
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
                user={deletingUser}
                open={!!deletingUser}
                onOpenChange={(open) => !open && setDeletingUser(null)}
                onConfirm={handleDeleteUser}
            />
        </div>
    );
}
