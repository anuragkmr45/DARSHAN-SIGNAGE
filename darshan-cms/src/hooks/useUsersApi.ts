import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usersApi, type UpdateUserPayload } from "@/api/domains/users";
import { ApiError } from "@/api/apiClient";
import type { RoleId } from "@/api/types";
import { mapUsersErrorToUx } from "@/lib/usersErrors";
import { refreshUserManagementQueries, shouldRefreshAfterUserManagementError } from "@/lib/userManagementRefresh";
import { queryKeys } from "@/api/queryKeys";
import { useAppSelector } from "@/store/hooks";

type UseUsersApiOptions = {
    usersPage?: number;
    usersLimit?: number;
    invitationsPage?: number;
    invitationsLimit?: number;
    enableInvitations?: boolean;
};

export const useUsersApi = ({
    usersPage = 1,
    usersLimit = 100,
    invitationsPage = 1,
    invitationsLimit = 100,
    enableInvitations = true,
}: UseUsersApiOptions = {}) => {
    const queryClient = useQueryClient();
    const currentUserId = useAppSelector((state) => state.auth.user?.id);
    const { toast } = useToast();
    const refreshOnDenial = (error: unknown) => {
        if (shouldRefreshAfterUserManagementError(error)) {
            void refreshUserManagementQueries(queryClient);
        }
    };

    /* ============================
       Queries
    ============================ */

    const listUsers = useQuery({
        queryKey: queryKeys.usersList(currentUserId, usersPage, usersLimit),
        queryFn: () => usersApi.list({ page: usersPage, limit: usersLimit }),
        retry: false,
        refetchOnWindowFocus: true,
        staleTime: 0, // always refetch when invalidated
    });

    const listInvitations = useQuery({
        queryKey: queryKeys.invitationsList(currentUserId, invitationsPage, invitationsLimit),
        queryFn: () =>
            usersApi.listInvitations({
                status: "pending,expired",
                page: invitationsPage,
                limit: invitationsLimit,
            }),
        enabled: enableInvitations,
        retry: false,
        refetchOnWindowFocus: true,
        staleTime: 0,
    });

    /* ============================
       Mutations
    ============================ */

    const createUser = useMutation({
        mutationFn: (payload: {
            email: string;
            password: string;
            first_name: string;
            last_name: string;
            role_id: RoleId;
            department_id?: string;
        }) => usersApi.create(payload),
        retry: false,
        onSuccess: async () => {
            await refreshUserManagementQueries(queryClient);

            toast({
                title: "User created",
                description: "The user has been successfully created.",
            });
        },
        onError: (error: Error | ApiError) => {
            refreshOnDenial(error);
            const ux = mapUsersErrorToUx(error, "Failed to create user");
            toast({
                title: ux.title,
                description: ux.message,
                variant: "destructive",
            });
        },
    });

    const inviteUser = useMutation({
        mutationFn: (payload: {
            email: string;
            role_id: RoleId;
            department_id?: string;
        }) => usersApi.invite(payload),
        retry: false,
        onSuccess: () => {
            // Do not delay delivery of the one-time activation token on list refetches.
            void refreshUserManagementQueries(queryClient);

            toast({
                title: "Invitation link created",
                description: "Copy the link and share it securely with the invitee. No email was sent.",
            });
        },
        onError: (error: Error | ApiError) => {
            refreshOnDenial(error);
            const ux = mapUsersErrorToUx(error, "Failed to create invitation link");
            toast({
                title: ux.title,
                description: ux.message,
                variant: "destructive",
            });
        },
    });

    const replaceInvite = useMutation({
        mutationFn: ({ inviteId, expectedUpdatedAt }: { inviteId: string; expectedUpdatedAt: string }) =>
            usersApi.replaceInvite(inviteId, expectedUpdatedAt),
        retry: false,
        onSuccess: () => {
            // The replacement token must appear before any list refresh completes.
            void refreshUserManagementQueries(queryClient);
            toast({
                title: "Replacement link created",
                description: "The old link is invalid. Copy and share the new link securely; no email was sent.",
            });
        },
        onError: (error: Error | ApiError) => {
            refreshOnDenial(error);
            const ux = mapUsersErrorToUx(error, "Failed to replace invitation link");
            toast({ title: ux.title, description: ux.message, variant: "destructive" });
        },
    });

    const updateUser = useMutation({
        mutationFn: ({
            userId,
            payload,
        }: {
            userId: string;
            payload: UpdateUserPayload;
        }) => usersApi.update(userId, payload),
        retry: false,
        onSuccess: async () => {
            await refreshUserManagementQueries(queryClient);

            toast({
                title: "User updated",
                description: "The user has been successfully updated.",
            });
        },
        onError: (error: Error | ApiError) => {
            refreshOnDenial(error);
            const ux = mapUsersErrorToUx(error, "Failed to update user");
            toast({
                title: ux.title,
                description: ux.message,
                variant: "destructive",
            });
        },
    });

    const deleteUser = useMutation({
        mutationFn: (userId: string) => usersApi.remove(userId),
        retry: false,
        onSuccess: async () => {
            await refreshUserManagementQueries(queryClient);

            toast({
                title: "User deleted",
                description: "The user has been successfully deleted.",
                variant: "destructive",
            });
        },
        onError: (error: Error | ApiError) => {
            refreshOnDenial(error);
            const ux = mapUsersErrorToUx(error, "Failed to delete user");
            toast({
                title: ux.title,
                description: ux.message,
                variant: "destructive",
            });
        },
    });

    return {
        listUsers,
        listInvitations,
        createUser,
        inviteUser,
        replaceInvite,
        updateUser,
        deleteUser,
    };
};
