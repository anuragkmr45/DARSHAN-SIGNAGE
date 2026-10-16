import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./apiClient";
import { resetCmsRuntimeConfigForTests, setCmsRuntimeConfigForTests } from "@/config/runtimeConfig";

const runtimeConfig = {
  source: "runtime-config" as const,
  environment: {
    name: "onprem-qa",
    deploymentId: "qa-lab-1",
    cmsId: "cms-a",
  },
  api: {
    baseUrl: "https://runtime-api.cms.test",
  },
  realtime: {
    socketBaseUrl: "https://runtime-ws.cms.test",
    socketTransports: ["websocket" as const],
  },
  diagnostics: {
    showEnvironmentIdentity: true,
  },
};

describe("ApiClient runtime config", () => {
  afterEach(() => {
    resetCmsRuntimeConfigForTests();
    vi.unstubAllGlobals();
  });

  it("resolves the API base URL at request time from runtime config", async () => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn(() => "application/json"),
      },
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient();
    await client.request<{ success: boolean }>({ path: "/screens", method: "GET" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime-api.cms.test/api/v1/screens",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );
  });

  it("posts login with cookies and accepts a user-only production response", async () => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const user = { id: "user-1", email: "admin@cms.test", role_id: "role-1", role: "Super Admin" };
    const headerGet = vi.fn((name: string) => name === "content-type" ? "application/json" : null);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: headerGet },
      json: async () => ({ user }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient();
    const response = await client.request<{ user: typeof user }>({
      path: "/auth/login",
      method: "POST",
      body: { email: user.email, password: "password123" },
    });

    expect(response).toEqual({ user });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime-api.cms.test/api/v1/auth/login",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(headerGet).not.toHaveBeenCalledWith("x-access-token");
  });

  it("does not copy a refreshed cookie JWT into JavaScript auth state", async () => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const headerGet = vi.fn((name: string) => ({
      "content-type": "application/json",
      "x-access-token": "secret-cookie-jwt",
    })[name] ?? null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: headerGet },
      json: async () => ({ id: "user-1" }),
    }));
    const client = new ApiClient();
    const refreshed = vi.fn();
    client.setRefreshedAuthHandler(refreshed);

    await client.request({ path: "/auth/me" });
    expect(refreshed).not.toHaveBeenCalled();
    expect(headerGet).not.toHaveBeenCalledWith("x-access-token");
  });

  it("preserves bearer refresh support and sends CSRF on state-changing requests", async () => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => ({
        "content-type": "application/json",
        "x-access-token": "refreshed-dev-token",
      })[name] ?? null },
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();
    const refreshed = vi.fn();
    client.setAuthTokenProvider(() => "dev-token");
    client.setCsrfTokenProvider(() => "csrf-cookie");
    client.setRefreshedAuthHandler(refreshed);

    await client.request({ path: "/auth/logout", method: "POST" });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      credentials: "include",
      headers: expect.objectContaining({ Authorization: "Bearer dev-token", "X-CSRF-Token": "csrf-cookie" }),
    }));
    expect(refreshed).toHaveBeenCalledWith({ token: "refreshed-dev-token", expiresAt: undefined });
  });

  it("clears unauthorized sessions and redirects protected requests to login", async () => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const replace = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "https://cms.test", pathname: "/dashboard", search: "", hash: "", replace },
      sessionStorage: { setItem: vi.fn() },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => "application/json" },
      json: async () => ({ error: { message: "Session expired" } }),
    }));
    const client = new ApiClient();
    const unauthorized = vi.fn();
    client.setUnauthorizedHandler(unauthorized);

    await expect(client.request({ path: "/screens" })).rejects.toBeInstanceOf(ApiError);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/login?redirect=%2Fdashboard");
  });
});
