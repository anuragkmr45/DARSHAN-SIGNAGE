import {
  LayoutDashboard,
  Calendar,
  Building2,
  Users,
  Kanban,
  Monitor,
  FolderOpen,
  FileBarChart,
  Settings,
  HelpCircle,
  PanelsTopLeft,
  BellRing,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useAppSelector } from "@/store/hooks";
import { canAccessModule, type ModuleKey } from "@/lib/access";
import { useBrandingSettings } from "@/hooks/useSettingsApi";

type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  moduleKey?: ModuleKey;
  permissions?: Array<{ action: string; subject: string }>;
  requireAny?: boolean;
  allowRoles?: string[];
};

const navItems: NavItem[] = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
    moduleKey: "dashboard",
  },
  {
    title: "Media Library",
    url: "/media",
    icon: FolderOpen,
    moduleKey: "media",
  },
  {
    title: "Layouts",
    url: "/layouts",
    icon: PanelsTopLeft,
    moduleKey: "layouts",
  },
  { title: "Screens", url: "/screens", icon: Monitor, moduleKey: "screens" },
  {
    title: "Schedule Queue",
    url: "/schedule",
    icon: Calendar,
    moduleKey: "schedule",
  },
  {
    title: "Conversations",
    url: "/chat",
    icon: Kanban,
    moduleKey: "conversations",
  },
  {
    title: "Notifications",
    url: "/notifications",
    icon: BellRing,
    moduleKey: "notifications",
  },
  {
    title: "Operators",
    url: "/operators",
    icon: Users,
    moduleKey: "operators",
  },
  {
    title: "Departments",
    url: "/departments",
    icon: Building2,
    moduleKey: "departments",
  },
  { title: "Users", url: "/users", icon: Users, moduleKey: "users" },
  {
    title: "Reports & Logs",
    url: "/reports",
    icon: FileBarChart,
    moduleKey: "reports",
  },
  {
    title: "Site Settings",
    url: "/settings",
    icon: Settings,
    moduleKey: "settings",
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { can, isLoading: isAuthzLoading } = useAuthorization();
  const user = useAppSelector((appState) => appState.auth.user);
  const { data: branding } = useBrandingSettings();

  const visibleNavItems = navItems.filter((item) => {
    if (item.moduleKey) {
      if (isAuthzLoading) return false;
      return canAccessModule(item.moduleKey, user ?? undefined, can);
    }
    if (
      item.allowRoles?.length &&
      user?.role &&
      item.allowRoles.includes(user.role)
    )
      return true;
    if (!item.permissions?.length) return true;
    if (isAuthzLoading) return false;
    const requireAny = item.requireAny ?? true;
    return requireAny
      ? item.permissions.some((perm) => can(perm.action, perm.subject))
      : item.permissions.every((perm) => can(perm.action, perm.subject));
  });

  return (
    <Sidebar
      collapsible="icon"
      className="border-r bg-sidebar text-sidebar-foreground"
    >
      <SidebarContent>
        <div
          className={`flex items-center px-3 py-5 sm:px-4 sm:py-6 ${isCollapsed ? "justify-center" : "gap-3"}`}
        >
          {branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt={branding.app_name}
              className={`${isCollapsed ? "h-8 w-8" : "h-10 w-10"} object-contain`}
            />
          ) : (
            <div
              className={`${isCollapsed ? "h-8 w-8" : "h-10 w-10"} rounded-xl bg-primary/15 flex items-center justify-center text-primary font-semibold`}
            >
              {(branding?.app_name ?? "S").slice(0, 1)}
            </div>
          )}
          {!isCollapsed && (
            <div className="flex min-w-0 flex-col">
              <span
                className="truncate text-lg font-bold"
                style={{ color: "hsl(var(--sidebar-primary))" }}
              >
                {branding?.app_name ?? "Signhex"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {user?.role ?? "User"}
              </span>
            </div>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>Main Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className={({ isActive }) =>
                        cn(
                          "group flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-200",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-foreground font-semibold"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/70",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={cn(
                              "h-6 w-1 shrink-0 rounded-full bg-sidebar-foreground transition-all duration-200",
                              isActive ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.title}</span>
                        </>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Help & Documentation">
                  <a href="#" className="text-muted-foreground">
                    <HelpCircle className="h-4 w-4" />
                    <span>Help & Docs</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
