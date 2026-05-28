import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { AuthResponse, User } from "../types";

export interface LoginPayload {
  email: string;
  password: string;
}

export const authApi = {
  login: (payload: LoginPayload) =>
    apiClient.request<AuthResponse>({
      path: endpoints.auth.login,
      method: "POST",
      body: payload,
    }),

  me: () =>
    apiClient.request<User>({
      path: endpoints.auth.me,
      method: "GET",
    }),

  logout: () =>
    apiClient.request<void>({
      path: endpoints.auth.logout,
      method: "POST",
    }),
};
