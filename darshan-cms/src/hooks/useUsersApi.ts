import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usersApi, type UpdateUserPayload } from "@/api/domains/users";
import { ApiError } from "@/api/apiClient";
import type { RoleId } from "@/api/types";
import { mapUsersErrorToUx } from "@/lib/usersErrors";

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
    const { toast } = useToast();

    /* ============================
       Queries
    ============================ */

    const listUsers = useQuery({
        queryKey: ["users", usersPage, usersLimit],
        queryFn: () => usersApi.list({ page: usersPage, limit: usersLimit }),
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 0, // always refetch when invalidated
        placeholderData: (previousData) => previousData,
    });

    const listInvitations = useQuery({
        queryKey: ["invitations", invitationsPage, invitationsLimit],
        queryFn: () =>
            usersApi.listInvitations({
                status: "pending",
                page: invitationsPage,
                limit: invitationsLimit,
            }),
        enabled: enableInvitations,
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 0,
        placeholderData: (previousData) => previousData,
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
            await queryClient.invalidateQueries({ queryKey: ["users"] });

            toast({
                title: "User created",
                description: "The user has been successfully created.",
            });
        },
        onError: (error: Error | ApiError) => {
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
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["invitations"] });

            toast({
                title: "Invitation sent",
                description: "The user has been invited successfully.",
            });
        },
        onError: (error: Error | ApiError) => {
            const ux = mapUsersErrorToUx(error, "Failed to send invitation");
            toast({
                title: ux.title,
                description: ux.message,
                variant: "destructive",
            });
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
            await queryClient.invalidateQueries({ queryKey: ["users"] });

            toast({
                title: "User updated",
                description: "The user has been successfully updated.",
            });
        },
        onError: (error: Error | ApiError) => {
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
            await queryClient.invalidateQueries({ queryKey: ["users"] });

            toast({
                title: "User deleted",
                description: "The user has been successfully deleted.",
                variant: "destructive",
            });
        },
        onError: (error: Error | ApiError) => {
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
        updateUser,
        deleteUser,
    };
};
