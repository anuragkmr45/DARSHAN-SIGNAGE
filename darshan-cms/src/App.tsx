import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/api/queryClient";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { GlobalLoader } from "@/components/common/GlobalLoader";
import { ProductionSecurityBoundary } from "@/components/security/ProductionSecurityBoundary";
import { AuthSessionBootstrap } from "@/components/auth/AuthSessionBootstrap";
import Home from "./pages/Home";
import Auth from "./pages/Auth";
import ActivateInvite from "./pages/ActivateInvite";

const AuthenticatedAppShell = lazy(() => import("./AuthenticatedAppShell"));

const AppRoutes = () => (
  <BrowserRouter>
    <GlobalLoader />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Auth />} />
      <Route path="/activate" element={<ActivateInvite />} />
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
          <AuthSessionBootstrap>
            <AppRoutes />
          </AuthSessionBootstrap>
        </ProductionSecurityBoundary>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
