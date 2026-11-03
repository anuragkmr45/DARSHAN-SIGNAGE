import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Mail, UserPlus, RefreshCw, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
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
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { usersApi, type UserInvitation } from "@/api/domains/users";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthorization } from "@/hooks/useAuthorization";

const PAGE_SIZE = 9;

export default function Users() {
    const { can } = useAuthorization();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const canCreate = can("create", "User");
    const canUpdate = can("update", "User");
    const canDelete = can("delete", "User");
    const [searchQuery, setSearchQuery] = useState("");
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isInviteOpen, setIsInviteOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [deletingUser, setDeletingUser] = useState<User | null>(null);
    const [reissueTarget, setReissueTarget] = useState<UserInvitation | null>(null);
    const [invitationHandoff, setInvitationHandoff] = useState<{ email: string; code: string; expires?: string } | null>(null);
    const [activeTab, setActiveTab] = useState("users");
    const [usersPage, setUsersPage] = useState(1);
    const [invitationsPage, setInvitationsPage] = useState(1);

    const { listUsers, createUser, updateUser, deleteUser, listInvitations, inviteUser } = useUsersApi({
        usersPage,
        usersLimit: PAGE_SIZE,
        usersSearch: activeTab === "users" ? searchQuery : "",
        invitationsPage,
        invitationsLimit: PAGE_SIZE,
        invitationsSearch: activeTab === "invitations" ? searchQuery : "",
        enableInvitations: activeTab === "invitations",
    });
    const { data, isLoading, isFetching: isFetchingUsers, isPlaceholderData: usersPlaceholder, error: usersError, refetch: refetchUsers } = listUsers;
    const { data: invitationsData, isLoading: isLoadingInvitations, isFetching: isFetchingInvitations, isPlaceholderData: invitationsPlaceholder, error: invitationsError, refetch: refetchInvitations } = listInvitations;
    const users = useMemo(() => data?.items ?? [], [data?.items]);
    const invitations = useMemo(() => invitationsData?.items ?? [], [invitationsData?.items]);
    const usersErrorMessage = usersError ? mapUsersErrorToUx(usersError, "Failed to load users") : null;
    const invitationsErrorMessage = invitationsError
        ? mapUsersErrorToUx(invitationsError, "Failed to load invitations")
        : null;

    const visibleUsers = useMemo(
        () =>
            users.map((user) => ({
                user,
                canManageTarget: canUpdate,
                canDeleteTarget: canDelete,
            })),
        [canUpdate, canDelete, users],
    );

    const usersTotalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
    const invitationsTotalPages = Math.max(1, Math.ceil((invitationsData?.total ?? 0) / PAGE_SIZE));

    const reissueInvitation = useSafeMutation({
        retry: false,
        mutationFn: usersApi.reissueInvite,
        onSuccess: (result) => {
            setReissueTarget(null);
            setInvitationHandoff({ email: result.email, code: result.invite_token, expires: result.invite_expires_at });
            void queryClient.invalidateQueries({ queryKey: ["invitations"] });
        },
    }, "Could not renew the invitation code.");

    useEffect(() => {
        setUsersPage(1);
        setInvitationsPage(1);
    }, [searchQuery]);

    useEffect(() => {
        if (data && !usersPlaceholder && usersPage > usersTotalPages) {
            setUsersPage(usersTotalPages);
        }
    }, [data, usersPlaceholder, usersPage, usersTotalPages]);

    useEffect(() => {
        if (invitationsData && !invitationsPlaceholder && invitationsPage > invitationsTotalPages) {
            setInvitationsPage(invitationsTotalPages);
        }
    }, [invitationsData, invitationsPlaceholder, invitationsPage, invitationsTotalPages]);

    const handleCreateUser = (formData: UserFormData) => {
        createUser.mutate(
            {
                email: formData.email,
                password: formData.password || "",
                first_name: formData.first_name,
                last_name: formData.last_name,
                role_id: formData.role_id,
                department_id: formData.department_id || undefined,
                additional_department_ids: formData.additional_department_ids,
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
                additional_department_ids: formData.additional_department_ids,
            },
            {
                onSuccess: (result) => {
                    setIsInviteOpen(false);
                    setInvitationHandoff({ email: result.email, code: result.invite_token, expires: result.invite_expires_at });
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
                    additional_department_ids: formData.additional_department_ids,
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
        <div className="mx-auto w-full max-w-6xl space-y-5">
            <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">Users</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Manage accounts, roles and invitations.
                    </p>
                </div>
                {canCreate ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button>
                                <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
                                New User
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setIsCreateOpen(true)}>
                                <UserPlus className="mr-2 h-4 w-4" />
                                Create User Directly
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setIsInviteOpen(true)}>
                                <Mail className="mr-2 h-4 w-4" />
                                Create Invitation
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>

            <Tabs value={activeTab} onValueChange={(tab) => { setActiveTab(tab); setSearchQuery(""); }}>
                <TabsList className="max-w-full justify-start overflow-x-auto">
                    <TabsTrigger value="users">
                        Users ({data?.total ?? 0})
                    </TabsTrigger>
                    <TabsTrigger value="invitations">
                            <Mail className="mr-2 h-4 w-4" />
                            Invitations{invitationsData ? ` (${invitationsData.total})` : ""}
                    </TabsTrigger>
                </TabsList>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative w-full sm:max-w-sm">
                        <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            aria-label={activeTab === "users" ? "Search users" : "Search invitations by email"}
                            placeholder={activeTab === "users" ? "Search users by name, email, or role..." : "Search invitations by email..."}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground" aria-live="polite">{activeTab === "users" ? `${data?.total ?? 0} ${(data?.total ?? 0) === 1 ? "user" : "users"}${isFetchingUsers && !isLoading ? " · Updating" : ""}` : `${invitationsData?.total ?? 0} ${(invitationsData?.total ?? 0) === 1 ? "invitation" : "invitations"}${isFetchingInvitations && !isLoadingInvitations ? " · Updating" : ""}`}</span><Button variant="outline" size="sm" onClick={() => void (activeTab === "users" ? refetchUsers() : refetchInvitations())}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh</Button></div>
                </div>

                <TabsContent value="users" className="mt-5">
                    {isLoading ? <LoadingIndicator label="Loading users…" /> : usersErrorMessage && !data ? (
                        <EmptyState title="Could not load users" description={usersErrorMessage.message} actionLabel="Retry" onAction={() => void refetchUsers()} />
                    ) : users.length === 0 ? (
                        <EmptyState title={searchQuery ? "No matching users" : "No users found"} description={searchQuery ? "Try another search." : "No accounts are available in your scope."} />
                    ) : (
                        <div className="space-y-4">
                            <div className="divide-y border-y">
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
                            {data && data.total > PAGE_SIZE && <PageNavigation
                                currentPage={usersPage}
                                totalPages={usersTotalPages}
                                onPageChange={setUsersPage}
                            />}
                        </div>
                    )}
                    {usersErrorMessage && data && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive">Could not refresh users. Showing the last loaded page. <Button variant="outline" size="sm" onClick={() => void refetchUsers()}>Retry</Button></div>}
                </TabsContent>

                <TabsContent value="invitations" className="mt-5">
                    {isLoadingInvitations ? <LoadingIndicator label="Loading invitations…" /> : invitationsErrorMessage && !invitationsData ? (
                        <EmptyState title="Could not load invitations" description={invitationsErrorMessage.message} actionLabel="Retry" onAction={() => void refetchInvitations()} />
                    ) : invitations.length === 0 ? (
                        <EmptyState title={searchQuery ? "No matching invitations" : "No open invitations"} description={searchQuery ? "Try another email address." : "No pending or expired invitations need attention."} actionLabel={canCreate && !searchQuery ? "Create Invitation" : undefined} onAction={canCreate && !searchQuery ? () => setIsInviteOpen(true) : undefined} />
                    ) : (
                        <div className="space-y-4">
                            <div className="divide-y border-y">
                                {invitations.map((invitation) => (
                                    <InvitationCard
                                        key={invitation.id}
                                        invitation={invitation}
                                        onReissue={canCreate ? setReissueTarget : undefined}
                                    />
                                ))}
                            </div>
                            {invitationsData && invitationsData.total > PAGE_SIZE && <PageNavigation
                                currentPage={invitationsPage}
                                totalPages={invitationsTotalPages}
                                onPageChange={setInvitationsPage}
                            />}
                        </div>
                    )}
                    {invitationsErrorMessage && invitationsData && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive">Could not refresh invitations. Showing the last loaded page. <Button variant="outline" size="sm" onClick={() => void refetchInvitations()}>Retry</Button></div>}
                </TabsContent>
            </Tabs>

            {/* Create User Dialog */}
            <Dialog open={canCreate && isCreateOpen} onOpenChange={setIsCreateOpen}>
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
            <Dialog open={canCreate && isInviteOpen} onOpenChange={setIsInviteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Invitation</DialogTitle>
                        <DialogDescription>
                            Create a code for this person to activate their account. No email is sent by DARSHAN.
                        </DialogDescription>
                    </DialogHeader>
                    <InviteUserForm
                        onSubmit={handleInviteUser}
                        onCancel={() => setIsInviteOpen(false)}
                        isLoading={inviteUser.isPending}
                    />
                </DialogContent>
            </Dialog>

            <ConfirmDialog open={Boolean(reissueTarget)} title="Renew invitation code?" description={`The previous code for ${reissueTarget?.email ?? "this user"} will stop working. Share the replacement code before closing it.`} confirmLabel="Renew Code" onCancel={() => setReissueTarget(null)} onConfirm={() => { if (reissueTarget) reissueInvitation.mutate(reissueTarget.id); }} isLoading={reissueInvitation.isPending} />

            <Dialog open={Boolean(invitationHandoff)} onOpenChange={(open) => { if (!open) setInvitationHandoff(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Invitation code ready</DialogTitle><DialogDescription>Give this code to {invitationHandoff?.email} through your approved channel. It is shown only until you close this window. The recipient enters it at your DARSHAN `/activate` page. No email was sent.</DialogDescription></DialogHeader>
                    <div className="space-y-3"><p className="text-sm text-muted-foreground">Activation page: <code className="break-all">{window.location.origin}/activate</code></p><code className="block break-all rounded-md border bg-muted/40 p-3 text-sm" aria-label="Invitation code">{invitationHandoff?.code}</code>{invitationHandoff?.expires && <p className="text-xs text-muted-foreground">Expires {new Date(invitationHandoff.expires).toLocaleString()}</p>}<Button variant="outline" onClick={async () => { try { if (invitationHandoff) { await navigator.clipboard.writeText(invitationHandoff.code); toast({ title: "Code copied" }); } } catch { toast({ title: "Copy failed", description: "Select and copy the code manually.", variant: "destructive" }); } }}><Copy aria-hidden="true" className="mr-2 h-4 w-4" />Copy code</Button></div>
                    <DialogFooter><Button onClick={() => setInvitationHandoff(null)}>Done</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit User Dialog */}
            <Dialog open={canUpdate && !!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
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
                open={canDelete && !!deletingUser}
                onOpenChange={(open) => !open && setDeletingUser(null)}
                onConfirm={handleDeleteUser}
            />
        </div>
    );
}
