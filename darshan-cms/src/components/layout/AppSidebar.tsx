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
  PanelsTopLeft,
  BellRing,
  Radio,
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
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    label: "Operate",
    items: [
      {
        title: "Dashboard",
        url: "/dashboard",
        icon: LayoutDashboard,
        moduleKey: "dashboard",
      },
      {
        title: "Screens",
        url: "/screens",
        icon: Monitor,
        moduleKey: "screens",
      },
      {
        title: "Schedule Queue",
        url: "/schedule",
        icon: Calendar,
        moduleKey: "schedule",
      },
    ],
  },
  {
    label: "Create",
    items: [
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
      { title: "Live broadcasts", url: "/live-broadcasts", icon: Radio, moduleKey: "live" },
    ],
  },
  {
    label: "Communicate",
    items: [
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
    ],
  },
  {
    label: "Admin & Evidence",
    items: [
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
      { title: "API Keys", url: "/api-keys", icon: Settings, permissions: [{ action: "read", subject: "ApiKey" }] },
      { title: "Webhooks", url: "/webhooks", icon: Settings, permissions: [{ action: "read", subject: "Webhook" }] },
      { title: "Proof of Play", url: "/proof-of-play", icon: FileBarChart, permissions: [{ action: "read", subject: "ProofOfPlay" }, { action: "read", subject: "Report" }] },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { can, isLoading: isAuthzLoading } = useAuthorization();
  const user = useAppSelector((appState) => appState.auth.user);
  const { data: branding } = useBrandingSettings();

  const canShowItem = (item: NavItem) => {
    if (item.moduleKey) {
      if (isAuthzLoading) return false;
      return canAccessModule(item.moduleKey, user ?? undefined, can);
    }
    if (!item.permissions?.length) return true;
    if (isAuthzLoading) return false;
    const requireAny = item.requireAny ?? true;
    return requireAny
      ? item.permissions.some((perm) => can(perm.action, perm.subject))
      : item.permissions.every((perm) => can(perm.action, perm.subject));
  };

  const visibleNavSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter(canShowItem),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <SidebarContent>
        <div
          className={`mx-2 mt-2 flex items-center border-b border-sidebar-border px-2 py-3 sm:px-3 ${isCollapsed ? "justify-center" : "gap-3"}`}
        >
          {branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt={branding.app_name}
              className="h-8 w-8 object-contain"
            />
          ) : (
            <img src="/darshan-mark.svg" alt="" className="h-8 w-8" />
          )}
          {!isCollapsed && (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-sidebar-foreground">
                {branding?.app_name ?? "DARSHAN"}
              </span>
              <span className="truncate text-xs text-sidebar-foreground/60">{user?.role ?? "User"}</span>
            </div>
          )}
        </div>

        {visibleNavSections.map((section) => (
          <SidebarGroup key={section.label} className={cn(isCollapsed && "px-2")}>
            {!isCollapsed ? (
              <SidebarGroupLabel className="text-[0.68rem] font-medium text-sidebar-foreground/60">
                {section.label}
              </SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        className={({ isActive }) =>
                          cn(
                            "group relative flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon
                              className={cn(
                                "h-4 w-4 shrink-0 transition-colors",
                                isActive
                                  ? "text-sidebar-primary"
                                  : "text-sidebar-foreground/70",
                              )}
                            />
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
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
