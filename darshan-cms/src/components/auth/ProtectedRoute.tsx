import { Navigate, useLocation } from "react-router-dom";
import { useAppSelector } from "@/store/hooks";
import { useAuthorization } from "@/hooks/useAuthorization";
import { canAccessModule, getFirstAccessibleModulePath, type ModuleKey } from "@/lib/access";
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
    if (isAuthzLoading) return null;
    if (!canAccessModule(moduleKey, user ?? undefined, can)) {
      return <Navigate to={getFirstAccessibleModulePath(user ?? undefined, can)} replace />;
    }
  }

  if (requirePermissions?.length) {
    if (isAuthzLoading) return null;
    const allowed = requireAny
      ? requirePermissions.some((perm) => can(perm.action, perm.subject))
      : requirePermissions.every((perm) => can(perm.action, perm.subject));
    if (!allowed) {
      return <Navigate to={getFirstAccessibleModulePath(user ?? undefined, can)} replace />;
    }
  }

  return children;
}
