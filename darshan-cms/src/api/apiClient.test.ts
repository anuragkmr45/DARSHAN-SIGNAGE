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
    vi.useRealTimers();
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

  it("replaces an actual proxy502 HTML response with a readable service error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html><body><h1>502 Bad Gateway</h1><hr>nginx</body></html>", {
      status: 502, headers: { "content-type": "text/html" },
    })));
    const error = await new ApiClient().request({ path: "/live-sessions" }).catch((failure) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, message: "The service is temporarily unavailable. Please retry." });
    expect(error.message).not.toContain("<html>");
    expect(error.details).toBeUndefined();
  });

  it("uses status-specific guidance for plain-text errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("proxy-specific internal diagnostic", {
      status: 429, headers: { "content-type": "text/plain" },
    })));
    await expect(new ApiClient().request({ path: "/live-sessions" })).rejects.toMatchObject({
      status: 429, message: "Too many requests. Please wait and retry.", details: undefined,
    });
  });

  it("preserves structured JSON business errors and successful text responses", async () => {
    const details = { blockers: { schedule_items: 2 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ error: {
      code: "LIVE_SESSION_IN_USE", message: "Remove the current schedule reference.", details, traceId: "test-trace",
    } }, { status: 409 })).mockResolvedValueOnce(new Response("expected plain-text result", { headers: { "content-type": "text/plain" } })));
    const client = new ApiClient();
    await expect(client.request({ path: "/live-sessions/source", method: "DELETE" })).rejects.toMatchObject({
      status: 409, code: "LIVE_SESSION_IN_USE", message: "Remove the current schedule reference.", details, traceId: "test-trace",
    });
    expect(await client.request({ path: "/status", responseType: "text" })).toBe("expected plain-text result");
  });

  it("deduplicates same-session GETs without creating extra timeout timers", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();
    const first = client.request({ path: "/live-sessions" });
    const second = client.request({ path: "/live-sessions" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    resolve(Response.json({ sources: [] }));
    expect(await Promise.all([first, second])).toEqual([{ sources: [] }, { sources: [] }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects late old-session data without deleting the new session's pending GET", async () => {
    const pending: Array<(response: Response) => void> = [];
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      // Deliberately ignore abort to cover already-buffered responses too.
      return new Promise<Response>((resolve) => pending.push(resolve));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();
    const oldRead = client.request({ path: "/live-sessions" }).catch((error) => error);
    client.invalidateSession();
    expect(signals[0].aborted).toBe(true);
    const newRead = client.request({ path: "/live-sessions" });
    pending[0](Response.json({ owner: "old" }));
    expect(await oldRead).toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    const newDuplicate = client.request({ path: "/live-sessions" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1](Response.json({ owner: "new" }));
    expect(await Promise.all([newRead, newDuplicate])).toEqual([{ owner: "new" }, { owner: "new" }]);
  });

  it.each(["json", "text", "blob"] as const)("fences an old %s body that finishes decoding after the account changes", async (responseType) => {
    let finishBody!: (body: unknown) => void;
    const body = new Promise((resolve) => { finishBody = resolve; });
    const decode = vi.fn(() => body);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: decode, text: decode, blob: decode,
    }));
    const client = new ApiClient();
    const oldRead = client.request({ path: "/live-sessions", responseType }).catch((error) => error);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    client.invalidateSession();
    finishBody({ owner: "old" });
    expect(await oldRead).toMatchObject({ code: "AUTH_SESSION_CHANGED" });
  });

  it("ignores late old-session bearer refresh headers", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const client = new ApiClient();
    const refreshed = vi.fn();
    client.setAuthTokenProvider(() => "test-old-token");
    client.setRefreshedAuthHandler(refreshed);
    const oldRead = client.request({ path: "/screens" }).catch((error) => error);
    client.invalidateSession();
    resolve(Response.json({}, { headers: { "x-access-token": "test-stale-token" } }));
    expect(await oldRead).toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    expect(refreshed).not.toHaveBeenCalled();
  });

  it("does not log out the new account when an old 401 finishes decoding", async () => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const replace = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "https://cms.test", pathname: "/dashboard", search: "", hash: "", replace },
      sessionStorage: { setItem: vi.fn() },
    });
    let finishBody!: (body: unknown) => void;
    const decode = vi.fn(() => new Promise((resolve) => { finishBody = resolve; }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401, headers: new Headers({ "content-type": "application/json" }), json: decode,
    }));
    const client = new ApiClient();
    const unauthorized = vi.fn();
    client.setUnauthorizedHandler(unauthorized);
    const oldRead = client.request({ path: "/screens" }).catch((error) => error);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    client.invalidateSession();
    finishBody({ error: { message: "Old session expired" } });
    expect(await oldRead).toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    expect(unauthorized).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(["timeout", "caller", "session"])("retains %s cancellation when an external AbortSignal is supplied", async (cause) => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();
    const result = client.request({ path: "/screens", signal: caller.signal, timeoutMs: 20 }).catch((error) => error);
    if (cause === "timeout") await vi.advanceTimersByTimeAsync(20);
    else if (cause === "caller") caller.abort();
    else client.invalidateSession();
    expect(await result).toMatchObject(cause === "session" ? { code: "AUTH_SESSION_CHANGED" } : { status: 408 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
