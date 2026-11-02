import { useQuery } from "@tanstack/react-query";

export function useGrafanaAvailability(enabled: boolean) {
  return useQuery({
    queryKey: ["grafana", "health"],
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const response = await fetch("/grafana/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error(`Grafana proxy returned ${response.status}`);
      const health = await response.json() as { database?: string };
      if (health.database !== "ok") throw new Error("Grafana is not ready");
      // A proxy can answer /api/health while stripping Grafana's subpath.
      // Its login route then redirects back to itself forever.
      const login = await fetch("/grafana/login", { cache: "no-store", redirect: "manual" });
      if (!login.ok) throw new Error("Grafana login is not reachable through the CMS");
      return true;
    },
  });
}

export function useGrafanaAuthentication(enabled: boolean) {
  return useQuery({
    queryKey: ["grafana", "authenticated"],
    enabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch("/grafana/api/user", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) return false;
      if (!response.ok) throw new Error(`Grafana session check returned ${response.status}`);
      return true;
    },
  });
}
