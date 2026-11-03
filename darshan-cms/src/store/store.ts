import { configureStore, type Middleware } from "@reduxjs/toolkit";
import {
  persistReducer,
  persistStore,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";
import storageSession from "redux-persist/lib/storage/session";
import { rootReducer } from "./rootReducer";
import { apiClient } from "@/api/apiClient";
import { getCookie } from "@/lib/cookies";
import { clearAuth, refreshAuthToken, setApiKey, setCredentials } from "./authSlice";

const createNoopStorage = () => ({
  getItem: async () => null,
  setItem: async (_key: string, value: unknown) => value as string,
  removeItem: async () => undefined,
});

const storage =
  typeof window !== "undefined" ? storageSession : createNoopStorage();

const darshanStorage = {
  ...storage,
  getItem: async (key: string) => {
    const current = await storage.getItem(key);
    if (current !== null || key !== "persist:darshan") return current;
    return storage.getItem("persist:signhex");
  },
};

const persistConfig = {
  key: "darshan",
  storage: darshanStorage,
  whitelist: ["auth"],
  version: 1,
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

const isolateApiSession: Middleware = () => (next) => (action) => {
  if (
    setCredentials.match(action) || clearAuth.match(action) || setApiKey.match(action) ||
    (typeof action === "object" && action !== null && "type" in action && action.type === REHYDRATE)
  ) {
    // Invalidate before Redux subscribers can issue requests for the new
    // identity. TanStack cache clearing cannot fence this client's own GETs.
    apiClient.invalidateSession();
  }
  return next(action);
};

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }).prepend(isolateApiSession),
});

export const persistor = persistStore(store);

apiClient.setAuthTokenProvider(() => store.getState().auth.token);
apiClient.setApiKeyProvider(() => store.getState().auth.apiKey);
apiClient.setCsrfTokenProvider(
  () => store.getState().auth.csrfToken ?? getCookie("csrf_token"),
);
apiClient.setRefreshedAuthHandler(({ token }) => {
  const current = store.getState().auth;
  store.dispatch(
    refreshAuthToken({
      token,
      csrfToken: current.csrfToken ?? getCookie("csrf_token") ?? undefined,
    }),
  );
});
apiClient.setUnauthorizedHandler(() => {
  store.dispatch(clearAuth());
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem("persist:darshan");
    window.sessionStorage.removeItem("persist:signhex");
  } catch {
    /* ignore storage cleanup failures */
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
