import { useQuery } from "@tanstack/react-query";
import { Activity, Clock3, HardDrive, Server, Thermometer, Wifi } from "lucide-react";
import { observabilityApi } from "@/api/domains/observability";
import { queryKeys } from "@/api/queryKeys";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMaskedScreenId } from "@/lib/screens";
import { formatBytes, formatPercent, formatRelativeTimestamp, getMachineStatusTone } from "@/lib/observability";

interface ScreenHealthDashboardProps {
  screenId: string;
  screenName: string;
}

export function ScreenHealthDashboard({ screenId, screenName }: ScreenHealthDashboardProps) {
  const observabilityQuery = useQuery({
    queryKey: queryKeys.observabilityScreen(screenId),
    queryFn: () => observabilityApi.getScreen(screenId),
  });

  const summary = observabilityQuery.data;

  if (observabilityQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (observabilityQuery.isError || !summary) {
    return (
      <Card className="p-6">
        <p className="font-medium">Observability details unavailable</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The backend observability summary could not be loaded for this screen.
        </p>
      </Card>
    );
  }

  const playerMetrics = summary.latest_player_metrics;
  const scrapeTone =
    summary.player_scrape.status === "up"
      ? "healthy"
      : summary.player_scrape.status === "down"
        ? "critical"
        : summary.player_scrape.configured
          ? "unknown"
          : "unconfigured";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Observability: {screenName}</h2>
          <p className="text-sm text-muted-foreground">{formatMaskedScreenId(screenId)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={getMachineStatusTone(scrapeTone)}>
            Player scrape {summary.player_scrape.status}
          </Badge>
          <Badge variant="outline">
            Health {summary.screen.health_state ?? "unknown"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-700">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">CPU</p>
              <p className="text-xl font-semibold">{formatPercent(playerMetrics.cpu_percent, 1)}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-sky-500/10 p-2 text-sky-700">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Memory</p>
              <p className="text-sm font-semibold">
                {formatBytes(playerMetrics.memory_used_bytes)} / {formatBytes(playerMetrics.memory_total_bytes)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-700">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Disk</p>
              <p className="text-sm font-semibold">
                {formatBytes(playerMetrics.disk_used_bytes)} / {formatBytes(playerMetrics.disk_total_bytes)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/10 p-2 text-orange-700">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Queue backlog</p>
              <p className="text-xl font-semibold">{summary.latest_player_metrics.request_queue_items ?? "—"}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-3">
          <h3 className="font-semibold">Current Player State</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Backend heartbeat</p>
              <p className="text-sm font-medium">{formatRelativeTimestamp(summary.screen.last_backend_heartbeat_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Player heartbeat</p>
              <p className="text-sm font-medium">
                {formatRelativeTimestamp(summary.player_scrape.last_successful_player_heartbeat_at)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Queue oldest age</p>
              <p className="text-sm font-medium">
                {summary.latest_player_metrics.request_queue_oldest_age_seconds !== null &&
                summary.latest_player_metrics.request_queue_oldest_age_seconds !== undefined
                  ? `${summary.latest_player_metrics.request_queue_oldest_age_seconds.toFixed(0)}s`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Displays</p>
              <p className="text-sm font-medium">{summary.latest_player_metrics.display_count ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cache</p>
              <p className="text-sm font-medium">
                {formatBytes(summary.latest_player_metrics.cache_used_bytes)} / {formatBytes(summary.latest_player_metrics.cache_total_bytes)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last schedule sync</p>
              <p className="text-sm font-medium">{formatRelativeTimestamp(summary.latest_player_metrics.last_schedule_sync_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Temperature</p>
              <p className="text-sm font-medium">
                {summary.latest_player_metrics.temperature_celsius !== null &&
                summary.latest_player_metrics.temperature_celsius !== undefined
                  ? `${summary.latest_player_metrics.temperature_celsius.toFixed(1)} °C`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Battery / power</p>
              <p className="text-sm font-medium">
                {summary.latest_player_metrics.battery_percent !== null &&
                summary.latest_player_metrics.battery_percent !== undefined
                  ? `${summary.latest_player_metrics.battery_percent.toFixed(0)}%`
                  : "—"}
                {summary.latest_player_metrics.power_connected === null
                  ? ""
                  : summary.latest_player_metrics.power_connected
                    ? " · AC/charging"
                    : " · battery"}
              </p>
            </div>
          </div>

          {summary.screen.health_reason ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <p className="font-medium">Current health reason</p>
              <p className="mt-1 text-muted-foreground">{summary.screen.health_reason}</p>
            </div>
          ) : null}
        </Card>

        <Card className="p-4 space-y-3">
          <h3 className="font-semibold">Historical Drill-down</h3>
          <p className="text-sm text-muted-foreground">
            Current values above are CMS-native summaries. Use Grafana for historical trends and scrape diagnostics.
          </p>
          <div className="flex flex-wrap gap-2">
            {summary.grafana.links.map((link) => (
              <Button
                key={link.label}
                variant="outline"
                size="sm"
                onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}
              >
                {link.label}
              </Button>
            ))}
          </div>

          <div className="rounded-lg border p-3 text-sm">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Clock3 className="h-4 w-4" />
              Backend telemetry payload
            </div>
            {summary.latest_backend_telemetry ? (
              <pre className="max-h-56 overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(summary.latest_backend_telemetry, null, 2)}
              </pre>
            ) : (
              <p className="text-muted-foreground">No backend telemetry payload stored for this screen yet.</p>
            )}
          </div>
        </Card>
      </div>

      {summary.grafana.enabled && summary.grafana.embed_enabled && summary.grafana.embed_url ? (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Thermometer className="h-4 w-4 text-primary" />
            <div>
              <p className="font-medium">Grafana trend view</p>
              <p className="text-xs text-muted-foreground">Historical player metrics over the same-origin Grafana path.</p>
            </div>
          </div>
          <iframe
            title={`Observability trends for ${screenName}`}
            src={summary.grafana.embed_url}
            className="h-[420px] w-full border-0"
            loading="lazy"
          />
        </Card>
      ) : null}
    </div>
  );
}
