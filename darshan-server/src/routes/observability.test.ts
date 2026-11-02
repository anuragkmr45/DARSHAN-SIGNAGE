import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { createSessionRepository } from '@/db/repositories/session';
import { generateAccessToken } from '@/auth/jwt';
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';
import * as s3 from '@/s3';

type OverviewResponseBody = {
  current_state_source: string;
  fleet: {
    total_players: number | null;
    online_players: number | null;
  };
  alerts: {
    available: boolean;
    firing: number;
    status: string;
  };
  machines: Array<{
    name: string;
    status: string;
    scrape_status: {
      reachable_targets: number;
    };
  }>;
  grafana: {
    links: {
      players_fleet: string | null;
    };
  };
};

async function issueRoleToken(roleName: 'ADMIN' | 'OPERATOR') {
  const db = getDatabase();
  const [roleRecord] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.name, roleName))
    .limit(1);
  if (!roleRecord) {
    throw new Error(`${roleName} role is required for observability route tests`);
  }

  const currentPermissions =
    roleRecord.permissions && typeof roleRecord.permissions === 'object'
      ? (roleRecord.permissions as { grants?: Array<{ action: string; subject: string }> })
      : {};
  const mergedGrants = [...(currentPermissions.grants || [])];
  for (const grant of [
    { action: 'read', subject: 'Dashboard' },
    { action: 'read', subject: 'Screen' },
  ]) {
    if (
      !mergedGrants.some(
        (current) => current.action === grant.action && current.subject === grant.subject
      )
    ) {
      mergedGrants.push(grant);
    }
  }

  await db
    .update(schema.roles)
    .set({ permissions: { grants: mergedGrants } })
    .where(eq(schema.roles.id, roleRecord.id));

  const token = await generateAccessToken(
    testUser.id,
    testUser.email,
    roleRecord.id,
    roleRecord.name
  );
  await createSessionRepository().create({
    user_id: testUser.id,
    access_jti: token.jti,
    expires_at: token.expiresAt,
  });
  return token.token;
}

function createPrometheusResponse(
  result: Array<{
    metric: Record<string, string>;
    value: string;
  }>
) {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: result.map((entry) => ({
        metric: entry.metric,
        value: [Date.now() / 1000, entry.value] as [number, string],
      })),
    },
  };
}

describe('Observability CMS summary routes', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await issueRoleToken('ADMIN');
    operatorToken = await issueRoleToken('OPERATOR');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await closeTestServer(server);
  });

  it('returns a CMS-safe observability overview with machine summaries', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const query = url.searchParams.get('query') ?? '';

      if (query === 'darshan_fleet_players_total') {
        return new Response(
          JSON.stringify(
            createPrometheusResponse([
              { metric: { __name__: 'darshan_fleet_players_total', state: 'ACTIVE' }, value: '5' },
              { metric: { __name__: 'darshan_fleet_players_total', state: 'OFFLINE' }, value: '1' },
            ])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (query === 'up{job="players"}') {
        return new Response(
          JSON.stringify(
            createPrometheusResponse([
              { metric: { __name__: 'up', job: 'players', device_id: 'screen-1' }, value: '1' },
              { metric: { __name__: 'up', job: 'players', device_id: 'screen-2' }, value: '0' },
            ])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (query === 'count by (severity) (ALERTS{alertstate="firing"})') {
        return new Response(
          JSON.stringify(
            createPrometheusResponse([{ metric: { severity: 'warning' }, value: '2' }])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (query.startsWith('up{machine=')) {
        return new Response(
          JSON.stringify(
            createPrometheusResponse([
              {
                metric: { __name__: 'up', machine: 'vm2', job: 'darshan-server' },
                value: '1',
              },
              { metric: { __name__: 'up', machine: 'vm2', job: 'vm2-node' }, value: '1' },
            ])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (query.startsWith('100 * (1 - avg by(machine)')) {
        return new Response(
          JSON.stringify(
            createPrometheusResponse([{ metric: { machine: 'vm2' }, value: '21.3' }])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (query.startsWith('100 * (1 - (node_memory_MemAvailable_bytes')) {
        return new Response(
          JSON.stringify(
            createPrometheusResponse([{ metric: { machine: 'vm2' }, value: '47.9' }])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (query.startsWith('max by(machine) (100 * (1 - (node_filesystem_avail_bytes')) {
        return new Response(
          JSON.stringify(
            createPrometheusResponse([{ metric: { machine: 'vm2' }, value: '62.5' }])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify(createPrometheusResponse([])), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/observability/overview',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body) as OverviewResponseBody;
    expect(body.current_state_source).toBe('backend_and_prometheus');
    const [registeredScreens] = await getDatabase().select({ count: sql<number>`count(*)` }).from(schema.screens);
    expect(body.fleet.total_players).toBe(Number(registeredScreens.count));
    expect(body.alerts.firing).toBe(2);
    expect(body.machines).toHaveLength(1);
    expect(body.machines[0].name).toContain('Development');
    expect(body.machines[0].scrape_status.reachable_targets).toBe(2);
    expect(body.grafana.links.players_fleet).toContain('/grafana/d/darshan-players-fleet');
  });

  it('reports observability as unknown instead of critical when Prometheus is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Prometheus unavailable');
      })
    );

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/observability/overview',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body) as OverviewResponseBody;
    expect(body.alerts.available).toBe(false);
    expect(body.alerts.status).toBe('unknown');
    expect(body.machines.length).toBeGreaterThan(0);
    expect(body.machines.every((machine) => machine.status === 'unknown')).toBe(true);
    expect(body.machines.every((machine) => machine.scrape_status.reachable_targets === 0)).toBe(true);
  });

  it('keeps fleet totals current when Prometheus is unreachable', async () => {
    const screenId = randomUUID();
    const db = getDatabase();
    const [before] = await db.select({ total: sql<number>`count(*)` }).from(schema.screens);
    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Fleet fallback test',
      status: 'ACTIVE',
      last_heartbeat_at: new Date(),
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Prometheus unavailable'); }));
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/observability/overview',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = response.json() as OverviewResponseBody;
      expect(body.fleet.total_players).toBe(Number(before.total) + 1);
      expect(body.fleet.online_players).toBeGreaterThanOrEqual(1);
      expect(body.alerts.available).toBe(false);
    } finally {
      await db.delete(schema.screens).where(eq(schema.screens.id, screenId));
    }
  });

  it('allows operators to read the observability overview route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              createPrometheusResponse([
                {
                  metric: { __name__: 'darshan_fleet_players_total', state: 'ACTIVE' },
                  value: '2',
                },
              ])
            ),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      )
    );

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/observability/overview',
      headers: {
        authorization: `Bearer ${operatorToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body) as OverviewResponseBody;
    expect(body.current_state_source).toBe('backend_and_prometheus');
  });

  it('returns per-screen observability summary with backend telemetry and player scrape details', async () => {
    const screenId = randomUUID();
    const storageObjectId = randomUUID();
    const db = getDatabase();

    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Observability Screen',
      status: 'ACTIVE',
      last_heartbeat_at: new Date('2026-04-08T09:00:00.000Z'),
    });

    await db.insert(schema.storageObjects).values({
      id: storageObjectId,
      bucket: 'telemetry',
      object_key: `heartbeats/${screenId}.json`,
      content_type: 'application/json',
      size: 128,
    });

    await db.insert(schema.heartbeats).values({
      screen_id: screenId,
      status: 'ONLINE',
      storage_object_id: storageObjectId,
    });

    vi.spyOn(s3, 'getObject').mockResolvedValue(
      Buffer.from(
        JSON.stringify({
          cpu_usage: 18.5,
          memory_total_mb: 4096,
          memory_used_mb: 1024,
          disk_total_gb: 64,
          disk_used_gb: 20,
        }),
        'utf8'
      )
    );

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            createPrometheusResponse([
              { metric: { __name__: 'up', job: 'players', device_id: screenId }, value: '1' },
              {
                metric: {
                  __name__: 'darshan_player_last_successful_heartbeat_unixtime',
                  device_id: screenId,
                },
                value: String(Date.parse('2026-04-08T09:01:00.000Z') / 1000),
              },
              {
                metric: {
                  __name__: 'darshan_player_system_cpu_usage_percent',
                  device_id: screenId,
                },
                value: '12.5',
              },
              {
                metric: {
                  __name__: 'darshan_player_system_memory_bytes',
                  device_id: screenId,
                  state: 'used',
                },
                value: '1073741824',
              },
              {
                metric: {
                  __name__: 'darshan_player_system_memory_bytes',
                  device_id: screenId,
                  state: 'total',
                },
                value: '4294967296',
              },
              {
                metric: {
                  __name__: 'darshan_player_request_queue_items',
                  device_id: screenId,
                  category: 'all',
                },
                value: '3',
              },
            ])
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );

    vi.stubGlobal('fetch', fetchMock);

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/observability/screens/${screenId}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body) as {
      player_scrape: {
        status: string;
      };
      latest_player_metrics: {
        request_queue_items: number | null;
      };
      latest_backend_telemetry: {
        memory_used_mb?: number;
      } | null;
      grafana: {
        links: Array<{ label: string }>;
      };
    };
    expect(body.screen.id).toBe(screenId);
    expect(body.player_scrape.status).toBe('up');
    expect(body.latest_player_metrics.cpu_percent).toBe(12.5);
    expect(body.latest_backend_telemetry.cpu_usage).toBe(18.5);
    expect(body.grafana.links[0].url).toContain('/grafana/d/darshan-players-fleet');
  });

  it('uses fresh backend heartbeat measurements when direct player scrape is absent or down', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const storageObjectId = randomUUID();
    await db.insert(schema.screens).values({ id: screenId, name: 'Heartbeat fallback', status: 'ACTIVE', last_heartbeat_at: new Date() });
    await db.insert(schema.storageObjects).values({
      id: storageObjectId,
      bucket: 'telemetry',
      object_key: `heartbeats/${screenId}.json`,
      content_type: 'application/json',
      size: 128,
    });
    const [heartbeat] = await db.insert(schema.heartbeats).values({
      screen_id: screenId,
      status: 'ONLINE',
      storage_object_id: storageObjectId,
    }).returning({ id: schema.heartbeats.id });
    const currentHeartbeatPayload = Buffer.from(JSON.stringify({
      cpu_usage: 34.5,
      memory_used_mb: 1024,
      memory_total_mb: 4096,
      disk_used_gb: 12.5,
      disk_total_gb: 64,
      request_queue_items: 0,
      request_queue_oldest_age_seconds: 0,
      display_count: 1,
      power_source: 'AC',
    }));
    const heartbeatObject = vi.spyOn(s3, 'getObject').mockResolvedValue(currentHeartbeatPayload);
    const endpoint = `/api/v1/observability/screens/${screenId}`;
    const headers = { authorization: `Bearer ${adminToken}` };
    const respond = async () => server.inject({ method: 'GET', url: endpoint, headers });
    const vectorResponse = (result: Array<{ metric: Record<string, string>; value: string }>) =>
      new Response(JSON.stringify(createPrometheusResponse(result)), { status: 200, headers: { 'content-type': 'application/json' } });

    try {
      vi.stubGlobal('fetch', vi.fn(async () => vectorResponse([])));
      let response = await respond();
      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      let body = response.json();
      expect(body.player_scrape.status).toBe('unconfigured');
      expect(body.latest_player_metrics_source).toBe('backend_heartbeat');
      expect(body.latest_player_metrics.cpu_percent).toBe(34.5);
      expect(body.latest_player_metrics.memory_used_bytes).toBe(1024 ** 3);
      expect(body.latest_player_metrics.request_queue_items).toBe(0);
      expect(body.latest_player_metrics.power_connected).toBe(true);

      heartbeatObject.mockResolvedValue(Buffer.from(JSON.stringify({
        cpu_usage: 18,
        memory_usage: 55,
        disk_usage_percent: 40,
      })));
      response = await respond();
      body = response.json();
      expect(body.latest_player_metrics.memory_used_bytes).toBeNull();
      expect(body.latest_player_metrics.memory_percent).toBe(55);
      expect(body.latest_player_metrics.disk_percent).toBe(40);
      expect(body.latest_player_metrics.request_queue_items).toBeNull();
      heartbeatObject.mockResolvedValue(currentHeartbeatPayload);

      vi.stubGlobal('fetch', vi.fn(async () => vectorResponse([
        { metric: { __name__: 'up', job: 'players', device_id: screenId }, value: '0' },
        { metric: { __name__: 'darshan_player_system_cpu_usage_percent', device_id: screenId }, value: '91' },
      ])));
      response = await respond();
      body = response.json();
      expect(body.player_scrape.status).toBe('down');
      expect(body.latest_player_metrics.cpu_percent).toBe(34.5);

      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        status: 'success',
        data: { resultType: 'vector', result: [
          { metric: { __name__: 'up', job: 'players', device_id: screenId }, value: [Date.now() / 1000, '1'] },
          { metric: { __name__: 'darshan_player_system_cpu_usage_percent', device_id: screenId }, value: [Date.now() / 1000 - 600, '91'] },
        ] },
      }), { status: 200, headers: { 'content-type': 'application/json' } })));
      response = await respond();
      body = response.json();
      expect(body.player_scrape.status).toBe('up');
      expect(body.latest_player_metrics.cpu_percent).toBe(34.5);

      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        status: 'success',
        data: { resultType: 'vector', result: [
          { metric: { __name__: 'up', job: 'players', device_id: screenId }, value: [Date.now() / 1000 - 600, '1'] },
          { metric: { __name__: 'darshan_player_system_cpu_usage_percent', device_id: screenId }, value: [Date.now() / 1000 - 600, '91'] },
        ] },
      }), { status: 200, headers: { 'content-type': 'application/json' } })));
      response = await respond();
      body = response.json();
      expect(body.player_scrape.status).toBe('unavailable');
      expect(body.latest_player_metrics.cpu_percent).toBe(34.5);

      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Prometheus unavailable'); }));
      response = await respond();
      body = response.json();
      expect(body.player_scrape.status).toBe('unavailable');
      expect(body.latest_player_metrics.cpu_percent).toBe(34.5);

      await db.update(schema.heartbeats).set({ created_at: new Date(Date.now() - 10 * 60_000) }).where(eq(schema.heartbeats.id, heartbeat.id));
      response = await respond();
      body = response.json();
      expect(body.latest_player_metrics_source).toBe('none');
      expect(body.latest_player_metrics.cpu_percent).toBeNull();
    } finally {
      await db.delete(schema.heartbeats).where(eq(schema.heartbeats.id, heartbeat.id));
      await db.delete(schema.storageObjects).where(eq(schema.storageObjects.id, storageObjectId));
      await db.delete(schema.screens).where(eq(schema.screens.id, screenId));
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
