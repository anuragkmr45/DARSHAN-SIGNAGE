import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runWithWorkerAdmissionMock } = vi.hoisted(() => ({
  runWithWorkerAdmissionMock: vi.fn(async (queueName: string, _work: () => Promise<unknown>) => queueName),
}));

vi.mock('@/maintenance/worker-admission', () => ({
  runWithWorkerAdmission: runWithWorkerAdmissionMock,
}));

const {
  processHeartbeatTelemetry,
  processProofOfPlayTelemetry,
  processScreenshotTelemetry,
} = await import('./device-telemetry');
const { processDeviceOperationalObservation } = await import('./device-operational-observation');
const { processMediaCacheReportTelemetry } = await import('./media-cache-report');

describe('direct telemetry processor admission', () => {
  beforeEach(() => {
    runWithWorkerAdmissionMock.mockClear();
  });

  it('routes every exported processor through its gated queue identity', async () => {
    await processHeartbeatTelemetry({} as never);
    await processProofOfPlayTelemetry({} as never);
    await processScreenshotTelemetry({} as never);
    await processDeviceOperationalObservation({} as never);
    await processMediaCacheReportTelemetry({} as never);

    expect(runWithWorkerAdmissionMock.mock.calls.map(([queueName]) => queueName)).toEqual([
      'telemetry:heartbeat',
      'telemetry:proof-of-play',
      'telemetry:screenshot',
      'telemetry:device-observation',
      'telemetry:media-cache-report',
    ]);
    for (const [, work] of runWithWorkerAdmissionMock.mock.calls) {
      expect(work).toEqual(expect.any(Function));
    }
  });
});
