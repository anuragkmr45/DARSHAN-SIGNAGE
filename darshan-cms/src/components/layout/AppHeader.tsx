import { Bell, LogOut, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearAuth } from "@/store/authSlice";
import { authApi } from "@/api/domains/auth";
import { useNotificationUnreadCount } from "@/hooks/notifications/useNotificationUnreadCount";
import { disconnectAllRealtimeSockets } from "@/lib/realtimeSockets";

const getInitials = (name?: string, email?: string) => {
  if (name) {
    return name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase())
      .join("")
      .slice(0, 2);
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return "SA";
};

const routeLabels: Array<{ match: RegExp; title: string; eyebrow: string }> = [
  { match: /^\/dashboard/, title: "Operations dashboard", eyebrow: "Fleet overview" },
  { match: /^\/media/, title: "Media library", eyebrow: "Assets and readiness" },
  { match: /^\/layouts/, title: "Layouts", eyebrow: "Screen compositions" },
  { match: /^\/screens/, title: "Screens", eyebrow: "Player health and pairing" },
  { match: /^\/schedule/, title: "Schedule queue", eyebrow: "Publishing operations" },
  { match: /^\/requests/, title: "Requests", eyebrow: "Emergency and approvals" },
  { match: /^\/chat|^\/conversations/, title: "Conversations", eyebrow: "Team communication" },
  { match: /^\/notifications/, title: "Notifications", eyebrow: "Attention queue" },
  { match: /^\/operators/, title: "Operators", eyebrow: "Operational access" },
  { match: /^\/departments/, title: "Departments", eyebrow: "Organization routing" },
  { match: /^\/users/, title: "Users", eyebrow: "Account management" },
  { match: /^\/reports|^\/proof-of-play/, title: "Reports & logs", eyebrow: "Evidence and audit" },
  { match: /^\/settings|^\/api-keys|^\/webhooks|^\/sso-config/, title: "Site settings", eyebrow: "Platform configuration" },
];

const getRouteLabel = (pathname: string) =>
  routeLabels.find((item) => item.match.test(pathname)) ?? {
    title: "DARSHAN",
    eyebrow: "Operations console",
  };

export function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const user = useAppSelector((state) => state.auth.user);
  const { unreadTotal, isLoadingInitial } = useNotificationUnreadCount();
  const routeLabel = getRouteLabel(location.pathname);

  const handleLogout = async () => {
    disconnectAllRealtimeSockets();
    dispatch(clearAuth());
    await queryClient.cancelQueries();
    queryClient.clear();
    navigate("/login", { replace: true });

    void authApi.logout().catch(() => undefined);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-card/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/75">
      <div className="flex min-h-16 flex-wrap items-center gap-3 px-3 py-2 sm:px-5">
        <SidebarTrigger />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 lg:flex-nowrap">
          <div className="order-2 flex min-w-0 flex-1 items-center gap-3 lg:order-1">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
              <Radio className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {routeLabel.eyebrow}
              </p>
              <h1 className="truncate text-lg font-semibold leading-tight text-foreground sm:text-xl">
                {routeLabel.title}
              </h1>
            </div>
          </div>

          <div className="order-1 ml-auto flex shrink-0 items-center gap-2 lg:order-2">
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label="Open notifications"
              onClick={() => navigate("/notifications")}
            >
              <Bell className="h-5 w-5" />
              {!isLoadingInitial && unreadTotal > 0 ? (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 min-w-5 rounded-full px-1 flex items-center justify-center text-[10px]"
                >
                  {unreadTotal > 99 ? "99+" : unreadTotal}
                </Badge>
              ) : null}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="min-w-0 gap-2 px-2 sm:px-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {getInitials(
                        `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim(),
                        user?.email,
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden min-w-0 md:flex flex-col items-start text-xs">
                    <span className="max-w-[12rem] truncate font-medium lg:max-w-[16rem]">
                      {user
                        ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() ||
                          "Signed in"
                        : "Super Admin"}
                    </span>
                    <span className="max-w-[12rem] truncate text-muted-foreground lg:max-w-[16rem]">
                      {user?.email ?? "admin@darshan.com"}
                    </span>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Bell className="mr-2 h-4 w-4" />
                  Notifications
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={() => { void handleLogout(); }}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
