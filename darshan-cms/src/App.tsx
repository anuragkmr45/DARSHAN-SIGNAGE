import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { GlobalLoader } from "@/components/common/GlobalLoader";
import { ProductionSecurityBoundary } from "@/components/security/ProductionSecurityBoundary";
import { AuthSessionBootstrap } from "@/components/auth/AuthSessionBootstrap";
import Home from "./pages/Home";
import Auth from "./pages/Auth";
import ActivateInvitation from "./pages/ActivateInvitation";

const AuthenticatedAppShell = lazy(() => import("./AuthenticatedAppShell"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, gcTime: 300_000, refetchOnWindowFocus: false, retry: 1 },
    mutations: { retry: 1 },
  },
});

const AppRouterFrame = () => (
  <>
    <GlobalLoader />
    <Outlet />
  </>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppRouterFrame />,
    children: [
      { index: true, element: <Home /> },
      { path: "login", element: <Auth /> },
      { path: "activate", element: <ActivateInvitation /> },
      {
        path: "*",
        element: (
          <Suspense
            fallback={
              <div aria-busy="true" className="flex min-h-screen items-center justify-center text-sm text-muted-foreground" role="status">
                Loading workspace…
              </div>
            }
          >
            <AuthenticatedAppShell />
          </Suspense>
        ),
      },
    ],
  },
]);

const AppRoutes = () => <RouterProvider router={router} />;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <ProductionSecurityBoundary queryClient={queryClient}>
          <AuthSessionBootstrap>
            <AppRoutes />
          </AuthSessionBootstrap>
        </ProductionSecurityBoundary>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
