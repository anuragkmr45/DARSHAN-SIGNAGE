const AUTH_CONTEXT_STORAGE_KEY = "darshan-cms:auth-context-change";
const AUTH_CONTEXT_CHANNEL_NAME = "darshan-cms:auth-context";
let authContextChannel: BroadcastChannel | undefined;

const getAuthContextChannel = (): BroadcastChannel | undefined => {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return undefined;
  if (authContextChannel) return authContextChannel;
  try {
    authContextChannel = new BroadcastChannel(AUTH_CONTEXT_CHANNEL_NAME);
  } catch {
    // Storage events can still notify other tabs if BroadcastChannel is blocked.
  }
  return authContextChannel;
};

/** Share only a random revision marker, never credentials or user details. */
export function announceAuthContextChange(): void {
  if (typeof window === "undefined") return;
  const revision = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  try {
    window.localStorage.setItem(AUTH_CONTEXT_STORAGE_KEY, revision);
  } catch {
    // BroadcastChannel may still work when storage is disabled.
  }
  try {
    getAuthContextChannel()?.postMessage(revision);
  } catch {
    // Window-focus /auth/me reconciliation is the final fail-closed fallback.
  }
}

export function subscribeToAuthContextChanges(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  let lastRevision: string | undefined;
  const notifyOnce = (revision: unknown) => {
    if (typeof revision !== "string" || !revision || revision === lastRevision) return;
    lastRevision = revision;
    onChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTH_CONTEXT_STORAGE_KEY) notifyOnce(event.newValue);
  };
  const onChannelMessage = (event: MessageEvent<unknown>) => notifyOnce(event.data);
  window.addEventListener("storage", onStorage);
  const channel = getAuthContextChannel();
  channel?.addEventListener("message", onChannelMessage);
  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.removeEventListener("message", onChannelMessage);
  };
}
