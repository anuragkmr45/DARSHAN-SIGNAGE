import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runWithWorkerAdmissionMock } = vi.hoisted(() => ({
  runWithWorkerAdmissionMock: vi.fn(async () => undefined),
}));

vi.mock('@/maintenance/worker-admission', () => ({
  runWithWorkerAdmission: runWithWorkerAdmissionMock,
}));

const {
  cleanupChatMediaAssets,
  cleanupDeletedUserUploads,
  cleanupOrphanedStorageObjects,
  processWebpageRefreshDueJob,
  processWebpageVerifyCaptureJob,
  requestWebpagePreviewRefresh,
} = await import('@/jobs');

describe('direct content mutation job admission', () => {
  beforeEach(() => {
    runWithWorkerAdmissionMock.mockClear();
  });

  it('gates every exported content-mutating service entry point before work starts', async () => {
    const mediaId = randomUUID();

    await processWebpageVerifyCaptureJob({ mediaId, sourceUrl: 'https://example.test' });
    await requestWebpagePreviewRefresh({ mediaId });
    await processWebpageRefreshDueJob({});
    await cleanupChatMediaAssets({ mediaAssetIds: [mediaId] });
    await cleanupDeletedUserUploads();
    await cleanupOrphanedStorageObjects();

    expect(runWithWorkerAdmissionMock.mock.calls.map(([queueName]) => queueName)).toEqual([
      'webpage:verify-capture',
      'webpage:verify-capture',
      'webpage:refresh-due',
      'chat:media-cleanup',
      'cleanup',
      'cleanup',
    ]);
    for (const [, work] of runWithWorkerAdmissionMock.mock.calls) {
      expect(work).toEqual(expect.any(Function));
    }
  });
});
