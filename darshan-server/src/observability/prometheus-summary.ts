import { URL } from 'node:url';
import { desc, eq, gte, sql } from 'drizzle-orm';
import { config as appConfig } from '@/config';
import { getDatabase, schema } from '@/db';
import { buildScreenPlaybackStateById } from '@/screens/playback';

type PrometheusMetric = Record<string, string>;

type PrometheusVectorResult = {
  metric: PrometheusMetric;
  value: [number | string, string];
};

type PrometheusResponse = {
  status: 'success' | 'error';
  data?: {
    resultType?: string;
    result?: PrometheusVectorResult[];
  };
};

type MachineDefinition = {
  id: string;
  name: string;
  role: 'data' | 'valkey' | 'backend' | 'cms' | 'observability' | 'development';
  dashboardUid: string;
  expectedJobs: string[];
  services: Array<{
    id: string;
    label: string;
    job: string;
  }>;
};

type ObservabilityStatus = 'healthy' | 'degraded' | 'critical' | 'unknown' | 'unconfigured';

export type ObservabilityGrafanaLink = {
  label: string;
  url: string;
};

export type MachineSummary = {
  id: string;
  name: string;
  role: MachineDefinition['role'];
  status: ObservabilityStatus;
  scrape_status: {
    reachable_targets: number;
    expected_targets: number;
  };
  resources: {
    cpu_percent: number | null;
    memory_percent: number | null;
    disk_percent: number | null;
  };
  services: Array<{
    id: string;
    label: string;
    status: 'up' | 'down' | 'unknown';
  }>;
  grafana: {
    dashboard_url: string | null;
  };
};

export type ObservabilityOverviewSummary = {
  generated_at: string;
  deployment_mode: 'development' | 'qa' | 'production';
  current_state_source: 'backend_and_prometheus';
  fleet: {
    total_players: number | null;
    online_players: number | null;
    active_players: number | null;
    inactive_players: number | null;
    offline_players: number | null;
    reachable_players: number | null;
    configured_player_targets: number | null;
  };
  alerts: {
    available: boolean;
    firing: number;
    highest_severity: 'critical' | 'warning' | 'info' | 'none' | 'unknown';
    status: ObservabilityStatus;
  };
  machines: MachineSummary[];
  grafana: {
    enabled: boolean;
    embed_enabled: boolean;
    base_path: string;
    links: {
      backend_service: string | null;
      players_fleet: string | null;
      machines: Record<string, string | null>;
    };
  };
};

export type ScreenObservabilitySummary = {
  generated_at: string;
  screen: {
    id: string;
    name: string;
    status: string;
    health_state: string | null;
    health_reason: string | null;
    last_backend_heartbeat_at: string | null;
  };
  player_scrape: {
    configured: boolean;
    status: 'up' | 'down' | 'unknown' | 'unconfigured' | 'unavailable';
    last_successful_player_heartbeat_at: string | null;
  };
  latest_player_metrics_source: 'prometheus' | 'backend_heartbeat' | 'mixed' | 'none';
  latest_player_metrics_observed_at: string | null;
  latest_player_metrics: {
    cpu_percent: number | null;
    memory_percent: number | null;
    memory_used_bytes: number | null;
    memory_total_bytes: number | null;
    disk_percent: number | null;
    disk_used_bytes: number | null;
    disk_total_bytes: number | null;
    temperature_celsius: number | null;
    battery_percent: number | null;
    power_connected: boolean | null;
    request_queue_items: number | null;
    request_queue_oldest_age_seconds: number | null;
    cache_used_bytes: number | null;
    cache_total_bytes: number | null;
    last_schedule_sync_at: string | null;
    display_count: number | null;
  };
  latest_backend_telemetry: Record<string, unknown> | null;
  grafana: {
    enabled: boolean;
    embed_enabled: boolean;
    links: ObservabilityGrafanaLink[];
    embed_url: string | null;
  };
};

const PROMETHEUS_API_PATH = '/api/v1/query';
const PROMETHEUS_MACHINE_REGEX = 'vm1|valkey|vm2|vm3|vm4|dev-local';
const SCREEN_METRICS_FRESH_MS = 90_000;

function normalizeGrafanaBasePath(basePath: string) {
  const trimmed = basePath.trim();
  if (!trimmed) return '/grafana';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function toScalar(result?: PrometheusVectorResult | null) {
  if (!result?.value) return null;
  const parsed = Number(result.value[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUnixTime(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function finiteNonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function heartbeatNumber(payload: Record<string, unknown> | null, key: string): number | null {
  return finiteNonnegative(payload?.[key]);
}

// Heartbeat quantities use MiB/GiB despite their legacy field names.
function heartbeatBytes(payload: Record<string, unknown> | null, key: string, unit: number): number | null {
  const value = heartbeatNumber(payload, key);
  return value === null ? null : Math.round(value * unit);
}

function classifyMachineStatus(params: {
  expectedTargets: number;
  reachableTargets: number;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
}) {
  const { expectedTargets, reachableTargets, cpuPercent, memoryPercent, diskPercent } = params;
  if (expectedTargets === 0) return 'unconfigured' as const;
  if (reachableTargets === 0) return 'critical' as const;
  if (reachableTargets < expectedTargets) return 'degraded' as const;
  if ([cpuPercent, memoryPercent, diskPercent].some((value) => typeof value === 'number' && value >= 95)) {
    return 'critical' as const;
  }
  if ([cpuPercent, memoryPercent, diskPercent].some((value) => typeof value === 'number' && value >= 85)) {
    return 'degraded' as const;
  }
  return 'healthy' as const;
}

function classifyAlertStatus(firing: number, highestSeverity: string) {
  if (firing <= 0) return 'healthy' as const;
  if (highestSeverity === 'critical') return 'critical' as const;
  if (highestSeverity === 'warning') return 'degraded' as const;
  return 'degraded' as const;
}

function buildDashboardUrl(uid: string, queryParams?: Record<string, string | null | undefined>) {
  const basePath = normalizeGrafanaBasePath(appConfig.OBSERVABILITY_GRAFANA_BASE_PATH);
  const url = new URL(`${basePath}/d/${uid}`, 'http://darshan.local');
  Object.entries(queryParams ?? {}).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });
  return `${url.pathname}${url.search}`;
}

export function getMachineDefinitions(
  deploymentMode: 'development' | 'qa' | 'production' = appConfig.OBSERVABILITY_DEPLOYMENT_MODE
): MachineDefinition[] {
  if (deploymentMode === 'development') {
    return [
      {
        id: 'vm2',
        name: 'Development Host',
        role: 'development',
        dashboardUid: 'darshan-vm2-backend',
        expectedJobs: ['darshan-server', 'vm2-node'],
        services: [
          { id: 'backend', label: 'Backend API', job: 'darshan-server' },
          { id: 'node', label: 'Host Exporter', job: 'vm2-node' },
        ],
      },
    ];
  }

  return [
    {
      id: 'vm1',
      name: 'VM1 Data Machine',
      role: 'data',
      dashboardUid: 'darshan-vm1-data',
      expectedJobs: ['vm1-node', 'vm1-postgres', 'vm1-minio'],
      services: [
        { id: 'node', label: 'Host Exporter', job: 'vm1-node' },
        { id: 'postgres', label: 'PostgreSQL Exporter', job: 'vm1-postgres' },
        { id: 'minio', label: 'MinIO Metrics', job: 'vm1-minio' },
      ],
    },
    {
      id: 'valkey',
      name: 'Valkey VM',
      role: 'valkey',
      dashboardUid: 'darshan-vm-valkey',
      expectedJobs: ['vm-valkey-node'],
      services: [
        { id: 'node', label: 'Host Exporter', job: 'vm-valkey-node' },
      ],
    },
    {
      id: 'vm2',
      name: 'VM2 Backend Machine',
      role: 'backend',
      dashboardUid: 'darshan-vm2-backend',
      expectedJobs: ['darshan-server', 'vm2-node'],
      services: [
        { id: 'backend', label: 'Backend API', job: 'darshan-server' },
        { id: 'node', label: 'Host Exporter', job: 'vm2-node' },
      ],
    },
    {
      id: 'vm3',
      name: 'VM3 CMS Machine',
      role: 'cms',
      dashboardUid: 'darshan-vm3-cms',
      expectedJobs: ['vm3-node', 'vm3-nginx'],
      services: [
        { id: 'node', label: 'Host Exporter', job: 'vm3-node' },
        { id: 'nginx', label: 'Nginx Exporter', job: 'vm3-nginx' },
      ],
    },
    {
      id: 'vm4',
      name: 'Observability VM',
      role: 'observability',
      dashboardUid: 'darshan-vm4-observability',
      expectedJobs: ['prometheus', 'vm4-alertmanager', 'vm4-node', 'vm4-grafana'],
      services: [
        { id: 'prometheus', label: 'Prometheus', job: 'prometheus' },
        { id: 'alertmanager', label: 'Alertmanager', job: 'vm4-alertmanager' },
        { id: 'node', label: 'Host Exporter', job: 'vm4-node' },
        { id: 'grafana', label: 'Grafana Metrics', job: 'vm4-grafana' },
      ],
    },
  ];
}

class PrometheusSummaryClient {
  private readonly baseUrl: string | null;
  private successfulQueries = 0;

  constructor(baseUrl: string | null | undefined) {
    this.baseUrl =
      baseUrl ??
      (appConfig.NODE_ENV === 'test' ? 'http://127.0.0.1:9090' : null);
  }

  get configured() {
    return Boolean(this.baseUrl);
  }

  get available() {
    return this.configured && this.successfulQueries > 0;
  }

  async query(expression: string): Promise<PrometheusVectorResult[]> {
    if (!this.baseUrl) {
      return [];
    }

    const url = new URL(PROMETHEUS_API_PATH, this.baseUrl);
    url.searchParams.set('query', expression);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), appConfig.OBSERVABILITY_PROMETHEUS_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as PrometheusResponse;
      if (body.status !== 'success' || body.data?.resultType !== 'vector') {
        return [];
      }

      this.successfulQueries += 1;
      return body.data.result ?? [];
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

function mapInstantValuesByMachine(results: PrometheusVectorResult[]) {
  const mapped = new Map<string, number>();
  for (const result of results) {
    const machineId = result.metric.machine;
    const value = toScalar(result);
    if (!machineId || value === null) continue;
    mapped.set(machineId, value);
  }
  return mapped;
}

function buildServiceStatusMap(results: PrometheusVectorResult[]) {
  const mapped = new Map<string, number>();
  for (const result of results) {
    const machineId = result.metric.machine;
    const job = result.metric.job;
    const value = toScalar(result);
    if (!machineId || !job || value === null) continue;
    mapped.set(`${machineId}:${job}`, value);
  }
  return mapped;
}

export async function buildObservabilityOverviewSummary(): Promise<ObservabilityOverviewSummary> {
  const prometheus = new PrometheusSummaryClient(appConfig.OBSERVABILITY_PROMETHEUS_BASE_URL);
  const machineDefinitions = getMachineDefinitions();
  const grafanaBasePath = normalizeGrafanaBasePath(appConfig.OBSERVABILITY_GRAFANA_BASE_PATH);

  const [playerTargetResults, alertResults, hostUpResults, cpuResults, memoryResults, diskResults] =
    await Promise.all([
      prometheus.query('up{job="players"}'),
      prometheus.query('count by (severity) (ALERTS{alertstate="firing"})'),
      prometheus.query(`up{machine=~"${PROMETHEUS_MACHINE_REGEX}"}`),
      prometheus.query(
        `100 * (1 - avg by(machine) (rate(node_cpu_seconds_total{machine=~"${PROMETHEUS_MACHINE_REGEX}",mode="idle"}[5m])))`
      ),
      prometheus.query(
        `100 * (1 - (node_memory_MemAvailable_bytes{machine=~"${PROMETHEUS_MACHINE_REGEX}"} / node_memory_MemTotal_bytes{machine=~"${PROMETHEUS_MACHINE_REGEX}"}))`
      ),
      prometheus.query(
        `max by(machine) (100 * (1 - (node_filesystem_avail_bytes{machine=~"${PROMETHEUS_MACHINE_REGEX}",fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{machine=~"${PROMETHEUS_MACHINE_REGEX}",fstype!~"tmpfs|overlay|squashfs"})))`
      ),
    ]);

  // PostgreSQL is authoritative for registered screens. The Prometheus fleet gauge
  // can be absent or stale when the observability VM or backend scrape is down.
  const onlineCutoff = new Date(Date.now() - 5 * 60 * 1000);
  const [fleetRow] = await getDatabase().select({
    total: sql<number>`count(*)`,
    active: sql<number>`count(*) filter (where ${schema.screens.status} = 'ACTIVE')`,
    inactive: sql<number>`count(*) filter (where ${schema.screens.status} = 'INACTIVE')`,
    offline: sql<number>`count(*) filter (where ${schema.screens.status} = 'OFFLINE')`,
    online: sql<number>`count(*) filter (where ${schema.screens.status} = 'ACTIVE' and ${gte(schema.screens.last_heartbeat_at, onlineCutoff)})`,
  }).from(schema.screens);

  const cpuByMachine = mapInstantValuesByMachine(cpuResults);
  const memoryByMachine = mapInstantValuesByMachine(memoryResults);
  const diskByMachine = mapInstantValuesByMachine(diskResults);
  const serviceStatuses = buildServiceStatusMap(hostUpResults);
  const hostTargetsByMachine = new Map<string, { expected: number; reachable: number }>();

  for (const machine of machineDefinitions) {
    hostTargetsByMachine.set(machine.id, { expected: machine.expectedJobs.length, reachable: 0 });
  }

  for (const result of hostUpResults) {
    const machineId = result.metric.machine;
    const value = toScalar(result);
    if (!machineId || value === null) continue;
    const current = hostTargetsByMachine.get(machineId);
    if (!current) continue;
    current.reachable += value >= 1 ? 1 : 0;
  }

  const machines: MachineSummary[] = machineDefinitions.map((machine) => {
    const targetState = hostTargetsByMachine.get(machine.id) ?? { expected: machine.expectedJobs.length, reachable: 0 };
    const cpuPercent = cpuByMachine.get(machine.id) ?? null;
    const memoryPercent = memoryByMachine.get(machine.id) ?? null;
    const diskPercent = diskByMachine.get(machine.id) ?? null;

    return {
      id: machine.id,
      name: machine.name,
      role: machine.role,
      status: !prometheus.configured
        ? 'unconfigured'
        : !prometheus.available
          ? 'unknown'
          : classifyMachineStatus({
              expectedTargets: targetState.expected,
              reachableTargets: targetState.reachable,
              cpuPercent,
              memoryPercent,
              diskPercent,
            }),
      scrape_status: {
        reachable_targets: targetState.reachable,
        expected_targets: targetState.expected,
      },
      resources: {
        cpu_percent: cpuPercent,
        memory_percent: memoryPercent,
        disk_percent: diskPercent,
      },
      services: machine.services.map((service) => {
        const value = serviceStatuses.get(`${machine.id}:${service.job}`);
        return {
          id: service.id,
          label: service.label,
          status: value === undefined ? 'unknown' : value >= 1 ? 'up' : 'down',
        };
      }),
      grafana: {
        dashboard_url: appConfig.OBSERVABILITY_GRAFANA_ENABLED ? buildDashboardUrl(machine.dashboardUid) : null,
      },
    };
  });

  const configuredPlayerTargets = playerTargetResults.length > 0 ? playerTargetResults.length : null;
  const reachablePlayerTargets =
    playerTargetResults.length > 0
      ? playerTargetResults.reduce((count, result) => count + (toScalar(result) === 1 ? 1 : 0), 0)
      : null;

  const firingAlerts = alertResults.reduce((count, result) => count + (toScalar(result) ?? 0), 0);
  const severityOrder = ['critical', 'warning', 'info'];
  const highestSeverity =
    severityOrder.find((severity) => alertResults.some((result) => result.metric.severity === severity)) ??
    (alertResults.length > 0 ? 'unknown' : 'none');

  return {
    generated_at: new Date().toISOString(),
    deployment_mode: appConfig.OBSERVABILITY_DEPLOYMENT_MODE,
    current_state_source: 'backend_and_prometheus',
    fleet: {
      total_players: Number(fleetRow?.total ?? 0),
      online_players: Number(fleetRow?.online ?? 0),
      active_players: Number(fleetRow?.active ?? 0),
      inactive_players: Number(fleetRow?.inactive ?? 0),
      offline_players: Number(fleetRow?.offline ?? 0),
      reachable_players: reachablePlayerTargets,
      configured_player_targets: configuredPlayerTargets,
    },
    alerts: {
      available: prometheus.available,
      firing: firingAlerts,
      highest_severity: highestSeverity as ObservabilityOverviewSummary['alerts']['highest_severity'],
      status: !prometheus.configured
        ? 'unconfigured'
        : prometheus.available
          ? classifyAlertStatus(firingAlerts, highestSeverity)
          : 'unknown',
    },
    machines,
    grafana: {
      enabled: appConfig.OBSERVABILITY_GRAFANA_ENABLED,
      embed_enabled: appConfig.OBSERVABILITY_GRAFANA_EMBED_ENABLED,
      base_path: grafanaBasePath,
      links: {
        backend_service: appConfig.OBSERVABILITY_GRAFANA_ENABLED ? buildDashboardUrl('darshan-vm2-backend') : null,
        players_fleet: appConfig.OBSERVABILITY_GRAFANA_ENABLED ? buildDashboardUrl('darshan-players-fleet') : null,
        machines: Object.fromEntries(
          machineDefinitions.map((machine) => [
            machine.id,
            appConfig.OBSERVABILITY_GRAFANA_ENABLED ? buildDashboardUrl(machine.dashboardUid) : null,
          ])
        ),
      },
    },
  };
}

export async function buildMachineSummaries(): Promise<MachineSummary[]> {
  const overview = await buildObservabilityOverviewSummary();
  return overview.machines;
}

export async function buildScreenObservabilitySummary(screenId: string): Promise<ScreenObservabilitySummary | null> {
  const db = getDatabase();
  const screen = await db.select().from(schema.screens).where(eq(schema.screens.id, screenId)).limit(1);
  const screenRow = screen[0];
  if (!screenRow) {
    return null;
  }

  const summary = await buildScreenPlaybackStateById(screenId, { db });
  const [latestHeartbeat] = await db
    .select({
      created_at: schema.heartbeats.created_at,
      status: schema.heartbeats.status,
      bucket: schema.storageObjects.bucket,
      object_key: schema.storageObjects.object_key,
    })
    .from(schema.heartbeats)
    .leftJoin(schema.storageObjects, eq(schema.heartbeats.storage_object_id, schema.storageObjects.id))
    .where(eq(schema.heartbeats.screen_id, screenId))
    .orderBy(desc(schema.heartbeats.created_at))
    .limit(1);

  let latestBackendTelemetry: Record<string, unknown> | null = null;
  if (latestHeartbeat?.bucket && latestHeartbeat.object_key) {
    const { getObject } = await import('@/s3');
    try {
      const payload = await getObject(latestHeartbeat.bucket, latestHeartbeat.object_key);
      latestBackendTelemetry = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
    } catch {
      latestBackendTelemetry = null;
    }
  }

  const prometheus = new PrometheusSummaryClient(appConfig.OBSERVABILITY_PROMETHEUS_BASE_URL);
  const playerMetricResults = await prometheus.query(
    [
      `up{job="players",device_id="${screenId}"}`,
      `darshan_player_last_successful_heartbeat_unixtime{device_id="${screenId}"}`,
      `darshan_player_system_cpu_usage_percent{device_id="${screenId}"}`,
      `darshan_player_system_memory_bytes{device_id="${screenId}",state=~"used|total"}`,
      `darshan_player_system_disk_bytes{device_id="${screenId}",state=~"used|total"}`,
      `darshan_player_system_temperature_celsius{device_id="${screenId}"}`,
      `darshan_player_battery_percent{device_id="${screenId}"}`,
      `darshan_player_power_connected{device_id="${screenId}"}`,
      `darshan_player_request_queue_items{device_id="${screenId}",category="all"}`,
      `darshan_player_request_queue_oldest_age_seconds{device_id="${screenId}",category="all"}`,
      `darshan_player_cache_bytes{device_id="${screenId}",state=~"used|total"}`,
      `darshan_player_last_schedule_sync_unixtime{device_id="${screenId}"}`,
      `darshan_player_display_count{device_id="${screenId}"}`,
    ].join(' or ')
  );

  const metricValue = (name: string, matcher?: (metric: PrometheusMetric) => boolean) => {
    const result = playerMetricResults.find(
      (entry) => entry.metric.__name__ === name && (matcher ? matcher(entry.metric) : true)
    );
    if (!result) return null;
    const sampleAgeMs = Date.now() - Number(result.value[0]) * 1000;
    return sampleAgeMs >= 0 && sampleAgeMs <= SCREEN_METRICS_FRESH_MS ? toScalar(result) : null;
  };

  const scrapeUpResult = playerMetricResults.find((result) => result.metric.__name__ === 'up');
  const scrapeUp = toScalar(scrapeUpResult);
  const scrapeSampleAgeMs = scrapeUpResult ? Date.now() - Number(scrapeUpResult.value[0]) * 1000 : Number.POSITIVE_INFINITY;
  const scrapeFresh = scrapeSampleAgeMs >= 0 && scrapeSampleAgeMs <= SCREEN_METRICS_FRESH_MS;
  const scrapeStatus = scrapeUp !== null
    ? !scrapeFresh ? 'unavailable' : scrapeUp >= 1 ? 'up' : 'down'
    : !prometheus.configured || prometheus.available ? 'unconfigured' : 'unavailable';
  const heartbeatAgeMs = latestHeartbeat?.created_at
    ? Date.now() - latestHeartbeat.created_at.getTime()
    : Number.POSITIVE_INFINITY;
  const recentHeartbeat = latestHeartbeat?.status === 'ONLINE' &&
    heartbeatAgeMs >= 0 && heartbeatAgeMs <= SCREEN_METRICS_FRESH_MS
    ? latestBackendTelemetry
    : null;
  const metricSources = new Set<'prometheus' | 'backend_heartbeat'>();
  const selectMetric = (prometheusValue: number | null, heartbeatValue: number | null): number | null => {
    if (scrapeStatus === 'up' && prometheusValue !== null) {
      metricSources.add('prometheus');
      return prometheusValue;
    }
    if (heartbeatValue !== null) {
      metricSources.add('backend_heartbeat');
      return heartbeatValue;
    }
    return null;
  };

  const powerSource = recentHeartbeat?.power_source;
  const heartbeatPowerConnected = powerSource === 'AC' || powerSource === 'USB'
    ? true
    : powerSource === 'BATTERY'
      ? false
      : typeof recentHeartbeat?.is_charging === 'boolean'
        ? recentHeartbeat.is_charging
        : null;
  const scrapedPowerConnected = metricValue('darshan_player_power_connected');
  let powerConnected: boolean | null = null;
  if (scrapeStatus === 'up' && scrapedPowerConnected !== null) {
    metricSources.add('prometheus');
    powerConnected = scrapedPowerConnected >= 1;
  } else if (heartbeatPowerConnected !== null) {
    metricSources.add('backend_heartbeat');
    powerConnected = heartbeatPowerConnected;
  }

  const latestPlayerMetrics: ScreenObservabilitySummary['latest_player_metrics'] = {
    cpu_percent: selectMetric(metricValue('darshan_player_system_cpu_usage_percent'), heartbeatNumber(recentHeartbeat, 'cpu_usage')),
    memory_percent: null,
    memory_used_bytes: selectMetric(metricValue('darshan_player_system_memory_bytes', (metric) => metric.state === 'used'), heartbeatBytes(recentHeartbeat, 'memory_used_mb', 1024 ** 2)),
    memory_total_bytes: selectMetric(metricValue('darshan_player_system_memory_bytes', (metric) => metric.state === 'total'), heartbeatBytes(recentHeartbeat, 'memory_total_mb', 1024 ** 2)),
    disk_percent: null,
    disk_used_bytes: selectMetric(metricValue('darshan_player_system_disk_bytes', (metric) => metric.state === 'used'), heartbeatBytes(recentHeartbeat, 'disk_used_gb', 1024 ** 3)),
    disk_total_bytes: selectMetric(metricValue('darshan_player_system_disk_bytes', (metric) => metric.state === 'total'), heartbeatBytes(recentHeartbeat, 'disk_total_gb', 1024 ** 3)),
    temperature_celsius: selectMetric(metricValue('darshan_player_system_temperature_celsius'), heartbeatNumber(recentHeartbeat, 'cpu_temp_c') ?? heartbeatNumber(recentHeartbeat, 'temperature')),
    battery_percent: selectMetric(metricValue('darshan_player_battery_percent'), heartbeatNumber(recentHeartbeat, 'battery_percent')),
    power_connected: powerConnected,
    request_queue_items: selectMetric(metricValue('darshan_player_request_queue_items'), heartbeatNumber(recentHeartbeat, 'request_queue_items')),
    request_queue_oldest_age_seconds: selectMetric(metricValue('darshan_player_request_queue_oldest_age_seconds'), heartbeatNumber(recentHeartbeat, 'request_queue_oldest_age_seconds')),
    cache_used_bytes: selectMetric(metricValue('darshan_player_cache_bytes', (metric) => metric.state === 'used'), null),
    cache_total_bytes: selectMetric(metricValue('darshan_player_cache_bytes', (metric) => metric.state === 'total'), null),
    last_schedule_sync_at: scrapeStatus === 'up' ? parseUnixTime(metricValue('darshan_player_last_schedule_sync_unixtime')) : null,
    display_count: selectMetric(metricValue('darshan_player_display_count'), heartbeatNumber(recentHeartbeat, 'display_count')),
  };
  latestPlayerMetrics.memory_percent = latestPlayerMetrics.memory_used_bytes !== null &&
    latestPlayerMetrics.memory_total_bytes !== null && latestPlayerMetrics.memory_total_bytes > 0
    ? 100 * latestPlayerMetrics.memory_used_bytes / latestPlayerMetrics.memory_total_bytes
    : selectMetric(null, heartbeatNumber(recentHeartbeat, 'memory_usage'));
  latestPlayerMetrics.disk_percent = latestPlayerMetrics.disk_used_bytes !== null &&
    latestPlayerMetrics.disk_total_bytes !== null && latestPlayerMetrics.disk_total_bytes > 0
    ? 100 * latestPlayerMetrics.disk_used_bytes / latestPlayerMetrics.disk_total_bytes
    : selectMetric(null, heartbeatNumber(recentHeartbeat, 'disk_usage_percent'));
  if (latestPlayerMetrics.last_schedule_sync_at) metricSources.add('prometheus');
  const latestPlayerMetricsSource = metricSources.size === 2
    ? 'mixed'
    : metricSources.has('prometheus') ? 'prometheus'
    : metricSources.has('backend_heartbeat') ? 'backend_heartbeat' : 'none';

  const grafanaLinks: ObservabilityGrafanaLink[] = [];
  if (appConfig.OBSERVABILITY_GRAFANA_ENABLED) {
    grafanaLinks.push({
      label: 'Open player fleet dashboard',
      url: buildDashboardUrl('darshan-players-fleet', {
        'var-device_id': screenId,
        'var-screen_id': screenId,
      }),
    });
    grafanaLinks.push({
      label: 'Open backend service dashboard',
      url: buildDashboardUrl('darshan-vm2-backend'),
    });
  }

  return {
    generated_at: new Date().toISOString(),
    screen: {
      id: screenRow.id,
      name: screenRow.name,
      status: screenRow.status,
      health_state: (summary as { health_state?: string | null })?.health_state ?? null,
      health_reason: (summary as { health_reason?: string | null })?.health_reason ?? null,
      last_backend_heartbeat_at: screenRow.last_heartbeat_at?.toISOString() ?? null,
    },
    player_scrape: {
      configured: scrapeUp !== null,
      status: scrapeStatus,
      last_successful_player_heartbeat_at: parseUnixTime(
        metricValue('darshan_player_last_successful_heartbeat_unixtime')
      ),
    },
    latest_player_metrics_source: latestPlayerMetricsSource,
    latest_player_metrics_observed_at: latestPlayerMetricsSource === 'none' ? null
      : metricSources.has('backend_heartbeat') ? latestHeartbeat?.created_at.toISOString() ?? null
      : new Date().toISOString(),
    latest_player_metrics: latestPlayerMetrics,
    latest_backend_telemetry: latestBackendTelemetry,
    grafana: {
      enabled: appConfig.OBSERVABILITY_GRAFANA_ENABLED,
      embed_enabled: appConfig.OBSERVABILITY_GRAFANA_EMBED_ENABLED,
      links: grafanaLinks,
      embed_url:
        appConfig.OBSERVABILITY_GRAFANA_ENABLED && appConfig.OBSERVABILITY_GRAFANA_EMBED_ENABLED
          ? buildDashboardUrl('darshan-players-fleet', {
              kiosk: 'tv',
              theme: 'light',
              'var-device_id': screenId,
              'var-screen_id': screenId,
            })
          : null,
    },
  };
}
