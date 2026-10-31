import { createHash } from 'node:crypto';
import type {
  FastifyInstance,
  FastifyReply,
  HTTPMethods,
  RouteOptions,
} from 'fastify';
import type { Pool } from 'pg';
import { apiEndpoints } from '@/config/apiEndpoints';
import { AppError } from '@/utils/app-error';
import { MaintenanceCoordinator } from './coordinator';
import { MaintenanceCoordinatorError } from './errors';
import { MaintenanceOperationScope } from './operation-scope';
import { MaintenanceWatchdog } from './watchdog';

export const MAINTENANCE_ADMISSION_ERROR_MESSAGE =
  'CMS mutations are temporarily paused while a maintenance capture is in progress.';

export type HttpAdmissionClass =
  | 'GATED_MUTATION'
  | 'GATED_HIDDEN_MUTATION'
  | 'READ'
  | 'OPERATIONAL'
  | 'PREEMPTIVE'
  | 'COORDINATOR'
  | 'PROTOCOL';

export interface HttpAdmissionClassification {
  readonly admissionClass: HttpAdmissionClass;
  readonly gated: boolean;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const READ_METHODS = new Set(['GET', 'HEAD']);
const PROTOCOL_METHODS = new Set(['OPTIONS']);

const HIDDEN_MUTATIONS = new Set([
  `GET ${apiEndpoints.media.uploadSession}`,
  `HEAD ${apiEndpoints.media.uploadSession}`,
]);

// These routes must remain available while the CMS write barrier is closed.
// Keep the list method-and-template exact: pairing and CMS command creation
// deliberately remain ordinary mutations even though their paths look related.
const OPERATIONAL_MUTATIONS = new Set([
  `POST ${apiEndpoints.auth.login}`,
  `POST ${apiEndpoints.auth.logout}`,
  `POST ${apiEndpoints.deviceTelemetry.heartbeat}`,
  `POST ${apiEndpoints.deviceTelemetry.proofOfPlay}`,
  `POST ${apiEndpoints.deviceTelemetry.screenshot}`,
  `POST ${apiEndpoints.deviceTelemetry.mediaCacheReport}`,
  `POST ${apiEndpoints.deviceTelemetry.ackCommand}`,
]);

const PREEMPTIVE_MUTATIONS = new Set([
  `POST ${apiEndpoints.emergency.trigger}`,
  `POST ${apiEndpoints.emergency.clear}`,
]);

const COORDINATOR_MUTATIONS = new Set([
  `POST ${apiEndpoints.settings.backupRun}`,
]);

function normalizedRouteUrl(url: string): string {
  if (url.length > 1 && url.endsWith('/')) return url.slice(0, -1);
  return url;
}

/**
 * Total, registration-time classification for the HTTP methods Fastify routes
 * may expose. New CMS mutation methods fail registration instead of silently
 * bypassing the barrier.
 */
export function classifyHttpAdmission(method: string, url: string): HttpAdmissionClassification {
  const normalizedMethod = method.toUpperCase();
  const routeKey = `${normalizedMethod} ${normalizedRouteUrl(url)}`;

  if (HIDDEN_MUTATIONS.has(routeKey)) {
    return { admissionClass: 'GATED_HIDDEN_MUTATION', gated: true };
  }
  if (OPERATIONAL_MUTATIONS.has(routeKey)) {
    return { admissionClass: 'OPERATIONAL', gated: false };
  }
  if (PREEMPTIVE_MUTATIONS.has(routeKey)) {
    return { admissionClass: 'PREEMPTIVE', gated: false };
  }
  if (COORDINATOR_MUTATIONS.has(routeKey)) {
    return { admissionClass: 'COORDINATOR', gated: false };
  }
  if (MUTATION_METHODS.has(normalizedMethod)) {
    return { admissionClass: 'GATED_MUTATION', gated: true };
  }
  if (READ_METHODS.has(normalizedMethod)) {
    return { admissionClass: 'READ', gated: false };
  }
  if (PROTOCOL_METHODS.has(normalizedMethod)) {
    return { admissionClass: 'PROTOCOL', gated: false };
  }
  throw new Error(`HTTP maintenance admission has no classification for ${routeKey}.`);
}

function routeMethods(method: HTTPMethods | HTTPMethods[]): string[] {
  return (Array.isArray(method) ? method : [method]).map((value) => value.toUpperCase());
}

function operationKind(method: string, url: string): string {
  const value = `http:${method.toLowerCase()}:${normalizedRouteUrl(url)}`;
  if (value.length <= 80) return value;
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `${value.slice(0, 67)}:${digest}`;
}

function admissionUnavailable(error: MaintenanceCoordinatorError, reply: FastifyReply): AppError {
  const retryAt = error.details?.retryAt;
  if (typeof retryAt === 'string' || retryAt instanceof Date) {
    const retryAtMs = retryAt instanceof Date ? retryAt.getTime() : Date.parse(retryAt);
    if (Number.isFinite(retryAtMs)) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000))));
    }
  }
  return new AppError({
    statusCode: 503,
    code: 'MAINTENANCE_ADMISSION_CLOSED',
    message: MAINTENANCE_ADMISSION_ERROR_MESSAGE,
    details: { retryable: true },
  });
}

export interface HttpAdmissionRuntime {
  readonly coordinator: MaintenanceCoordinator;
  readonly scope: MaintenanceOperationScope;
  readonly watchdog: MaintenanceWatchdog | null;
}

export interface InstallHttpAdmissionOptions {
  readonly pool: Pool;
  readonly siteKey: string;
  readonly coordinator?: MaintenanceCoordinator;
  readonly startWatchdog?: boolean;
  readonly watchdogIntervalMs?: number;
  readonly onWatchdogError?: (error: unknown) => void;
}

/** Installs the hook before routes are registered so every handler is classified. */
export async function installHttpAdmission(
  fastify: FastifyInstance,
  options: InstallHttpAdmissionOptions
): Promise<HttpAdmissionRuntime> {
  const coordinator = options.coordinator ?? new MaintenanceCoordinator(options.pool);
  const scope = new MaintenanceOperationScope(coordinator);

  fastify.addHook('onRoute', (routeOptions: RouteOptions) => {
    const methods = routeMethods(routeOptions.method);
    const classifications = methods.map((method) => classifyHttpAdmission(method, routeOptions.url));
    const gatedMethods = methods.filter((_method, index) => classifications[index].gated);
    if (gatedMethods.length === 0) return;
    if (gatedMethods.length !== methods.length) {
      throw new Error(
        `Route ${routeOptions.url} mixes gated and ungated methods; register each method separately.`
      );
    }

    const originalHandler = routeOptions.handler;
    const kind = operationKind(methods.join('+'), routeOptions.url);
    routeOptions.handler = async function maintenanceAdmissionHandler(request, reply) {
      try {
        return await scope.run(
          { siteKey: options.siteKey, operationKind: kind },
          async () => originalHandler.call(this, request, reply)
        );
      } catch (error) {
        if (
          error instanceof MaintenanceCoordinatorError &&
          error.code === 'MAINTENANCE_ADMISSION_CLOSED'
        ) {
          throw admissionUnavailable(error, reply);
        }
        throw error;
      }
    } as typeof routeOptions.handler;
  });

  const watchdog = options.startWatchdog === false
    ? null
    : new MaintenanceWatchdog(
        coordinator.store,
        options.watchdogIntervalMs,
        options.onWatchdogError
      );
  if (watchdog) await watchdog.start();
  fastify.addHook('onClose', async () => {
    await watchdog?.stop();
  });

  return { coordinator, scope, watchdog };
}
