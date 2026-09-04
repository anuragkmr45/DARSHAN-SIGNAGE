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
