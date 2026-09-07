import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppSettingsBootstrap } from "@/components/settings/AppSettingsBootstrap";
import { useAppearanceSettings } from "@/hooks/useSettingsApi";
import NotFound from "./pages/NotFound";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ScheduleQueue = lazy(() => import("./pages/ScheduleQueue"));
const ScheduleCreator = lazy(() => import("./pages/ScheduleCreator"));
const Departments = lazy(() => import("./pages/Departments"));
const Conversations = lazy(() => import("./pages/Conversations"));
const Screens = lazy(() => import("./pages/Screens"));
const MediaLibrary = lazy(() => import("./pages/MediaLibrary"));
const Requests = lazy(() => import("./pages/Requests"));
const Operators = lazy(() => import("./pages/Operators"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const ApiKeys = lazy(() => import("./pages/ApiKeys"));
const Webhooks = lazy(() => import("./pages/Webhooks"));
const SsoConfig = lazy(() => import("./pages/SsoConfig"));
const ProofOfPlay = lazy(() => import("./pages/ProofOfPlay"));
const Users = lazy(() => import("./pages/Users"));
const Layouts = lazy(() => import("./pages/Layouts"));
const LayoutEditor = lazy(() => import("./pages/LayoutEditor"));
const Notifications = lazy(() => import("./pages/Notifications"));

const RouteLoadingFallback = () => (
  <div aria-busy="true" aria-live="polite" className="flex min-h-[12rem] items-center justify-center text-sm text-muted-foreground" role="status">
    Loading workspace…
  </div>
);

export default function AuthenticatedAppShell() {
  const { data: appearance } = useAppearanceSettings();
  const sidebarDefaultOpen = appearance?.sidebar_mode !== "collapsed";

  return (
    <ProtectedRoute>
      <AppSettingsBootstrap />
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <div className="operational-shell flex min-h-screen w-full bg-background">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppHeader />
            <main className="flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-7">
              <Suspense fallback={<RouteLoadingFallback />}>
                <Routes>
                  <Route path="/dashboard" element={<ProtectedRoute moduleKey="dashboard"><Dashboard /></ProtectedRoute>} />
                  <Route path="/schedule" element={<ProtectedRoute moduleKey="schedule"><ScheduleQueue /></ProtectedRoute>} />
                  <Route path="/schedule/new" element={<ProtectedRoute moduleKey="schedule"><ScheduleCreator /></ProtectedRoute>} />
                  <Route path="/layouts" element={<ProtectedRoute moduleKey="layouts"><Layouts /></ProtectedRoute>} />
                  <Route path="/layouts/new" element={<ProtectedRoute moduleKey="layouts"><LayoutEditor /></ProtectedRoute>} />
                  <Route path="/layouts/:id" element={<ProtectedRoute moduleKey="layouts"><LayoutEditor /></ProtectedRoute>} />
                  <Route path="/requests" element={<ProtectedRoute requirePermissions={[{ action: "read", subject: "Request" }]}><Requests /></ProtectedRoute>} />
                  <Route path="/departments" element={<ProtectedRoute moduleKey="departments"><Departments /></ProtectedRoute>} />
                  <Route path="/operators" element={<ProtectedRoute moduleKey="operators"><Operators /></ProtectedRoute>} />
                  <Route path="/users" element={<ProtectedRoute moduleKey="users"><Users /></ProtectedRoute>} />
                  <Route path="/chat" element={<ProtectedRoute moduleKey="conversations"><Conversations /></ProtectedRoute>} />
                  <Route path="/chat/:conversationId" element={<ProtectedRoute moduleKey="conversations"><Conversations /></ProtectedRoute>} />
                  <Route path="/chat/:conversationId/thread/:threadRootId" element={<ProtectedRoute moduleKey="conversations"><Conversations /></ProtectedRoute>} />
                  <Route path="/conversations" element={<ProtectedRoute moduleKey="conversations"><Conversations /></ProtectedRoute>} />
                  <Route path="/conversations/:conversationId" element={<ProtectedRoute moduleKey="conversations"><Conversations /></ProtectedRoute>} />
                  <Route path="/conversations/:conversationId/thread/:threadRootId" element={<ProtectedRoute moduleKey="conversations"><Conversations /></ProtectedRoute>} />
                  <Route path="/notifications" element={<ProtectedRoute moduleKey="notifications"><Notifications /></ProtectedRoute>} />
                  <Route path="/screens" element={<ProtectedRoute moduleKey="screens"><Screens /></ProtectedRoute>} />
                  <Route path="/media" element={<ProtectedRoute moduleKey="media"><MediaLibrary /></ProtectedRoute>} />
                  <Route path="/reports" element={<ProtectedRoute moduleKey="reports"><Reports /></ProtectedRoute>} />
                  <Route path="/settings" element={<ProtectedRoute moduleKey="settings"><Settings /></ProtectedRoute>} />
                  <Route path="/api-keys" element={<ProtectedRoute requirePermissions={[{ action: "read", subject: "ApiKey" }]}><ApiKeys /></ProtectedRoute>} />
                  <Route path="/webhooks" element={<ProtectedRoute requirePermissions={[{ action: "read", subject: "Webhook" }]}><Webhooks /></ProtectedRoute>} />
                  <Route path="/sso-config" element={<ProtectedRoute requirePermissions={[{ action: "read", subject: "SsoConfig" }]}><SsoConfig /></ProtectedRoute>} />
                  <Route path="/proof-of-play" element={<ProtectedRoute requirePermissions={[{ action: "read", subject: "ProofOfPlay" }, { action: "read", subject: "Report" }]}><ProofOfPlay /></ProtectedRoute>} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </ProtectedRoute>
  );
}
