import { useEffect, useState, type ReactNode } from "react";
import { authApi } from "@/api/domains/auth";
import { getCookie } from "@/lib/cookies";
import { clearAuth, setCredentials } from "@/store/authSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

export const AuthSessionBootstrap = ({ children }: { children: ReactNode }) => {
  const dispatch = useAppDispatch();
  const token = useAppSelector((state) => state.auth.token);
  const [hasBearerSession] = useState(Boolean(token));
  const [ready, setReady] = useState(hasBearerSession);

  useEffect(() => {
    // Existing development bearer sessions keep their established behavior.
    if (hasBearerSession) {
      setReady(true);
      return;
    }

    let active = true;
    void authApi.me()
      .then((user) => {
        if (active) dispatch(setCredentials({ user, csrfToken: getCookie("csrf_token") }));
      })
      .catch(() => {
        if (active) dispatch(clearAuth());
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [dispatch, hasBearerSession]);

  if (!ready) {
    return <div role="status" aria-busy="true">Restoring session…</div>;
  }

  return <>{children}</>;
};
