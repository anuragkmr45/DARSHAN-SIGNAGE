import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { User } from "@/api/types";

export interface AuthState {
  token?: string;
  apiKey?: string;
  user?: User | null;
  csrfToken?: string;
}

const initialState: AuthState = {
  token: undefined,
  apiKey: undefined,
  user: null,
  csrfToken: undefined,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{ token?: string; user?: User; apiKey?: string; csrfToken?: string }>,
    ) => {
      state.token = action.payload.token;
      state.user = action.payload.user ?? null;
      if (action.payload.apiKey) {
        state.apiKey = action.payload.apiKey;
      }
      state.csrfToken = action.payload.csrfToken;
    },
    setApiKey: (state, action: PayloadAction<string | undefined>) => {
      state.apiKey = action.payload;
    },
    clearAuth: (state) => {
      state.token = undefined;
      state.apiKey = undefined;
      state.user = null;
      state.csrfToken = undefined;
    },
  },
});

export const { setCredentials, clearAuth, setApiKey } = authSlice.actions;
export default authSlice.reducer;
