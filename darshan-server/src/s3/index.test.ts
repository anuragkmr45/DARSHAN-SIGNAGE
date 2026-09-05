import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

class MockCommand {
  constructor(public readonly input: Record<string, unknown>) {}
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mocks.send })),
  PutObjectCommand: MockCommand,
  GetObjectCommand: MockCommand,
  DeleteObjectCommand: MockCommand,
  HeadObjectCommand: MockCommand,
  HeadBucketCommand: MockCommand,
  CreateBucketCommand: MockCommand,
  CreateMultipartUploadCommand: MockCommand,
  UploadPartCommand: MockCommand,
  CompleteMultipartUploadCommand: MockCommand,
  AbortMultipartUploadCommand: MockCommand,
  ListPartsCommand: MockCommand,
  CopyObjectCommand: MockCommand,
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

vi.mock('@/observability/metrics', () => ({
  observeS3Operation: (_operation: string, action: () => Promise<unknown>) => action(),
}));

describe('createBucketIfNotExists', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadS3() {
    const s3 = await import('./index');
    s3.initializeS3();
    return s3;
  }

  it('does not create a bucket that already exists', async () => {
    mocks.send.mockResolvedValueOnce({});
    const { createBucketIfNotExists } = await loadS3();

    await expect(createBucketIfNotExists('media-source')).resolves.toBeUndefined();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].input).toEqual({ Bucket: 'media-source' });
  });

  it('creates a bucket after a not-found head response', async () => {
    mocks.send
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NotFound' }))
      .mockResolvedValueOnce({});
    const { createBucketIfNotExists } = await loadS3();

    await expect(createBucketIfNotExists('media-ready')).resolves.toBeUndefined();

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls.map(([command]) => command.input)).toEqual([
      { Bucket: 'media-ready' },
      { Bucket: 'media-ready' },
    ]);
  });

  it('treats concurrent bucket creation by the same credential as idempotent', async () => {
    mocks.send
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockRejectedValueOnce(Object.assign(new Error('already owned'), { name: 'BucketAlreadyOwnedByYou' }));
    const { createBucketIfNotExists } = await loadS3();

    await expect(createBucketIfNotExists('logs-system')).resolves.toBeUndefined();
  });

  it('does not treat an existing bucket owned by another account as success', async () => {
    mocks.send
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockRejectedValueOnce(Object.assign(new Error('name taken'), { name: 'BucketAlreadyExists' }));
    const { createBucketIfNotExists } = await loadS3();

    await expect(createBucketIfNotExists('archives')).rejects.toThrow('name taken');
  });

  it('does not create a bucket when head fails for a non-not-found reason', async () => {
    mocks.send.mockRejectedValueOnce(Object.assign(new Error('access denied'), { name: 'AccessDenied' }));
    const { createBucketIfNotExists } = await loadS3();

    await expect(createBucketIfNotExists('media-source')).rejects.toThrow('access denied');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
