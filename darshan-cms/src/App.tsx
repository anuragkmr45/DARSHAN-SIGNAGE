import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { GlobalLoader } from "@/components/common/GlobalLoader";
import { ProductionSecurityBoundary } from "@/components/security/ProductionSecurityBoundary";
import Home from "./pages/Home";
import Auth from "./pages/Auth";

const AuthenticatedAppShell = lazy(() => import("./AuthenticatedAppShell"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, gcTime: 300_000, refetchOnWindowFocus: false, retry: 1 },
    mutations: { retry: 1 },
  },
});

const AppRoutes = () => (
  <BrowserRouter>
    <GlobalLoader />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Auth />} />
      <Route
        path="/*"
        element={
          <Suspense
            fallback={
              <div aria-busy="true" className="flex min-h-screen items-center justify-center text-sm text-muted-foreground" role="status">
                Loading workspace…
              </div>
            }
          >
            <AuthenticatedAppShell />
          </Suspense>
        }
      />
    </Routes>
  </BrowserRouter>
);

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
