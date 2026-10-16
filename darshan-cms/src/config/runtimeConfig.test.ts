import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCmsApiBaseUrl,
  getCmsRuntimeConfig,
  getCmsRuntimeConfigSummary,
  getCmsSocketBaseUrl,
  loadCmsRuntimeConfig,
  resetCmsRuntimeConfigForTests,
  resolveCmsRuntimeConfig,
} from "./runtimeConfig";

const buildEnv = {
  VITE_API_BASE_URL: "https://build-api.cms.test",
  VITE_WS_BASE_URL: "https://build-ws.cms.test",
  VITE_CMS_ENVIRONMENT_NAME: "build-env",
  VITE_CMS_DEPLOYMENT_ID: "build-deployment",
  VITE_CMS_ID: "cms-build",
};

describe("CMS runtime config", () => {
  beforeEach(() => {
    resetCmsRuntimeConfigForTests();
    vi.unstubAllGlobals();
    // Runtime fallback tests must not inherit a developer's HTTP-only .env
    // when they intentionally emulate an HTTPS CMS origin.
    vi.stubEnv("VITE_API_BASE_URL", "https://build-api.cms.test");
    vi.stubEnv("VITE_WS_BASE_URL", "https://build-ws.cms.test");
    vi.stubEnv("VITE_CMS_ENVIRONMENT_NAME", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps build-time env behavior when no runtime config is present", () => {
    const config = resolveCmsRuntimeConfig(
      undefined,
      buildEnv,
      "https://cms.test",
      "runtime-config",
    );

    expect(config.source).toBe("build-env");
    expect(config.api.baseUrl).toBe("https://build-api.cms.test");
    expect(config.realtime.socketBaseUrl).toBe("https://build-ws.cms.test");
    expect(config.environment).toEqual({
      name: "build-env",
      deploymentId: "build-deployment",
      cmsId: "cms-build",
    });
  });

  it("falls back to the CMS origin for empty and whitespace-only build URLs", () => {
    for (const apiUrl of ["", "  \t "]) {
      const config = resolveCmsRuntimeConfig(
        {
          cms: { environment: { name: "production" } },
        },
        {
          ...buildEnv,
          VITE_API_BASE_URL: apiUrl,
          VITE_WS_BASE_URL: "",
          VITE_WS_URL: " \t ",
        },
        "https://cms.test",
      );
      expect(config.api.baseUrl).toBe("https://cms.test");
      expect(config.realtime.socketBaseUrl).toBe("https://cms.test");
    }
  });

  it("uses the first nonblank socket URL and preserves explicit build URLs", () => {
    const config = resolveCmsRuntimeConfig(
      undefined,
      {
        ...buildEnv,
        VITE_API_BASE_URL: " https://build-api.cms.test ",
        VITE_WS_BASE_URL: "  ",
        VITE_WS_URL: " https://socket.cms.test ",
      },
      "https://cms.test",
    );
    expect(config.api.baseUrl).toBe("https://build-api.cms.test");
    expect(config.realtime.socketBaseUrl).toBe("https://socket.cms.test");
  });

  it("falls back from blank socket URLs to the explicit API URL", () => {
    const config = resolveCmsRuntimeConfig(undefined, {
      ...buildEnv,
      VITE_WS_BASE_URL: " ",
      VITE_WS_URL: "",
    }, "https://cms.test");
    expect(config.realtime.socketBaseUrl).toBe("https://build-api.cms.test");
    expect(resolveCmsRuntimeConfig(undefined, {}, "https://cms.test").api.baseUrl).toBe("https://cms.test");
  });

  it("continues to reject explicitly blank runtime URLs", () => {
    expect(() => resolveCmsRuntimeConfig({ cms: { api: { baseUrl: " " } } }, buildEnv))
      .toThrow(/cannot be blank/);
  });

  it("lets the deployed runtime config override blank artifact defaults", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_WS_BASE_URL", "");
    vi.stubEnv("VITE_WS_URL", "");
    vi.stubEnv("VITE_CMS_ENVIRONMENT_NAME", "artifact");
    vi.stubEnv("VITE_CMS_ID", "cms");
    vi.stubGlobal("window", {
      location: { origin: "https://192.168.9.221" },
      setTimeout,
      clearTimeout,
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({
        cms: {
          environment: {
            name: "production",
            deploymentId: "site-a",
            cmsId: "cms-site-a",
            releaseId: "2026-10-15-r1",
            compatibilityGeneration: 1,
          },
          api: { baseUrl: "https://192.168.9.221" },
          realtime: {
            socketBaseUrl: "https://192.168.9.221",
            socketTransports: ["websocket"],
          },
          diagnostics: { showEnvironmentIdentity: true },
        },
      }),
    });

    const config = await loadCmsRuntimeConfig({ fetchImpl });
    expect(config.source).toBe("runtime-config");
    expect(config.environment).toEqual({
      name: "production",
      deploymentId: "site-a",
      cmsId: "cms-site-a",
    });
    expect(getCmsApiBaseUrl()).toBe("https://192.168.9.221/api/v1");
    expect(getCmsSocketBaseUrl()).toBe("https://192.168.9.221");
  });

  it("rejects malformed nonblank build URLs and insecure production URLs", () => {
    expect(() =>
      resolveCmsRuntimeConfig(undefined, { ...buildEnv, VITE_API_BASE_URL: "not a url" }, "https://cms.test"),
    ).toThrow(/absolute http\(s\) URL/);
    expect(() =>
      resolveCmsRuntimeConfig(
        { cms: { environment: { name: "production" } } },
        { ...buildEnv, VITE_API_BASE_URL: "http://backend.test" },
        "http://cms.test",
      ),
    ).toThrow(/must use https/);
  });

  it("uses browser runtime config for public endpoint and environment labels", () => {
    const config = resolveCmsRuntimeConfig(
      {
        cms: {
          environment: {
            name: "onprem-qa",
            deploymentId: "qa-lab-1",
            cmsId: "cms-a",
          },
          api: {
            baseUrl: "http://192.168.0.5:3000",
          },
          realtime: {
            socketBaseUrl: "http://192.168.0.5:3000",
            socketTransports: ["websocket", "polling"],
          },
        },
      },
      buildEnv,
      "http://cms.test",
      "runtime-config",
    );

    expect(config.source).toBe("runtime-config");
    expect(config.api.baseUrl).toBe("http://192.168.0.5:3000");
    expect(config.realtime.socketTransports).toEqual(["websocket", "polling"]);
    expect(config.environment.name).toBe("onprem-qa");
  });

  it("rejects mixed-content API and socket endpoints on an HTTPS CMS", () => {
    expect(() =>
      resolveCmsRuntimeConfig(
        {
          cms: {
            api: { baseUrl: "http://backend.test:3000" },
            realtime: { socketBaseUrl: "http://backend.test:3000" },
          },
        },
        buildEnv,
        "https://cms.test",
      ),
    ).toThrow(/must use https/);
  });

  it("rejects HTTP build fallbacks when an HTTPS CMS has no runtime override", () => {
    expect(() =>
      resolveCmsRuntimeConfig(
        undefined,
        {
          ...buildEnv,
          VITE_API_BASE_URL: "http://backend.test:3000",
          VITE_WS_BASE_URL: "http://backend.test:3000",
        },
        "https://cms.test",
      ),
    ).toThrow(/must use https/);
  });

  it("keeps HTTP available for an explicitly non-production development CMS", () => {
    const config = resolveCmsRuntimeConfig(
      {
        cms: {
          environment: { name: "development" },
          api: { baseUrl: "http://localhost:3000" },
          realtime: { socketBaseUrl: "http://localhost:3000" },
        },
      },
      buildEnv,
      "http://localhost:5173",
    );
    expect(config.api.baseUrl).toBe("http://localhost:3000");
  });

  it("rejects secret-looking keys in browser-visible config", () => {
    expect(() =>
      resolveCmsRuntimeConfig(
        {
          cms: {
            api: {
              baseUrl: "https://api.cms.test",
            },
            // @ts-expect-error secret-looking keys are intentionally rejected at runtime.
            apiToken: "do-not-commit",
          },
        },
        buildEnv,
      ),
    ).toThrow(/secret-looking key/);
  });

  it("rejects credentialed URLs and query strings", () => {
    expect(() =>
      resolveCmsRuntimeConfig(
        {
          cms: {
            api: {
              baseUrl: "https://user:password@api.cms.test?token=abc",
            },
          },
        },
        buildEnv,
      ),
    ).toThrow(/URL credentials|query strings/);
  });

  it("loads runtime config from a fetched JSON file", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://cms.test" },
      setTimeout,
      clearTimeout,
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        cms: {
          api: { baseUrl: "https://runtime-api.cms.test" },
          realtime: { socketBaseUrl: "https://runtime-ws.cms.test" },
        },
      }),
    });

    await loadCmsRuntimeConfig({
      fetchImpl,
      configPath: "/config/app-config.json",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/config/app-config.json",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
    expect(getCmsApiBaseUrl()).toBe("https://runtime-api.cms.test/api/v1");
    expect(getCmsSocketBaseUrl()).toBe("https://runtime-ws.cms.test");
  });

  it("falls back to build config when runtime config file is absent", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_WS_BASE_URL", "");
    vi.stubEnv("VITE_WS_URL", "");
    vi.stubGlobal("window", {
      location: { origin: "https://cms.test" },
      setTimeout,
      clearTimeout,
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await loadCmsRuntimeConfig({
      fetchImpl,
      configPath: "/config/app-config.json",
    });

    expect(getCmsRuntimeConfig().source).toBe("build-env");
    expect(getCmsApiBaseUrl()).toBe("https://cms.test/api/v1");
    expect(getCmsRuntimeConfigSummary().apiBaseUrl).not.toContain("token=");
  });

  it("falls back to build config when the default runtime config path returns Vite HTML", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://cms.test" },
      setTimeout,
      clearTimeout,
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue("text/html; charset=utf-8"),
      },
      json: vi.fn(),
    });

    await loadCmsRuntimeConfig({ fetchImpl });

    expect(getCmsRuntimeConfig().source).toBe("build-env");
    expect(fetchImpl.mock.results[0]).toBeDefined();
  });

  it("fails clearly when an explicit runtime config path does not return JSON", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://cms.test" },
      setTimeout,
      clearTimeout,
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue("text/html; charset=utf-8"),
      },
      json: vi.fn(),
    });

    await expect(
      loadCmsRuntimeConfig({
        fetchImpl,
        configPath: "/custom/runtime-config.json",
      }),
    ).rejects.toThrow(/response was not JSON/);
  });
});
