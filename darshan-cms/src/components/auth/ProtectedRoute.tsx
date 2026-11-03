import { Navigate, useLocation } from "react-router-dom";
import { useAppSelector } from "@/store/hooks";
import { useAuthorization } from "@/hooks/useAuthorization";
import { canAccessModule, type ModuleKey } from "@/lib/access";
import { buildLoginRedirectPath } from "@/lib/authRedirect";

interface ProtectedRouteProps {
  children: React.ReactElement;
  requirePermissions?: Array<{ action: string; subject: string }>;
  requireAny?: boolean;
  moduleKey?: ModuleKey;
}

export function ProtectedRoute({
  children,
  requirePermissions,
  requireAny = true,
  moduleKey,
}: ProtectedRouteProps) {
  const location = useLocation();
  const { token, user } = useAppSelector((state) => state.auth);
  const { can, isLoading: isAuthzLoading } = useAuthorization();

  const isAuthed = Boolean(token || user);

  if (!isAuthed) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={buildLoginRedirectPath(from)} replace state={{ from }} />;
  }

  if (moduleKey) {
    if (isAuthzLoading) return <div role="status" aria-live="polite" className="p-6 text-sm text-muted-foreground">Checking access…</div>;
    if (!canAccessModule(moduleKey, user ?? undefined, can)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  if (requirePermissions?.length) {
    if (isAuthzLoading) return <div role="status" aria-live="polite" className="p-6 text-sm text-muted-foreground">Checking access…</div>;
    const allowed = requireAny
      ? requirePermissions.some((perm) => can(perm.action, perm.subject))
      : requirePermissions.every((perm) => can(perm.action, perm.subject));
    if (!allowed) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}
