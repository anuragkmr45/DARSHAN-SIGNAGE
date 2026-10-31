import Fastify from 'fastify';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { apiEndpoints } from '@/config/apiEndpoints';
import { formatErrorResponse } from '@/utils/app-error';
import { toAppError } from '@/utils/errors';
import type { MaintenanceCoordinator, OperationPermit } from './coordinator';
import { MaintenanceCoordinatorError } from './errors';
import {
  classifyHttpAdmission,
  installHttpAdmission,
  MAINTENANCE_ADMISSION_ERROR_MESSAGE,
} from './http-admission';

function fakeCoordinator(open: boolean) {
  let admitted = 0;
  let completed = 0;
  const coordinator = {
    admit: async (input: { siteKey: string; operationKind: string }): Promise<OperationPermit> => {
      if (!open) {
        throw new MaintenanceCoordinatorError(
          'MAINTENANCE_ADMISSION_CLOSED',
          'closed',
          { retryAt: new Date(Date.now() + 60_000) }
        );
      }
      admitted += 1;
      return {
        operationId: `operation-${admitted}`,
        ownerToken: `owner-${admitted}`,
        siteKey: input.siteKey,
        generation: 1,
        operationKind: input.operationKind,
      };
    },
    heartbeat: async () => true,
    complete: async () => { completed += 1; },
    markUncertain: async () => undefined,
  } as unknown as MaintenanceCoordinator;
  return { coordinator, counts: () => ({ admitted, completed }) };
}

describe('HTTP maintenance admission classification', () => {
  it('gates ordinary CMS mutations by default', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(classifyHttpAdmission(method, '/api/v1/layouts/:id')).toEqual({
        admissionClass: 'GATED_MUTATION',
        gated: true,
      });
    }
  });

  it('keeps only exact auth and device delivery mutations operational', () => {
    expect(classifyHttpAdmission('POST', apiEndpoints.auth.login).admissionClass).toBe('OPERATIONAL');
    expect(classifyHttpAdmission('POST', apiEndpoints.auth.logout).admissionClass).toBe('OPERATIONAL');
    expect(classifyHttpAdmission('POST', apiEndpoints.deviceTelemetry.heartbeat).admissionClass).toBe('OPERATIONAL');
    expect(classifyHttpAdmission('POST', apiEndpoints.deviceTelemetry.ackCommand).admissionClass).toBe('OPERATIONAL');

    // Pairing and new CMS-authored device commands are ordinary changes.
    expect(classifyHttpAdmission('POST', apiEndpoints.devicePairing.request).gated).toBe(true);
    expect(classifyHttpAdmission('POST', apiEndpoints.devicePairing.confirm).gated).toBe(true);
    expect(classifyHttpAdmission('POST', apiEndpoints.deviceTelemetry.commands).gated).toBe(true);
  });

  it('uses exact preemptive and coordinator exemptions', () => {
    expect(classifyHttpAdmission('POST', apiEndpoints.emergency.trigger).admissionClass).toBe('PREEMPTIVE');
    expect(classifyHttpAdmission('POST', apiEndpoints.emergency.clear).admissionClass).toBe('PREEMPTIVE');
    expect(classifyHttpAdmission('POST', apiEndpoints.emergencyTypes.create).gated).toBe(true);
    expect(classifyHttpAdmission('POST', apiEndpoints.settings.backupRun).admissionClass).toBe('COORDINATOR');
    expect(classifyHttpAdmission('PUT', apiEndpoints.settings.backups).gated).toBe(true);
  });

  it('classifies the upload-session GET as a hidden writer', () => {
    expect(classifyHttpAdmission('GET', apiEndpoints.media.uploadSession)).toEqual({
      admissionClass: 'GATED_HIDDEN_MUTATION',
      gated: true,
    });
    expect(classifyHttpAdmission('GET', apiEndpoints.media.get)).toEqual({
      admissionClass: 'READ',
      gated: false,
    });
  });

  it('fails registration classification for an unsupported method', () => {
    expect(() => classifyHttpAdmission('PROPFIND', '/api/v1/media')).toThrow(
      'HTTP maintenance admission has no classification'
    );
  });

  it('returns a stable 503 while exact operational mutations bypass a closed barrier', async () => {
    const server = Fastify();
    server.setErrorHandler((error, request, reply) => {
      const appError = toAppError(error);
      reply.status(appError.statusCode).send(formatErrorResponse(appError, request.id));
    });
    const fake = fakeCoordinator(false);
    await installHttpAdmission(server, {
      pool: {} as Pool,
      siteKey: 'unit-site',
      coordinator: fake.coordinator,
      startWatchdog: false,
    });
    server.post('/api/v1/widgets', async () => ({ admitted: true }));
    server.get('/api/v1/widgets', async () => ({ read: true }));
    server.post(apiEndpoints.auth.login, async () => ({ auth: true }));
    server.post(apiEndpoints.deviceTelemetry.heartbeat, async () => ({ device: true }));
    server.post(apiEndpoints.settings.backupRun, async () => ({ backup: true }));
    server.post(apiEndpoints.devicePairing.request, async () => ({ pairing: true }));
    server.get(apiEndpoints.media.uploadSession, async () => ({ hidden: true }));

    try {
      const blocked = await server.inject({ method: 'POST', url: '/api/v1/widgets' });
      expect(blocked.statusCode).toBe(503);
      expect(blocked.json()).toMatchObject({
        error: {
          code: 'MAINTENANCE_ADMISSION_CLOSED',
          message: MAINTENANCE_ADMISSION_ERROR_MESSAGE,
          details: { retryable: true },
        },
      });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect((await server.inject({ method: 'GET', url: '/api/v1/widgets' })).statusCode).toBe(200);
      expect((await server.inject({ method: 'POST', url: apiEndpoints.auth.login })).statusCode).toBe(200);
      expect((await server.inject({ method: 'POST', url: apiEndpoints.deviceTelemetry.heartbeat })).statusCode).toBe(200);
      expect((await server.inject({ method: 'POST', url: apiEndpoints.settings.backupRun })).statusCode).toBe(200);
      expect((await server.inject({ method: 'POST', url: apiEndpoints.devicePairing.request })).statusCode).toBe(503);
      expect((await server.inject({
        method: 'GET',
        url: apiEndpoints.media.uploadSession.replace(':sessionId', 'session-1'),
      })).statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });

  it('reuses the handler permit for nested work and releases after a thrown handler', async () => {
    const server = Fastify();
    const fake = fakeCoordinator(true);
    const runtime = await installHttpAdmission(server, {
      pool: {} as Pool,
      siteKey: 'unit-site',
      coordinator: fake.coordinator,
      startWatchdog: false,
    });
    server.post('/api/v1/nested', async () => runtime.scope.run(
      { siteKey: 'unit-site', operationKind: 'inner' },
      async (permit) => ({ operationId: permit.operationId })
    ));
    server.post('/api/v1/throws', async () => {
      throw new Error('expected failure');
    });

    try {
      const nested = await server.inject({ method: 'POST', url: '/api/v1/nested' });
      expect(nested.json()).toEqual({ operationId: 'operation-1' });
      expect(fake.counts()).toEqual({ admitted: 1, completed: 1 });

      expect((await server.inject({ method: 'POST', url: '/api/v1/throws' })).statusCode).toBe(500);
      expect(fake.counts()).toEqual({ admitted: 2, completed: 2 });
    } finally {
      await server.close();
    }
  });
});
