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
      return true;
    },
  });
}
