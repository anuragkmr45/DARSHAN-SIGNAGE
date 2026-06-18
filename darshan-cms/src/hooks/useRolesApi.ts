import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rolesApi } from "@/api/domains/roles";
import { permissionsApi } from "@/api/domains/permissions";
import { queryKeys } from "@/api/queryKeys";
import { useToast } from "@/hooks/use-toast";
import type { RolePayload, RoleListParams } from "@/api/domains/roles";

const DEFAULT_ROLE_LIST: RoleListParams = { page: 1, limit: 100 };

export const useRolesList = (params?: RoleListParams) =>
  useQuery({
    queryKey: queryKeys.roles(params ?? DEFAULT_ROLE_LIST),
    queryFn: () => rolesApi.list(params ?? DEFAULT_ROLE_LIST),
    staleTime: 60_000,
  });

export const useRole = (roleId?: string) =>
  useQuery({
    queryKey: queryKeys.role(roleId),
    queryFn: () => rolesApi.getById(roleId!),
    enabled: Boolean(roleId),
    staleTime: 60_000,
  });

export const usePermissionsMetadata = () =>
  useQuery({
    queryKey: queryKeys.permissionsMetadata,
    queryFn: permissionsApi.metadata,
    staleTime: 300_000,
  });

export const useRolesApi = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createRole = useMutation({
    mutationFn: (payload: RolePayload) => rolesApi.create(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast({ title: "Role created", description: "The role has been created successfully." });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateRole = useMutation({
    mutationFn: ({ roleId, payload }: { roleId: string; payload: RolePayload }) =>
      rolesApi.update(roleId, payload),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.role(variables.roleId) });
      toast({ title: "Role updated", description: "The role has been updated successfully." });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteRole = useMutation({
    mutationFn: (roleId: string) => rolesApi.remove(roleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast({ title: "Role deleted", description: "The role has been deleted." });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return { createRole, updateRole, deleteRole };
};
