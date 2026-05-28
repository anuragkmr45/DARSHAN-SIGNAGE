import { configureStore } from "@reduxjs/toolkit";
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
import { setCredentials } from "./authSlice";

const createNoopStorage = () => ({
  getItem: async () => null,
  setItem: async (_key: string, value: unknown) => value as string,
  removeItem: async () => undefined,
});

const storage =
  typeof window !== "undefined" ? storageSession : createNoopStorage();

const persistConfig = {
  key: "signhex",
  storage,
  whitelist: ["auth"],
  version: 1,
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
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
    setCredentials({
      token,
      user: current.user ?? undefined,
      apiKey: current.apiKey,
      csrfToken: current.csrfToken ?? getCookie("csrf_token") ?? undefined,
    }),
  );
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
