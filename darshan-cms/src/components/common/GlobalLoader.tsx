import { useEffect, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";

export function GlobalLoader() {
  const isMutating = useIsMutating();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isMutating) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 300);
    return () => window.clearTimeout(timer);
  }, [isMutating]);

  if (!visible) return null;

  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 h-0.5 bg-primary/70">
      <span className="sr-only">Working…</span>
    </div>
  );
}
