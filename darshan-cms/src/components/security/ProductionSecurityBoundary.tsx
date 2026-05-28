import { PropsWithChildren, useEffect, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { ShieldAlert, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { disconnectScreensSocket } from "@/lib/screensSocket";
import { disconnectNotificationsSocket } from "@/lib/notificationsSocket";
import { disconnectChatSocket } from "@/lib/chatSocket";
import { securityApi } from "@/api/domains/security";

const DEVTOOLS_THRESHOLD_PX = 160;
const DEVTOOLS_CHECK_INTERVAL_MS = 1200;

const isProductionLockdownEnabled =
  import.meta.env.PROD && import.meta.env.VITE_ENABLE_PRODUCTION_LOCKDOWN !== "false";

const isLikelyDevtoolsOpen = () => {
  if (typeof window === "undefined") return false;
  const widthDelta = Math.abs(window.outerWidth - window.innerWidth);
  const heightDelta = Math.abs(window.outerHeight - window.innerHeight);
  return widthDelta > DEVTOOLS_THRESHOLD_PX || heightDelta > DEVTOOLS_THRESHOLD_PX;
};

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
  <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-slate-950 text-slate-50">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_35%),radial-gradient(circle_at_bottom,rgba(239,68,68,0.18),transparent_30%)]" />
    <div className="relative mx-6 w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-900/90 p-10 shadow-2xl backdrop-blur">
      <div className="mb-8 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 text-red-300">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-red-300/80">Production Lock</p>
          <h1 className="text-3xl font-semibold text-white">Inspection tools are blocked on this system</h1>
        </div>
      </div>

      <div className="space-y-4 text-sm leading-7 text-slate-300">
        <p>
          Developer tools, inspection shortcuts, and the browser context menu are disabled in the
          production CMS environment.
        </p>
        <p>
          Close any open inspection tools and reload this page to continue. This event may be
          recorded for audit review.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/70 px-5 py-4 text-sm text-slate-300">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Detected trigger</div>
          <div className="mt-1 font-medium text-slate-100">{trigger}</div>
        </div>
        <Button
          type="button"
          className="gap-2 bg-red-500 text-white hover:bg-red-400"
          onClick={() => window.location.reload()}
        >
          <RefreshCcw className="h-4 w-4" />
          Reload Page
        </Button>
      </div>
    </div>
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

    const handleResize = () => {
      if (!isLikelyDevtoolsOpen()) return;
      handleSecurityTrigger("devtools viewport heuristic");
    };

    const intervalId = window.setInterval(() => {
      if (!isLikelyDevtoolsOpen()) return;
      handleSecurityTrigger("devtools polling heuristic");
    }, DEVTOOLS_CHECK_INTERVAL_MS);

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("resize", handleResize, true);
    handleResize();

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
    disconnectScreensSocket();
    disconnectNotificationsSocket();
    disconnectChatSocket();
  }, [lockState.locked, queryClient]);

  if (!isProductionLockdownEnabled) {
    return <>{children}</>;
  }

  if (lockState.locked) {
    return <LockScreen trigger={lockState.trigger} />;
  }

  return <>{children}</>;
};
