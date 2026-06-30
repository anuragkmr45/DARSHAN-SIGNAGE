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
          className={`mx-2 mt-2 flex items-center rounded-xl px-3 py-4 sm:px-4 ${isCollapsed ? "justify-center" : "gap-3"}`}
        >
          {branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt={branding.app_name}
              className={`${isCollapsed ? "h-8 w-8" : "h-10 w-10"} object-contain`}
            />
          ) : (
            <div
              className={`${isCollapsed ? "h-8 w-8" : "h-10 w-10"} flex items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm`}
            >
              <span className="text-sm font-black tracking-wide">
                {(branding?.app_name ?? "D").slice(0, 1)}
              </span>
            </div>
          )}
          {!isCollapsed && (
            <div className="flex min-w-0 flex-col">
              <span
                className="truncate text-lg font-black tracking-[0.08em]"
                style={{ color: "hsl(var(--sidebar-primary))" }}
              >
                {branding?.app_name ?? "DARSHAN"}
              </span>
              <span className="truncate text-xs text-sidebar-foreground/70">
                Operations console · {user?.role ?? "User"}
              </span>
            </div>
          )}
        </div>

        {visibleNavSections.map((section) => (
          <SidebarGroup key={section.label} className={cn(isCollapsed && "px-2")}>
            {!isCollapsed ? (
              <SidebarGroupLabel className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-sidebar-foreground/50">
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
                            "group relative flex min-w-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-foreground font-semibold shadow-sm"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span
                              className={cn(
                                "absolute left-1 h-5 w-1 rounded-full bg-sidebar-primary transition-all duration-200",
                                isActive ? "opacity-100" : "opacity-0",
                              )}
                            />
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

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Help & Documentation">
                  <a
                    href="#"
                    className="mx-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  >
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
