import { API_BASE_PATH } from "./endpoints";
import { redirectToLoginForCurrentPage } from "@/lib/authRedirect";
import { getCmsApiBaseUrl } from "@/config/runtimeConfig";

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
type UnauthorizedHandler = () => void;

const DEFAULT_TIMEOUT_MS = 15_000;

const sanitizeMessage = (message: unknown) =>
  typeof message === "string" ? message : "Request failed. Please try again.";

const httpErrorMessage = (status: number) => {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "Your current access does not allow this action.";
  if (status === 404) return "The requested resource is unavailable. Refresh and try again.";
  if (status === 408 || status === 504) return "The server took too long to respond. Please retry.";
  if (status === 413) return "The file or request is too large.";
  if (status === 429) return "Too many requests. Please wait and retry.";
  if (status >= 500) return "The service is temporarily unavailable. Please retry.";
  return "The request could not be completed. Check the entered information and retry.";
};

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
  private unauthorizedHandler?: UnauthorizedHandler;
  private inflightGetRequests = new Map<string, Promise<unknown>>();
  private sessionGeneration = 0;
  private activeRequests = new Set<AbortController>();

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
  setUnauthorizedHandler(handler: UnauthorizedHandler) {
    this.unauthorizedHandler = handler;
  }

  invalidateSession() {
    // Cookie sessions have no JavaScript token to use as an identity key.
    // Fence every login/logout, including a fresh login by the same user.
    this.sessionGeneration += 1;
    this.inflightGetRequests.clear();
    for (const controller of this.activeRequests) controller.abort();
    this.activeRequests.clear();
  }

  async request<TResponse, TBody = unknown>(options: ApiRequestOptions<TBody>): Promise<TResponse> {
    const generation = this.sessionGeneration;
    const pathWithParams = fillPathParams(options.path, options.pathParams);
    const queryString = this.buildQuery(options.query);
    const baseURL = getCmsApiBaseUrl();
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

    const requestKey = method === "GET" ? `${generation}:${method}:${url}` : undefined;
    if (requestKey && this.inflightGetRequests.has(requestKey)) {
      return this.inflightGetRequests.get(requestKey) as Promise<TResponse>;
    }

    const controller = new AbortController();
    this.activeRequests.add(controller);
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const assertCurrentSession = () => {
      if (generation !== this.sessionGeneration) {
        throw new ApiError({ status: 499, code: "AUTH_SESSION_CHANGED", message: "Your session changed. Please retry." });
      }
    };

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
          signal: controller.signal,
          credentials: "include",
        });
        assertCurrentSession();

        const contentType = response.headers.get("content-type");
        const isJson = contentType?.includes("application/json");
        // Cookie sessions keep the JWT in an HttpOnly cookie. Only legacy
        // bearer sessions need to consume a refreshed token from headers.
        if (authToken && this.refreshedAuthHandler) {
          const refreshedToken = response.headers.get("x-access-token");
          if (refreshedToken) {
            this.refreshedAuthHandler({
              token: refreshedToken,
              expiresAt: response.headers.get("x-access-token-expires-at") ?? undefined,
            });
          }
        }

        if (!response.ok) {
          // Reverse proxies often return HTML (or plain text) on failure.
          // Only structured API errors are suitable for displaying verbatim.
          const payload = isJson ? await response.json() : undefined;
          assertCurrentSession();
          const envelope = isJson ? parseErrorEnvelope(payload) : undefined;
          const envelopeMessage = envelope?.error?.message;
          throw new ApiError({
            status: response.status,
            code: envelope?.error?.code,
            traceId: envelope?.error?.traceId,
            message: envelopeMessage || (isJson ? sanitizeMessage(payload) : httpErrorMessage(response.status)),
            details: envelope?.error?.details ?? (isJson ? payload : undefined),
          });
        }

        if (options.responseType === "blob") {
          const payload = await response.blob();
          assertCurrentSession();
          return payload as TResponse;
        }

        const payload =
          options.responseType === "text" || !isJson ? await response.text() : await response.json();
        assertCurrentSession();
        return payload as TResponse;
      } catch (error) {
        // Abort is best effort: already-buffered responses and transports that
        // ignore AbortSignal must still never publish data or auth callbacks.
        assertCurrentSession();
        if (error instanceof ApiError) {
          if (typeof window !== "undefined" && error.status === 401 && !["/auth/login", "/auth/me"].includes(options.path)) {
            try {
              this.unauthorizedHandler?.();
            } catch {
              /* ignore auth cleanup failures */
            }
            redirectToLoginForCurrentPage();
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
        options.signal?.removeEventListener("abort", abortFromCaller);
        this.activeRequests.delete(controller);
      }
    };

    const requestPromise = executeRequest();
    if (requestKey) this.inflightGetRequests.set(requestKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      if (requestKey && this.inflightGetRequests.get(requestKey) === requestPromise) {
        this.inflightGetRequests.delete(requestKey);
      }
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
