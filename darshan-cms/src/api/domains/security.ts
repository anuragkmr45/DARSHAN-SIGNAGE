import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";

type SecurityClientEventBody = {
  event: string;
  context?: Record<string, string | number | boolean | null>;
};

export const securityApi = {
  reportClientEvent: (body: SecurityClientEventBody) =>
    apiClient.request<void, SecurityClientEventBody>({
      path: endpoints.security.clientEvents,
      method: "POST",
      body,
    }),
};
