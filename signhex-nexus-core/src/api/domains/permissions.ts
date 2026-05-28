import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { PermissionsMetadata } from "../types";

export const permissionsApi = {
  metadata: () =>
    apiClient.request<PermissionsMetadata>({
      path: endpoints.permissions.metadata,
      method: "GET",
    }),
};
