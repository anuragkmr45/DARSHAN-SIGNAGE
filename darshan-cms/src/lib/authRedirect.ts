import { STORAGE_KEYS } from "@/lib/constants";

const LOGIN_PATH = "/login";

const getBrowserOrigin = () =>
  typeof window === "undefined" ? "http://localhost" : window.location.origin;

export const getCurrentReturnPath = () => {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

export const sanitizeReturnPath = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  try {
    const parsed = new URL(value, getBrowserOrigin());
    if (parsed.origin !== getBrowserOrigin() || parsed.pathname === LOGIN_PATH) {
      return undefined;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
};

export const buildLoginRedirectPath = (returnPath: string) => {
  const safeReturnPath = sanitizeReturnPath(returnPath) ?? "/";
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(safeReturnPath)}`;
};

export const persistPostLoginRedirect = (returnPath: string) => {
  const safeReturnPath = sanitizeReturnPath(returnPath);
  if (!safeReturnPath || typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(STORAGE_KEYS.postLoginRedirect, safeReturnPath);
  } catch {
    /* ignore storage failures */
  }
};

const getStoredPostLoginRedirect = () => {
  if (typeof window === "undefined") return undefined;
  try {
    return sanitizeReturnPath(window.sessionStorage.getItem(STORAGE_KEYS.postLoginRedirect));
  } catch {
    return undefined;
  }
};

export const clearPostLoginRedirect = () => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEYS.postLoginRedirect);
  } catch {
    /* ignore storage failures */
  }
};

export const resolvePostLoginRedirect = (
  search: string,
  state?: unknown,
): string | undefined => {
  const params = new URLSearchParams(search);
  const queryRedirect = sanitizeReturnPath(params.get("redirect"));
  const stateRedirect =
    state && typeof state === "object" && "from" in state
      ? sanitizeReturnPath((state as { from?: unknown }).from)
      : undefined;

  return queryRedirect ?? stateRedirect ?? getStoredPostLoginRedirect();
};

let loginRedirectInProgress = false;

export const redirectToLoginForCurrentPage = () => {
  if (typeof window === "undefined" || loginRedirectInProgress) return;
  if (window.location.pathname === LOGIN_PATH) return;

  loginRedirectInProgress = true;
  const returnPath = getCurrentReturnPath();
  persistPostLoginRedirect(returnPath);
  window.location.replace(buildLoginRedirectPath(returnPath));
};
