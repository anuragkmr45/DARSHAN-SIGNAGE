import { URL } from 'node:url';
import { desc, eq } from 'drizzle-orm';
import { config as appConfig } from '../config/index.js';
import { getDatabase, schema } from '../db/index.js';
import { buildScreenPlaybackStateById } from '../screens/playback.js';
const PROMETHEUS_API_PATH = '/api/v1/query';
const PROMETHEUS_MACHINE_REGEX = 'vm1|valkey|vm2|vm3|vm4|dev-local';
function normalizeGrafanaBasePath(basePath) {
    const trimmed = basePath.trim();
    if (!trimmed)
        return '/grafana';
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
function toScalar(result) {
    if (!result?.value)
        return null;
    const parsed = Number(result.value[1]);
    return Number.isFinite(parsed) ? parsed : null;
}
function parseUnixTime(value) {
    if (value === null || !Number.isFinite(value) || value <= 0)
        return null;
    return new Date(value * 1000).toISOString();
}
function classifyMachineStatus(params) {
    const { expectedTargets, reachableTargets, cpuPercent, memoryPercent, diskPercent } = params;
    if (expectedTargets === 0)
        return 'unconfigured';
    if (reachableTargets === 0)
        return 'critical';
    if (reachableTargets < expectedTargets)
        return 'degraded';
    if ([cpuPercent, memoryPercent, diskPercent].some((value) => typeof value === 'number' && value >= 95)) {
        return 'critical';
    }
    if ([cpuPercent, memoryPercent, diskPercent].some((value) => typeof value === 'number' && value >= 85)) {
        return 'degraded';
    }
    return 'healthy';
}
function classifyAlertStatus(firing, highestSeverity) {
    if (firing <= 0)
        return 'healthy';
    if (highestSeverity === 'critical')
        return 'critical';
    if (highestSeverity === 'warning')
        return 'degraded';
    return 'degraded';
}
function buildDashboardUrl(uid, queryParams) {
    const basePath = normalizeGrafanaBasePath(appConfig.OBSERVABILITY_GRAFANA_BASE_PATH);
    const url = new URL(`${basePath}/d/${uid}`, 'http://darshan.local');
    Object.entries(queryParams ?? {}).forEach(([key, value]) => {
        if (value) {
            url.searchParams.set(key, value);
        }
    });
    return `${url.pathname}${url.search}`;
}
export function getMachineDefinitions(deploymentMode = appConfig.OBSERVABILITY_DEPLOYMENT_MODE) {
    if (deploymentMode === 'development') {
        return [
            {
                id: 'dev-local',
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
    baseUrl;
    successfulQueries = 0;
    constructor(baseUrl) {
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
    async query(expression) {
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
            const body = (await response.json());
            if (body.status !== 'success' || body.data?.resultType !== 'vector') {
                return [];
            }
            this.successfulQueries += 1;
            return body.data.result ?? [];
        }
        catch {
            return [];
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
function mapInstantValuesByMachine(results) {
    const mapped = new Map();
    for (const result of results) {
        const machineId = result.metric.machine;
        const value = toScalar(result);
        if (!machineId || value === null)
            continue;
        mapped.set(machineId, value);
    }
    return mapped;
}
function buildServiceStatusMap(results) {
    const mapped = new Map();
    for (const result of results) {
        const machineId = result.metric.machine;
        const job = result.metric.job;
        const value = toScalar(result);
        if (!machineId || !job || value === null)
            continue;
        mapped.set(`${machineId}:${job}`, value);
    }
    return mapped;
}
export async function buildObservabilityOverviewSummary() {
    const prometheus = new PrometheusSummaryClient(appConfig.OBSERVABILITY_PROMETHEUS_BASE_URL);
    const machineDefinitions = getMachineDefinitions();
    const grafanaBasePath = normalizeGrafanaBasePath(appConfig.OBSERVABILITY_GRAFANA_BASE_PATH);
    const [fleetStateResults, playerTargetResults, alertResults, hostUpResults, cpuResults, memoryResults, diskResults] = await Promise.all([
        prometheus.query('darshan_fleet_players_total'),
        prometheus.query('up{job="players"}'),
        prometheus.query('count by (severity) (ALERTS{alertstate="firing"})'),
        prometheus.query(`up{machine=~"${PROMETHEUS_MACHINE_REGEX}"}`),
        prometheus.query(`100 * (1 - avg by(machine) (rate(node_cpu_seconds_total{machine=~"${PROMETHEUS_MACHINE_REGEX}",mode="idle"}[5m])))`),
        prometheus.query(`100 * (1 - (node_memory_MemAvailable_bytes{machine=~"${PROMETHEUS_MACHINE_REGEX}"} / node_memory_MemTotal_bytes{machine=~"${PROMETHEUS_MACHINE_REGEX}"}))`),
        prometheus.query(`max by(machine) (100 * (1 - (node_filesystem_avail_bytes{machine=~"${PROMETHEUS_MACHINE_REGEX}",fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{machine=~"${PROMETHEUS_MACHINE_REGEX}",fstype!~"tmpfs|overlay|squashfs"})))`),
    ]);
    const fleetTotals = new Map();
    for (const result of fleetStateResults) {
        const state = result.metric.state;
        const value = toScalar(result);
        if (!state || value === null)
            continue;
        fleetTotals.set(state, value);
    }
    const cpuByMachine = mapInstantValuesByMachine(cpuResults);
    const memoryByMachine = mapInstantValuesByMachine(memoryResults);
    const diskByMachine = mapInstantValuesByMachine(diskResults);
    const serviceStatuses = buildServiceStatusMap(hostUpResults);
    const hostTargetsByMachine = new Map();
    for (const machine of machineDefinitions) {
        hostTargetsByMachine.set(machine.id, { expected: machine.expectedJobs.length, reachable: 0 });
    }
    for (const result of hostUpResults) {
        const machineId = result.metric.machine;
        const value = toScalar(result);
        if (!machineId || value === null)
            continue;
        const current = hostTargetsByMachine.get(machineId);
        if (!current)
            continue;
        current.reachable += value >= 1 ? 1 : 0;
    }
    const machines = machineDefinitions.map((machine) => {
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
    const reachablePlayerTargets = playerTargetResults.length > 0
        ? playerTargetResults.reduce((count, result) => count + (toScalar(result) === 1 ? 1 : 0), 0)
        : null;
    const firingAlerts = alertResults.reduce((count, result) => count + (toScalar(result) ?? 0), 0);
    const severityOrder = ['critical', 'warning', 'info'];
    const highestSeverity = severityOrder.find((severity) => alertResults.some((result) => result.metric.severity === severity)) ??
        (alertResults.length > 0 ? 'unknown' : 'none');
    return {
        generated_at: new Date().toISOString(),
        deployment_mode: appConfig.OBSERVABILITY_DEPLOYMENT_MODE,
        current_state_source: 'backend_and_prometheus',
        fleet: {
            total_players: fleetTotals.get('ACTIVE') !== undefined ||
                fleetTotals.get('INACTIVE') !== undefined ||
                fleetTotals.get('OFFLINE') !== undefined
                ? (fleetTotals.get('ACTIVE') ?? 0) + (fleetTotals.get('INACTIVE') ?? 0) + (fleetTotals.get('OFFLINE') ?? 0)
                : null,
            active_players: fleetTotals.get('ACTIVE') ?? null,
            inactive_players: fleetTotals.get('INACTIVE') ?? null,
            offline_players: fleetTotals.get('OFFLINE') ?? null,
            reachable_players: reachablePlayerTargets,
            configured_player_targets: configuredPlayerTargets,
        },
        alerts: {
            available: prometheus.available,
            firing: firingAlerts,
            highest_severity: highestSeverity,
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
                backend_service: appConfig.OBSERVABILITY_GRAFANA_ENABLED ? buildDashboardUrl('darshan-backend-service') : null,
                players_fleet: appConfig.OBSERVABILITY_GRAFANA_ENABLED ? buildDashboardUrl('darshan-players-fleet') : null,
                machines: Object.fromEntries(machineDefinitions.map((machine) => [
                    machine.id,
                    appConfig.OBSERVABILITY_GRAFANA_ENABLED ? buildDashboardUrl(machine.dashboardUid) : null,
                ])),
            },
        },
    };
}
export async function buildMachineSummaries() {
    const overview = await buildObservabilityOverviewSummary();
    return overview.machines;
}
export async function buildScreenObservabilitySummary(screenId) {
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
        bucket: schema.storageObjects.bucket,
        object_key: schema.storageObjects.object_key,
    })
        .from(schema.heartbeats)
        .leftJoin(schema.storageObjects, eq(schema.heartbeats.storage_object_id, schema.storageObjects.id))
        .where(eq(schema.heartbeats.screen_id, screenId))
        .orderBy(desc(schema.heartbeats.created_at))
        .limit(1);
    let latestBackendTelemetry = null;
    if (latestHeartbeat?.bucket && latestHeartbeat.object_key) {
        const { getObject } = await import('../s3/index.js');
        try {
            const payload = await getObject(latestHeartbeat.bucket, latestHeartbeat.object_key);
            latestBackendTelemetry = JSON.parse(payload.toString('utf8'));
        }
        catch {
            latestBackendTelemetry = null;
        }
    }
    const prometheus = new PrometheusSummaryClient(appConfig.OBSERVABILITY_PROMETHEUS_BASE_URL);
    const playerMetricResults = await prometheus.query([
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
    ].join(' or '));
    const metricValue = (name, matcher) => toScalar(playerMetricResults.find((result) => result.metric.__name__ === name && (matcher ? matcher(result.metric) : true)) ?? null);
    const grafanaLinks = [];
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
            url: buildDashboardUrl('darshan-backend-service'),
        });
    }
    return {
        generated_at: new Date().toISOString(),
        screen: {
            id: screenRow.id,
            name: screenRow.name,
            status: screenRow.status,
            health_state: summary?.health_state ?? null,
            health_reason: summary?.health_reason ?? null,
            last_backend_heartbeat_at: screenRow.last_heartbeat_at?.toISOString() ?? null,
        },
        player_scrape: {
            configured: playerMetricResults.length > 0,
            status: (() => {
                const upValue = metricValue('up');
                if (upValue === null)
                    return 'unknown';
                return upValue >= 1 ? 'up' : 'down';
            })(),
            last_successful_player_heartbeat_at: parseUnixTime(metricValue('darshan_player_last_successful_heartbeat_unixtime')),
        },
        latest_player_metrics: {
            cpu_percent: metricValue('darshan_player_system_cpu_usage_percent'),
            memory_used_bytes: metricValue('darshan_player_system_memory_bytes', (metric) => metric.state === 'used'),
            memory_total_bytes: metricValue('darshan_player_system_memory_bytes', (metric) => metric.state === 'total'),
            disk_used_bytes: metricValue('darshan_player_system_disk_bytes', (metric) => metric.state === 'used'),
            disk_total_bytes: metricValue('darshan_player_system_disk_bytes', (metric) => metric.state === 'total'),
            temperature_celsius: metricValue('darshan_player_system_temperature_celsius'),
            battery_percent: metricValue('darshan_player_battery_percent'),
            power_connected: (() => {
                const value = metricValue('darshan_player_power_connected');
                if (value === null)
                    return null;
                return value >= 1;
            })(),
            request_queue_items: metricValue('darshan_player_request_queue_items'),
            request_queue_oldest_age_seconds: metricValue('darshan_player_request_queue_oldest_age_seconds'),
            cache_used_bytes: metricValue('darshan_player_cache_bytes', (metric) => metric.state === 'used'),
            cache_total_bytes: metricValue('darshan_player_cache_bytes', (metric) => metric.state === 'total'),
            last_schedule_sync_at: parseUnixTime(metricValue('darshan_player_last_schedule_sync_unixtime')),
            display_count: metricValue('darshan_player_display_count'),
        },
        latest_backend_telemetry: latestBackendTelemetry,
        grafana: {
            enabled: appConfig.OBSERVABILITY_GRAFANA_ENABLED,
            embed_enabled: appConfig.OBSERVABILITY_GRAFANA_EMBED_ENABLED,
            links: grafanaLinks,
            embed_url: appConfig.OBSERVABILITY_GRAFANA_ENABLED && appConfig.OBSERVABILITY_GRAFANA_EMBED_ENABLED
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
