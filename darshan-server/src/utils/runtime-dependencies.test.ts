import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalEnv = { ...process.env };
const executable = (directory: string, name: string) => {
  const path = join(directory, name);
  writeFileSync(path, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return path;
};

function minimumEnv() {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/darshan_test';
  process.env.JWT_SECRET = '12345678901234567890123456789012';
  process.env.MINIO_ACCESS_KEY = 'minioadmin';
  process.env.MINIO_SECRET_KEY = 'minioadmin';
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('runtime dependencies after browser removal', () => {
  it('requires LibreOffice for API PDF exports and all worker tools for processing', async () => {
    minimumEnv();
    process.env.PATH = '';
    process.env.FFMPEG_PATH = '/missing-ffmpeg';
    process.env.LIBREOFFICE_PATH = '/missing-soffice';
    process.env.PG_DUMP_PATH = '/missing-pg-dump';
    process.env.TAR_PATH = '/missing-tar';
    const { inspectRuntimeDependencies, validateRuntimeDependencies } = await import('@/utils/runtime-dependencies');
    const api = await inspectRuntimeDependencies('api');
    expect(api.dependencies.find((item) => item.name === 'libreoffice')?.status).toBe('missing');
    expect(api.dependencies.some((item) => item.name === 'chromium')).toBe(false);
    await expect(validateRuntimeDependencies('api')).rejects.toThrow('libreoffice');
    const worker = await inspectRuntimeDependencies('worker');
    expect(worker.dependencies.filter((item) => item.status === 'missing')).toHaveLength(4);
  });

  it('resolves host overrides without a browser executable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'darshan-runtime-'));
    minimumEnv();
    process.env.PATH = '';
    process.env.FFMPEG_PATH = executable(directory, 'ffmpeg');
    process.env.LIBREOFFICE_PATH = executable(directory, 'soffice');
    process.env.PG_DUMP_PATH = executable(directory, 'pg_dump');
    process.env.TAR_PATH = executable(directory, 'tar');
    const { inspectRuntimeDependencies, validateRuntimeDependencies } = await import('@/utils/runtime-dependencies');
    const report = await inspectRuntimeDependencies('worker');
    expect(report.dependencies.map((item) => item.name)).toEqual(['ffmpeg', 'libreoffice', 'pg_dump', 'tar']);
    expect(report.dependencies.every((item) => item.status === 'available')).toBe(true);
    await expect(validateRuntimeDependencies('worker')).resolves.toBeDefined();
  });
});
