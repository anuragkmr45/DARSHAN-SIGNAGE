import { API_BASE_PATH } from "./endpoints";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ApiRequestOptions<TBody = unknown> {
  path: string; // e.g. "/screens/:id/now-playing" (no /api/v1 needed)
  pathParams?: Record<string, string | number>;
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: TBody;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  useApiKey?: boolean;
  rawBody?: BodyInit; // if you need FormData/Blob; skips JSON stringify
  responseType?: "json" | "text" | "blob";
}

export interface ApiErrorShape {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
  traceId?: string;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  code?: string;
  traceId?: string;
  constructor(payload: ApiErrorShape) {
    super(payload.message);
    this.name = "ApiError";
    this.status = payload.status;
    this.details = payload.details;
    this.code = payload.code;
    this.traceId = payload.traceId;
  }
}

type TokenProvider = () => string | undefined | null;
type RefreshedAuthHandler = (payload: { token: string; expiresAt?: string }) => void;

const DEFAULT_TIMEOUT_MS = 15_000;
const inferredOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
const baseURL = `${envBaseUrl ?? inferredOrigin}${API_BASE_PATH}`;
const POST_LOGIN_REDIRECT_KEY = "postLoginRedirect";

const sanitizeMessage = (message: unknown) =>
  typeof message === "string" ? message : "Request failed. Please try again.";

type ErrorEnvelope = {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    traceId?: string;
  };
};

const parseErrorEnvelope = (payload: unknown): ErrorEnvelope | undefined => {
  if (!payload || typeof payload !== "object") return undefined;
  return payload as ErrorEnvelope;
};

const fillPathParams = (path: string, params?: Record<string, string | number>) =>
  !params
    ? path
    : Object.entries(params).reduce(
        (acc, [key, value]) => acc.replace(new RegExp(`:${key}\\b`, "g"), encodeURIComponent(String(value))),
        path,
      );

export class ApiClient {
  private authTokenProvider: TokenProvider = () => undefined;
  private apiKeyProvider: TokenProvider = () => undefined;
  private csrfTokenProvider: TokenProvider = () => undefined;
  private refreshedAuthHandler?: RefreshedAuthHandler;
  private inflightGetRequests = new Map<string, Promise<unknown>>();

  setAuthTokenProvider(getToken: TokenProvider) {
    this.authTokenProvider = getToken;
  }
  setApiKeyProvider(getKey: TokenProvider) {
    this.apiKeyProvider = getKey;
  }
  setCsrfTokenProvider(getToken: TokenProvider) {
    this.csrfTokenProvider = getToken;
  }
  setRefreshedAuthHandler(handler: RefreshedAuthHandler) {
    this.refreshedAuthHandler = handler;
  }

  async request<TResponse, TBody = unknown>(options: ApiRequestOptions<TBody>): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const pathWithParams = fillPathParams(options.path, options.pathParams);
    const queryString = this.buildQuery(options.query);
    const url = `${baseURL}${pathWithParams}${queryString}`;
    const method = options.method ?? "GET";

    const headers: Record<string, string> = {
      "X-Requested-With": "XMLHttpRequest",
      ...options.headers,
    };
    const authToken = this.authTokenProvider();
    const apiKey = options.useApiKey ? this.apiKeyProvider() : undefined;
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (apiKey) headers["X-API-Key"] = apiKey;

    const csrfToken = this.csrfTokenProvider();
    const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    if (isStateChanging && csrfToken) headers["X-CSRF-Token"] = csrfToken;

    headers["Cache-Control"] = "no-store";

    const requestKey = method === "GET" ? `${method}:${url}` : undefined;
    if (requestKey && this.inflightGetRequests.has(requestKey)) {
      return this.inflightGetRequests.get(requestKey) as Promise<TResponse>;
    }

    const executeRequest = async () => {
      try {
        const body =
          options.rawBody !== undefined
            ? options.rawBody
            : options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined;

        if (body && options.rawBody === undefined) headers["Content-Type"] = "application/json";

        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: options.signal ?? controller.signal,
          credentials: "include",
        });

        const contentType = response.headers.get("content-type");
        const isJson = contentType?.includes("application/json");
        const refreshedToken = response.headers.get("x-access-token");
        const refreshedExpiresAt = response.headers.get("x-access-token-expires-at") ?? undefined;

        if (refreshedToken && this.refreshedAuthHandler) {
          this.refreshedAuthHandler({ token: refreshedToken, expiresAt: refreshedExpiresAt });
        }

        if (!response.ok) {
          const payload = isJson ? await response.json() : await response.text();
          const envelope = isJson ? parseErrorEnvelope(payload) : undefined;
          const envelopeMessage = envelope?.error?.message;
          throw new ApiError({
            status: response.status,
            code: envelope?.error?.code,
            traceId: envelope?.error?.traceId,
            message: envelopeMessage || sanitizeMessage(payload),
            details: envelope?.error?.details ?? (isJson ? payload : undefined),
          });
        }

        if (options.responseType === "blob") {
          return (await response.blob()) as TResponse;
        }

        const payload =
          options.responseType === "text" || !isJson ? await response.text() : await response.json();

        return payload as TResponse;
      } catch (error) {
        if (error instanceof ApiError) {
          if (typeof window !== "undefined" && error.status === 401 && !options.path.includes("/auth/login")) {
            const isAlreadyOnLogin = window.location.pathname === "/login";

            if (!isAlreadyOnLogin) {
              try {
                sessionStorage.setItem(
                  POST_LOGIN_REDIRECT_KEY,
                  window.location.pathname + window.location.search,
                );
              } catch {
                /* ignore */
              }
              window.location.replace("/login");
            }
          }
          throw error;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new ApiError({ status: 408, message: "Request timed out. Please retry." });
        }
        const message = error instanceof Error ? error.message : "Network error";
        throw new ApiError({ status: 500, message: sanitizeMessage(message) });
      } finally {
        clearTimeout(timeout);
      }
    };

    const requestPromise = executeRequest();
    if (requestKey) this.inflightGetRequests.set(requestKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      if (requestKey) this.inflightGetRequests.delete(requestKey);
    }
  }

  private buildQuery(query: ApiRequestOptions["query"]): string {
    if (!query) return "";
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      params.append(key, String(value));
    });
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }
}

export const apiClient = new ApiClient();
