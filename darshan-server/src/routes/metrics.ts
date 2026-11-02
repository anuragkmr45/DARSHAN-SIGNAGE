import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';

const logger = createLogger('metrics-routes');

export async function metricsRoutes(fastify: FastifyInstance) {
  const db = getDatabase();

  fastify.get(
    apiEndpoints.metrics.overview,
    {
      schema: {
        description: 'Dashboard metrics overview',
        tags: ['Metrics'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('read', 'Dashboard')) throw AppError.forbidden('Forbidden');

        const [usersCount] = await db.select({ count: sql<number>`count(*)` }).from(schema.users);
        const [mediaCount] = await db.select({ count: sql<number>`count(*)` }).from(schema.media);
        const [screensCount] = await db.select({ count: sql<number>`count(*)` }).from(schema.screens);

        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const [popDay] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.proofOfPlay)
          .where(gte(schema.proofOfPlay.created_at, dayAgo));

        const [popWeek] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.proofOfPlay)
          .where(gte(schema.proofOfPlay.created_at, weekAgo));

        const [onlineScreensCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.screens)
          .where(and(eq(schema.screens.status, 'ACTIVE'), gte(schema.screens.last_heartbeat_at, fiveMinutesAgo)));

        const [mediaStorageBytes] = await db
          .select({ total: sql<number>`COALESCE(SUM(${schema.media.source_size}), 0)` })
          .from(schema.media);

        const [activeSchedulesCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.schedules)
          .where(and(eq(schema.schedules.is_active, true), lte(schema.schedules.start_at, now), gt(schema.schedules.end_at, now)));

        const [heartbeatsLast5m] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.heartbeats)
          .where(gte(schema.heartbeats.created_at, fiveMinutesAgo));

        const [heartbeatsLast1h] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.heartbeats)
          .where(gte(schema.heartbeats.created_at, hourAgo));

        const [latestHeartbeat] = await db
          .select({ timestamp: sql<Date | null>`max(${schema.heartbeats.created_at})` })
          .from(schema.heartbeats);

        const totalScreens = Number(screensCount?.count || 0);
        const onlineScreens = Number(onlineScreensCount?.count || 0);
        const mediaStorageTotal = Number(mediaStorageBytes?.total || 0);
        const activeSchedules = Number(activeSchedulesCount?.count || 0);
        const [activeScreensNowRow] = await db
          .select({ count: sql<number>`count(DISTINCT ${schema.screens.id})` })
          .from(schema.screens)
          .where(
            sql`${schema.screens.status} = 'ACTIVE'
              AND (
                EXISTS (
                  SELECT 1
                  FROM ${schema.publishTargets}
                  INNER JOIN ${schema.publishes}
                    ON ${schema.publishTargets.publish_id} = ${schema.publishes.id}
                  INNER JOIN ${schema.schedules}
                    ON ${schema.publishes.schedule_id} = ${schema.schedules.id}
                  WHERE ${schema.publishTargets.screen_id} = ${schema.screens.id}
                    AND ${schema.publishes.status} = 'ACTIVE'
                    AND ${schema.publishes.taken_down_at} IS NULL
                    AND ${schema.schedules.is_active} = true
                    AND ${schema.schedules.start_at} <= ${sql.param(now, schema.schedules.start_at)}
                    AND ${schema.schedules.end_at} > ${sql.param(now, schema.schedules.end_at)}
                )
                OR EXISTS (
                  SELECT 1
                  FROM ${schema.publishTargets}
                  INNER JOIN ${schema.publishes}
                    ON ${schema.publishTargets.publish_id} = ${schema.publishes.id}
                  INNER JOIN ${schema.schedules}
                    ON ${schema.publishes.schedule_id} = ${schema.schedules.id}
                  INNER JOIN ${schema.screenGroupMembers}
                    ON ${schema.publishTargets.screen_group_id} = ${schema.screenGroupMembers.group_id}
                  WHERE ${schema.screenGroupMembers.screen_id} = ${schema.screens.id}
                    AND ${schema.publishTargets.screen_group_id} IS NOT NULL
                    AND ${schema.publishes.status} = 'ACTIVE'
                    AND ${schema.publishes.taken_down_at} IS NULL
                    AND ${schema.schedules.is_active} = true
                    AND ${schema.schedules.start_at} <= ${sql.param(now, schema.schedules.start_at)}
                    AND ${schema.schedules.end_at} > ${sql.param(now, schema.schedules.end_at)}
                )
                OR (
                  ${schema.screens.current_schedule_id} IS NOT NULL
                  AND ${schema.screens.last_heartbeat_at} IS NOT NULL
                  AND ${schema.screens.last_heartbeat_at} >= ${fiveMinutesAgo}
                  AND EXISTS (
                    SELECT 1
                    FROM ${schema.schedules}
                    WHERE ${schema.schedules.id} = ${schema.screens.current_schedule_id}
                      AND ${schema.schedules.is_active} = true
                      AND ${schema.schedules.start_at} <= ${sql.param(now, schema.schedules.start_at)}
                      AND ${schema.schedules.end_at} > ${sql.param(now, schema.schedules.end_at)}
                  )
                )
              )`
          );
        const activeScreensNow = Number(activeScreensNowRow?.count || 0);
        const deliveryEvidence = await db.execute<{
          applied_screens_now: number | string;
          reporting_playback_now: number | string;
          proof_observed_now: number | string;
        }>(sql`
          SELECT
            count(DISTINCT ${schema.publishTargets.screen_id}) FILTER (
              WHERE ${schema.publishTargets.applied_at} IS NOT NULL
            ) AS applied_screens_now,
            count(DISTINCT ${schema.publishTargets.screen_id}) FILTER (
              WHERE ${schema.publishTargets.applied_at} IS NOT NULL
                AND ${schema.screens.status} = 'ACTIVE'
                AND ${schema.screens.last_heartbeat_at} >= ${sql.param(fiveMinutesAgo, schema.screens.last_heartbeat_at)}
                AND ${schema.screens.current_schedule_id} = ${schema.schedules.id}
                AND jsonb_array_length(COALESCE(${schema.screens.active_slots}, '[]'::jsonb)) > 0
            ) AS reporting_playback_now,
            count(DISTINCT ${schema.publishTargets.screen_id}) FILTER (
              WHERE EXISTS (
                SELECT 1
                FROM ${schema.proofOfPlay}
                WHERE ${schema.proofOfPlay.publish_id} = ${schema.publishes.id}
                  AND ${schema.proofOfPlay.screen_id} = ${schema.publishTargets.screen_id}
                  AND ${schema.proofOfPlay.started_at} >= GREATEST(
                    ${schema.schedules.start_at}, ${schema.publishes.published_at}
                  )
                  AND ${schema.proofOfPlay.started_at} <= ${sql.param(now, schema.proofOfPlay.started_at)}
              )
            ) AS proof_observed_now
          FROM ${schema.publishTargets}
          INNER JOIN ${schema.publishes}
            ON ${schema.publishTargets.publish_id} = ${schema.publishes.id}
          INNER JOIN ${schema.schedules}
            ON ${schema.publishes.schedule_id} = ${schema.schedules.id}
          INNER JOIN ${schema.screens}
            ON ${schema.publishTargets.screen_id} = ${schema.screens.id}
          WHERE ${schema.publishTargets.screen_id} IS NOT NULL
            AND ${schema.publishes.status} = 'ACTIVE'
            AND ${schema.publishes.taken_down_at} IS NULL
            AND ${schema.schedules.is_active} = true
            AND ${schema.schedules.start_at} <= ${sql.param(now, schema.schedules.start_at)}
            AND ${schema.schedules.end_at} > ${sql.param(now, schema.schedules.end_at)}
        `);
        const evidenceRow = deliveryEvidence.rows[0];
        const lastHeartbeatAt = latestHeartbeat?.timestamp ? new Date(latestHeartbeat.timestamp) : null;
        const systemStatus =
          totalScreens === 0
            ? 'unconfigured'
            : !lastHeartbeatAt
              ? 'unknown'
              : lastHeartbeatAt >= fiveMinutesAgo
                ? 'healthy'
                : 'degraded';
        const healthResponse = { status: 'ok', timestamp: now.toISOString() };

        return reply.send({
          totals: {
            users: Number(usersCount?.count || 0),
            media: Number(mediaCount?.count || 0),
            screens: totalScreens,
          },
          screens: {
            total: totalScreens,
            online: onlineScreens,
            online_last_5m: onlineScreens,
          },
          storage: {
            media_bytes: mediaStorageTotal,
          },
          schedules: {
            active: activeSchedules,
            active_screens_now: activeScreensNow,
            assigned_screens_now: activeScreensNow,
            applied_screens_now: Number(evidenceRow?.applied_screens_now ?? 0),
            reporting_playback_now: Number(evidenceRow?.reporting_playback_now ?? 0),
            proof_observed_now: Number(evidenceRow?.proof_observed_now ?? 0),
          },
          proof_of_play: {
            last_24h: Number(popDay?.count || 0),
            last_7d: Number(popWeek?.count || 0),
          },
          system_health: {
            status: systemStatus,
            last_heartbeat_at: lastHeartbeatAt?.toISOString() ?? null,
            heartbeats: {
              last_5m: Number(heartbeatsLast5m?.count || 0),
              last_1h: Number(heartbeatsLast1h?.count || 0),
            },
            health_endpoint: healthResponse,
          },
        });
      } catch (error) {
        logger.error(error, 'Metrics error');
        return respondWithError(reply, error);
      }
    }
  );
}
