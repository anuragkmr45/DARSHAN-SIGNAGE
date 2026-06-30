import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ThemeProvider } from "@/components/theme-provider";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { GlobalLoader } from "@/components/common/GlobalLoader";
import { AppSettingsBootstrap } from "@/components/settings/AppSettingsBootstrap";
import { ProductionSecurityBoundary } from "@/components/security/ProductionSecurityBoundary";
import Home from "./pages/Home";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import ScheduleQueue from "./pages/ScheduleQueue";
import ScheduleCreator from "./pages/ScheduleCreator";
import Departments from "./pages/Departments";
import Conversations from "./pages/Conversations";
import Screens from "./pages/Screens";
import MediaLibrary from "./pages/MediaLibrary";
import Requests from "./pages/Requests";
import Operators from "./pages/Operators";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import ApiKeys from "./pages/ApiKeys";
import Webhooks from "./pages/Webhooks";
import SsoConfig from "./pages/SsoConfig";
import ProofOfPlay from "./pages/ProofOfPlay";
import NotFound from "./pages/NotFound";
import Users from "./pages/Users";
import Layouts from "./pages/Layouts";
import LayoutEditor from "./pages/LayoutEditor";
import Notifications from "./pages/Notifications";
import { useAppearanceSettings } from "@/hooks/useSettingsApi";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache for 5 minutes, avoid rapid refetches, and dedupe in-flight requests.
      staleTime: 60_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 1,
    },
  },
});

const AuthenticatedAppShell = () => {
  const { data: appearance } = useAppearanceSettings();
  const sidebarDefaultOpen =
    appearance?.sidebar_mode === "collapsed" ? false : true;

  return (
    <ProtectedRoute>
      <AppSettingsBootstrap />
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <div className="operational-shell flex min-h-screen w-full bg-background">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppHeader />
            <main className="flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-7">
              <Routes>
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute moduleKey="dashboard">
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/schedule"
                  element={
                    <ProtectedRoute moduleKey="schedule">
                      <ScheduleQueue />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/schedule/new"
                  element={
                    <ProtectedRoute moduleKey="schedule">
                      <ScheduleCreator />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/layouts"
                  element={
                    <ProtectedRoute moduleKey="layouts">
                      <Layouts />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/layouts/new"
                  element={
                    <ProtectedRoute moduleKey="layouts">
                      <LayoutEditor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/layouts/:id"
                  element={
                    <ProtectedRoute moduleKey="layouts">
                      <LayoutEditor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/requests"
                  element={
                    <ProtectedRoute requirePermissions={[{ action: "read", subject: "Request" }]}>
                      <Requests />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/departments"
                  element={
                    <ProtectedRoute moduleKey="departments">
                      <Departments />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/operators"
                  element={
                    <ProtectedRoute moduleKey="operators">
                      <Operators />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/users"
                  element={
                    <ProtectedRoute moduleKey="users">
                      <Users />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/chat"
                  element={
                    <ProtectedRoute moduleKey="conversations">
                      <Conversations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/chat/:conversationId"
                  element={
                    <ProtectedRoute moduleKey="conversations">
                      <Conversations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/chat/:conversationId/thread/:threadRootId"
                  element={
                    <ProtectedRoute moduleKey="conversations">
                      <Conversations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/conversations"
                  element={
                    <ProtectedRoute moduleKey="conversations">
                      <Conversations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/conversations/:conversationId"
                  element={
                    <ProtectedRoute moduleKey="conversations">
                      <Conversations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/conversations/:conversationId/thread/:threadRootId"
                  element={
                    <ProtectedRoute moduleKey="conversations">
                      <Conversations />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/notifications"
                  element={
                    <ProtectedRoute moduleKey="notifications">
                      <Notifications />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/screens"
                  element={
                    <ProtectedRoute moduleKey="screens">
                      <Screens />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/media"
                  element={
                    <ProtectedRoute moduleKey="media">
                      <MediaLibrary />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <ProtectedRoute moduleKey="reports">
                      <Reports />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute moduleKey="settings">
                      <Settings />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/api-keys"
                  element={
                    <ProtectedRoute requirePermissions={[{ action: "read", subject: "ApiKey" }]}>
                      <ApiKeys />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/webhooks"
                  element={
                    <ProtectedRoute requirePermissions={[{ action: "read", subject: "Webhook" }]}>
                      <Webhooks />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/sso-config"
                  element={
                    <ProtectedRoute requirePermissions={[{ action: "read", subject: "SsoConfig" }]}>
                      <SsoConfig />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/proof-of-play"
                  element={
                    <ProtectedRoute
                      requirePermissions={[
                        { action: "read", subject: "ProofOfPlay" },
                        { action: "read", subject: "Report" },
                      ]}
                    >
                      <ProofOfPlay />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </ProtectedRoute>
  );
};

const AppRoutes = () => {
  return (
    <BrowserRouter>
      <GlobalLoader />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Auth />} />
        <Route path="/*" element={<AuthenticatedAppShell />} />
      </Routes>
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <ProductionSecurityBoundary queryClient={queryClient}>
          <AppRoutes />
        </ProductionSecurityBoundary>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
