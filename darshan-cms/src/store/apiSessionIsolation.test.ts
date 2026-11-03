import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/apiClient";
import type { User } from "@/api/types";
import { resetCmsRuntimeConfigForTests, setCmsRuntimeConfigForTests } from "@/config/runtimeConfig";
import { clearAuth, setApiKey, setCredentials } from "./authSlice";
import { persistor, store } from "./store";

const user = (id: string): User => ({ id, email: `${id}@cms.test`, role_id: "role-1", role: "OPERATOR" });
const runtimeConfig = {
  source: "runtime-config" as const,
  environment: { name: "onprem-qa", deploymentId: "qa-lab-1", cmsId: "cms-a" },
  api: { baseUrl: "https://runtime-api.cms.test" },
  realtime: { socketBaseUrl: "https://runtime-api.cms.test", socketTransports: ["websocket" as const] },
  diagnostics: { showEnvironmentIdentity: false },
};

describe("API reads across the actual SPA auth lifecycle", () => {
  beforeAll(async () => {
    if (!persistor.getState().bootstrapped) {
      await new Promise<void>((resolve) => {
        const unsubscribe = persistor.subscribe(() => {
          if (persistor.getState().bootstrapped) { unsubscribe(); resolve(); }
        });
      });
    }
    persistor.pause();
  });
  afterEach(() => {
    store.dispatch(clearAuth());
    resetCmsRuntimeConfigForTests();
    vi.unstubAllGlobals();
  });

  it("does not reuse an old cookie-session GET after logout cache clearing and another login", async () => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    store.dispatch(setCredentials({ user: user("operator-a") }));
    const oldQuery = queryClient.fetchQuery({
      queryKey: ["live-sessions", "operator-a"],
      queryFn: () => apiClient.request({ path: "/live-sessions" }),
    }).catch(() => undefined);

    // This is AppHeader's SPA logout sequence; cancellation alone does not
    // abort a domain request that never receives Query's AbortSignal.
    store.dispatch(clearAuth());
    await queryClient.cancelQueries();
    queryClient.clear();
    store.dispatch(setCredentials({ user: user("operator-b") }));
    const newQuery = queryClient.fetchQuery({
      queryKey: ["live-sessions", "operator-b"],
      queryFn: () => apiClient.request({ path: "/live-sessions" }),
    });
    const countAfterSwitch = fetchMock.mock.calls.length;
    pending[0](Response.json({ owner: "operator-a" }));
    pending[1]?.(Response.json({ owner: "operator-b" }));
    const newResult = await newQuery;
    await oldQuery;
    queryClient.clear();

    expect(countAfterSwitch).toBe(2);
    expect(newResult).toEqual({ owner: "operator-b" });
  });

  it.each(["same-user login", "API key change"])("fences pending reads on %s", async (transition) => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
    vi.stubGlobal("fetch", fetchMock);
    store.dispatch(setCredentials({ user: user("operator-a") }));
    const oldRead = apiClient.request({ path: "/live-sessions" }).catch((error) => error);
    if (transition === "same-user login") store.dispatch(setCredentials({ user: user("operator-a") }));
    else store.dispatch(setApiKey("test-api-key"));
    const newRead = apiClient.request({ path: "/live-sessions" });
    pending[0](Response.json({ version: "old" }));
    pending[1]?.(Response.json({ version: "new" }));

    expect(await oldRead).toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    expect(await newRead).toEqual({ version: "new" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps concurrent reads in the same bearer session alive during a token refresh", async () => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const pending: Array<(response: Response) => void> = [];
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise<Response>((resolve) => pending.push(resolve));
    }));
    store.dispatch(setCredentials({ token: "test-initial-token", user: user("operator-a"), csrfToken: "test-csrf" }));
    const refreshingRead = apiClient.request({ path: "/screens" });
    const concurrentRead = apiClient.request({ path: "/live-sessions" });
    pending[0](Response.json({ screens: [] }, { headers: { "x-access-token": "test-refreshed-token" } }));
    await refreshingRead;
    expect(store.getState().auth).toMatchObject({ token: "test-refreshed-token", user: user("operator-a"), csrfToken: "test-csrf" });
    expect(signals[1].aborted).toBe(false);
    pending[1](Response.json({ sources: [] }));
    expect(await concurrentRead).toEqual({ sources: [] });
  });
});
