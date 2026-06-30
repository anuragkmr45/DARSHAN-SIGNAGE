type RuntimeEnvironment = {
  name?: string;
  deploymentId?: string;
  cmsId?: string;
};

type RuntimeApi = {
  baseUrl?: string;
};

type RuntimeRealtime = {
  socketBaseUrl?: string;
  socketTransports?: Array<"websocket" | "polling">;
};

type RuntimeDiagnostics = {
  showEnvironmentIdentity?: boolean;
};

export type CmsRuntimeConfigInput = {
  cms?: {
    environment?: RuntimeEnvironment;
    api?: RuntimeApi;
    realtime?: RuntimeRealtime;
    diagnostics?: RuntimeDiagnostics;
  };
};

export type CmsRuntimeConfig = {
  source: "build-env" | "runtime-config" | "window";
  environment: Required<RuntimeEnvironment>;
  api: {
    baseUrl: string;
  };
  realtime: {
    socketBaseUrl: string;
    socketTransports: Array<"websocket" | "polling">;
  };
  diagnostics: Required<RuntimeDiagnostics>;
};

type BuildEnv = {
  VITE_API_BASE_URL?: string;
  VITE_WS_BASE_URL?: string;
  VITE_WS_URL?: string;
  VITE_CMS_ENVIRONMENT_NAME?: string;
  VITE_CMS_DEPLOYMENT_ID?: string;
  VITE_CMS_ID?: string;
  VITE_CMS_RUNTIME_CONFIG_PATH?: string;
};

type LoadOptions = {
  fetchImpl?: typeof fetch;
  configPath?: string;
  timeoutMs?: number;
};

declare global {
  interface Window {
    __DARSHAN_CMS_RUNTIME_CONFIG__?: CmsRuntimeConfigInput;
  }
}

const API_BASE_PATH = "/api/v1";
const DEFAULT_RUNTIME_CONFIG_PATH = "/config/app-config.json";
const SECRET_KEY_PATTERN =
  /(token|access[_-]?token|refresh[_-]?token|key|api[_-]?key|access[_-]?key|secret|password|pass|signature|sig|credential|auth|jwt|session)/i;

let cachedRuntimeConfig: CmsRuntimeConfig | undefined;

const getWindowOrigin = () => (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertNoSecretLookingKeys = (value: unknown, path = "cms") => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretLookingKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  Object.entries(value).forEach(([key, nestedValue]) => {
    const nextPath = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`Runtime CMS config contains a secret-looking key at ${nextPath}`);
    }
    assertNoSecretLookingKeys(nestedValue, nextPath);
  });
};

const assertKnownKeys = (value: unknown) => {
  if (!isPlainObject(value)) {
    throw new Error("Runtime CMS config must be a JSON object");
  }
  const topLevelKeys = new Set(["cms"]);
  Object.keys(value).forEach((key) => {
    if (!topLevelKeys.has(key)) throw new Error(`Runtime CMS config has unsupported top-level key: ${key}`);
  });
  const cms = value.cms;
  if (cms === undefined) return;
  if (!isPlainObject(cms)) throw new Error("Runtime CMS config cms must be an object");

  const cmsKeys = new Set(["environment", "api", "realtime", "diagnostics"]);
  Object.keys(cms).forEach((key) => {
    if (!cmsKeys.has(key)) throw new Error(`Runtime CMS config has unsupported cms key: ${key}`);
  });
};

const validatePublicBaseUrl = (value: string, fieldName: string) => {
  if (!value.trim()) throw new Error(`Runtime CMS config ${fieldName} cannot be blank`);

  if (value.startsWith("/")) {
    if (value.includes("?") || value.includes("#")) {
      throw new Error(`Runtime CMS config ${fieldName} must not include query strings or fragments`);
    }
    return normalizeBaseUrl(value);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Runtime CMS config ${fieldName} must be an absolute http(s) URL or same-origin path`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Runtime CMS config ${fieldName} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Runtime CMS config ${fieldName} must not include URL credentials`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`Runtime CMS config ${fieldName} must not include query strings or fragments`);
  }

  return normalizeBaseUrl(parsed.toString());
};

const toTransports = (value: unknown): Array<"websocket" | "polling"> | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Runtime CMS config realtime.socketTransports must be an array");
  const transports = value.map((entry) => {
    if (entry !== "websocket" && entry !== "polling") {
      throw new Error("Runtime CMS config realtime.socketTransports only supports websocket and polling");
    }
    return entry;
  });
  return transports.length > 0 ? transports : undefined;
};

const getContentType = (response: Response) => response.headers?.get("content-type")?.toLowerCase() ?? "";

const getBuildEnvConfig = (env: BuildEnv = import.meta.env, origin = getWindowOrigin()): CmsRuntimeConfig => {
  const apiBaseUrl = validatePublicBaseUrl(env.VITE_API_BASE_URL ?? origin, "api.baseUrl");
  const socketBaseUrl = validatePublicBaseUrl(
    env.VITE_WS_BASE_URL ?? env.VITE_WS_URL ?? env.VITE_API_BASE_URL ?? origin,
    "realtime.socketBaseUrl",
  );

  return {
    source: "build-env",
    environment: {
      name: env.VITE_CMS_ENVIRONMENT_NAME ?? "unspecified",
      deploymentId: env.VITE_CMS_DEPLOYMENT_ID ?? "unspecified",
      cmsId: env.VITE_CMS_ID ?? "cms",
    },
    api: {
      baseUrl: apiBaseUrl,
    },
    realtime: {
      socketBaseUrl,
      socketTransports: ["websocket"],
    },
    diagnostics: {
      showEnvironmentIdentity: true,
    },
  };
};

export const resolveCmsRuntimeConfig = (
  runtimeConfig?: CmsRuntimeConfigInput,
  env: BuildEnv = import.meta.env,
  origin = getWindowOrigin(),
  source: CmsRuntimeConfig["source"] = "runtime-config",
): CmsRuntimeConfig => {
  const base = getBuildEnvConfig(env, origin);
  if (!runtimeConfig) return base;

  assertNoSecretLookingKeys(runtimeConfig);
  assertKnownKeys(runtimeConfig);

  const cms = runtimeConfig.cms;
  if (!cms) return base;

  const apiBaseUrl =
    cms.api?.baseUrl !== undefined ? validatePublicBaseUrl(cms.api.baseUrl, "api.baseUrl") : base.api.baseUrl;
  const socketBaseUrl =
    cms.realtime?.socketBaseUrl !== undefined
      ? validatePublicBaseUrl(cms.realtime.socketBaseUrl, "realtime.socketBaseUrl")
      : base.realtime.socketBaseUrl;
  const socketTransports = toTransports(cms.realtime?.socketTransports) ?? base.realtime.socketTransports;

  return {
    source,
    environment: {
      name: cms.environment?.name ?? base.environment.name,
      deploymentId: cms.environment?.deploymentId ?? base.environment.deploymentId,
      cmsId: cms.environment?.cmsId ?? base.environment.cmsId,
    },
    api: {
      baseUrl: apiBaseUrl,
    },
    realtime: {
      socketBaseUrl,
      socketTransports,
    },
    diagnostics: {
      showEnvironmentIdentity: cms.diagnostics?.showEnvironmentIdentity ?? base.diagnostics.showEnvironmentIdentity,
    },
  };
};

export const getCmsRuntimeConfig = () => {
  if (!cachedRuntimeConfig) cachedRuntimeConfig = getBuildEnvConfig();
  return cachedRuntimeConfig;
};

export const getCmsApiBaseUrl = () => `${getCmsRuntimeConfig().api.baseUrl}${API_BASE_PATH}`;

export const getCmsSocketBaseUrl = () => getCmsRuntimeConfig().realtime.socketBaseUrl;

export const getCmsSocketTransports = () => getCmsRuntimeConfig().realtime.socketTransports;

export const getCmsRuntimeConfigSummary = () => {
  const config = getCmsRuntimeConfig();
  return {
    source: config.source,
    environment: config.environment,
    apiBaseUrl: config.api.baseUrl,
    socketBaseUrl: config.realtime.socketBaseUrl,
    socketTransports: config.realtime.socketTransports,
    diagnostics: config.diagnostics,
  };
};

export const loadCmsRuntimeConfig = async (options: LoadOptions = {}) => {
  const env = import.meta.env as BuildEnv;
  const windowConfig =
    typeof window !== "undefined" && window.__DARSHAN_CMS_RUNTIME_CONFIG__
      ? window.__DARSHAN_CMS_RUNTIME_CONFIG__
      : undefined;

  if (windowConfig) {
    cachedRuntimeConfig = resolveCmsRuntimeConfig(windowConfig, env, getWindowOrigin(), "window");
    return cachedRuntimeConfig;
  }

  const fetchImpl = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchImpl) {
    cachedRuntimeConfig = getBuildEnvConfig(env);
    return cachedRuntimeConfig;
  }

  const configPath = options.configPath ?? env.VITE_CMS_RUNTIME_CONFIG_PATH ?? DEFAULT_RUNTIME_CONFIG_PATH;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeout =
    controller && typeof window !== "undefined"
      ? window.setTimeout(() => controller.abort(), options.timeoutMs ?? 1500)
      : undefined;

  try {
    const response = await fetchImpl(configPath, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller?.signal,
    });

    if (response.status === 404) {
      cachedRuntimeConfig = getBuildEnvConfig(env);
      return cachedRuntimeConfig;
    }
    if (!response.ok) {
      throw new Error(`Runtime CMS config request failed with status ${response.status}`);
    }

    const contentType = getContentType(response);
    if (contentType && !contentType.includes("application/json")) {
      if (configPath === DEFAULT_RUNTIME_CONFIG_PATH && contentType.includes("text/html")) {
        cachedRuntimeConfig = getBuildEnvConfig(env);
        return cachedRuntimeConfig;
      }
      throw new Error("Runtime CMS config response was not JSON");
    }

    const payload = (await response.json()) as CmsRuntimeConfigInput;
    cachedRuntimeConfig = resolveCmsRuntimeConfig(payload, env, getWindowOrigin(), "runtime-config");
    return cachedRuntimeConfig;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      cachedRuntimeConfig = getBuildEnvConfig(env);
      return cachedRuntimeConfig;
    }
    throw error;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
};

export const setCmsRuntimeConfigForTests = (config: CmsRuntimeConfig) => {
  cachedRuntimeConfig = config;
};

export const resetCmsRuntimeConfigForTests = () => {
  cachedRuntimeConfig = undefined;
};
