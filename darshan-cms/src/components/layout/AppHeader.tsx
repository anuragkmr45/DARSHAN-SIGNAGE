import { Bell, Search, LogOut } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearAuth } from "@/store/authSlice";
import { authApi } from "@/api/domains/auth";
import { useNotificationUnreadCount } from "@/hooks/notifications/useNotificationUnreadCount";

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

export function AppHeader() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const user = useAppSelector((state) => state.auth.user);
  const { unreadTotal, isLoadingInitial } = useNotificationUnreadCount();

  const handleLogout = async () => {
    dispatch(clearAuth());
    await queryClient.cancelQueries();
    queryClient.clear();
    navigate("/login", { replace: true });

    void authApi.logout().catch(() => undefined);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex min-h-16 flex-wrap items-center gap-3 px-3 py-2 sm:px-4">
        <SidebarTrigger />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 lg:flex-nowrap">
          <div className="order-2 relative w-full min-w-0 lg:order-1 lg:max-w-2xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Global search unavailable"
              title="Global search is not available in this build."
              placeholder="Global search unavailable in this build"
              className="h-10 pl-9 bg-muted/50"
              disabled
              readOnly
            />
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
