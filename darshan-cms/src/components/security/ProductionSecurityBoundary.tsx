import { PropsWithChildren, useEffect, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { ShieldAlert, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { disconnectAllRealtimeSockets } from "@/lib/realtimeSockets";
import { securityApi } from "@/api/domains/security";
import {
  isLikelyDevtoolsViewportJump,
  lowerViewportBaseline,
  readViewportDelta,
  type ViewportDelta,
} from "./productionSecurityViewport";

const DEVTOOLS_CHECK_INTERVAL_MS = 1200;

const isProductionLockdownEnabled =
  import.meta.env.PROD && import.meta.env.VITE_ENABLE_PRODUCTION_LOCKDOWN !== "false";

const isBlockedShortcut = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase();
  if (key === "f12") return true;
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && ["i", "j", "c"].includes(key)) return true;
  if (event.metaKey && event.altKey && ["i", "j", "c"].includes(key)) return true;
  return false;
};

type LockScreenProps = {
  trigger: string;
};

const LockScreen = ({ trigger }: LockScreenProps) => (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-auto bg-background p-5 text-foreground">
    <section aria-labelledby="production-lock-title" className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 sm:p-10">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <ShieldAlert aria-hidden="true" className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Production lock</p>
          <h1 id="production-lock-title" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Inspection tools are blocked on this system
          </h1>
        </div>
      </div>

      <div className="mt-6 space-y-3 text-sm leading-6 text-muted-foreground">
        <p>Developer tools, inspection shortcuts, and the browser context menu are disabled in the production CMS environment.</p>
        <p>Close any open inspection tools and reload this page to continue. This event may be recorded for audit review.</p>
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5 text-sm">
        <p className="text-muted-foreground">Detected trigger: <strong className="font-medium text-foreground">{trigger}</strong></p>
        <Button type="button" className="gap-2" onClick={() => window.location.reload()}>
          <RefreshCcw aria-hidden="true" className="h-4 w-4" />
          Reload page
        </Button>
      </div>
    </section>
  </div>
);

type ProductionSecurityBoundaryProps = PropsWithChildren<{
  queryClient: QueryClient;
}>;

export const ProductionSecurityBoundary = ({
  queryClient,
  children,
}: ProductionSecurityBoundaryProps) => {
  const [lockState, setLockState] = useState<{ locked: boolean; trigger: string }>({
    locked: false,
    trigger: "security policy",
  });
  const reportedRef = useRef(false);
  const viewportBaselineRef = useRef<ViewportDelta | null>(null);

  useEffect(() => {
    if (!isProductionLockdownEnabled || lockState.locked) return;

    const activateLock = (trigger: string) => {
      setLockState((current) => {
        if (current.locked) return current;
        return { locked: true, trigger };
      });
    };

    const reportAttempt = (trigger: string) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      void securityApi.reportClientEvent({
        event: "CMS_DEVTOOLS_ATTEMPT",
        context: {
          trigger,
          route:
            typeof window !== "undefined"
              ? `${window.location.pathname}${window.location.search}`
              : "/",
          detected_at: new Date().toISOString(),
          width_delta:
            typeof window !== "undefined" ? Math.abs(window.outerWidth - window.innerWidth) : 0,
          height_delta:
            typeof window !== "undefined" ? Math.abs(window.outerHeight - window.innerHeight) : 0,
        },
      }).catch(() => undefined);
    };

    const handleSecurityTrigger = (trigger: string) => {
      reportAttempt(trigger);
      activateLock(trigger);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isBlockedShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      handleSecurityTrigger("inspection shortcut");
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      handleSecurityTrigger("context menu");
    };

    const inspectViewport = (trigger: string) => {
      const current = readViewportDelta(window);
      const baseline = viewportBaselineRef.current;
      if (!baseline) {
        viewportBaselineRef.current = current;
        return;
      }
      if (isLikelyDevtoolsViewportJump(baseline, current)) {
        handleSecurityTrigger(trigger);
        return;
      }
      viewportBaselineRef.current = lowerViewportBaseline(baseline, current);
    };

    const handleResize = () => {
      inspectViewport("devtools viewport heuristic");
    };

    const intervalId = window.setInterval(() => {
      inspectViewport("devtools polling heuristic");
    }, DEVTOOLS_CHECK_INTERVAL_MS);

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("resize", handleResize, true);
    viewportBaselineRef.current = readViewportDelta(window);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("resize", handleResize, true);
    };
  }, [lockState.locked, queryClient]);

  useEffect(() => {
    if (!lockState.locked) return;
    void queryClient.cancelQueries();
    disconnectAllRealtimeSockets();
  }, [lockState.locked, queryClient]);

  if (!isProductionLockdownEnabled) {
    return <>{children}</>;
  }

  if (lockState.locked) {
    return <LockScreen trigger={lockState.trigger} />;
  }

  return <>{children}</>;
};
