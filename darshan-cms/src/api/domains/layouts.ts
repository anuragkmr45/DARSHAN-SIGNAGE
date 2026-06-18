import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { LayoutCreatePayload, LayoutItem, LayoutListParams, LayoutListResponse } from "../types";

export const layoutsApi = {
  list: (params: LayoutListParams) =>
    apiClient.request<LayoutListResponse>({
      path: endpoints.layouts.base,
      method: "GET",
      query: params,
    }),
  create: (payload: LayoutCreatePayload) =>
    apiClient.request<LayoutItem>({
      path: endpoints.layouts.base,
      method: "POST",
      body: payload,
    }),
  update: (layoutId: string, payload: LayoutCreatePayload) =>
    apiClient.request<LayoutItem>({
      path: endpoints.layouts.byId(layoutId),
      method: "PATCH",
      body: payload,
    }),
  getById: (layoutId: string) =>
    apiClient.request<LayoutItem>({
      path: endpoints.layouts.byId(layoutId),
      method: "GET",
    }),
  remove: (layoutId: string) =>
    apiClient.request<void>({
      path: endpoints.layouts.byId(layoutId),
      method: "DELETE",
    }),
};
