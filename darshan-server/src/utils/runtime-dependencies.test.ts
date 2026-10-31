import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'os';
import { join } from 'path';

describe('runtime dependency resolution', () => {
  const originalEnv = { ...process.env };

  function applyMinimumEnv() {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/darshan';
    process.env.JWT_SECRET = process.env.JWT_SECRET || '12345678901234567890123456789012';
    process.env.MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
    process.env.MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
    process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
    process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LocalDev@123';
  }

  function createExecutable(binDir: string, name: string) {
    const executableName = process.platform === 'win32' ? `${name}.exe` : name;
    const executablePath = join(binDir, executableName);
    writeFileSync(executablePath, process.platform === 'win32' ? '@echo off\r\necho ok\r\n' : '#!/bin/sh\necho ok\n', {
      mode: 0o755,
    });
    return executablePath;
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.unmock('playwright');
  });

  it('finds bare executables through PATH for runtime doctor checks', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'darshan-runtime-bin-'));
    mkdirSync(binDir, { recursive: true });
    createExecutable(binDir, 'pg_dump');
    const chromiumPath = createExecutable(binDir, 'chromium');

    vi.doMock('playwright', () => ({
      chromium: {
        executablePath: () => chromiumPath,
      },
    }));

    process.env.PATH = binDir;
    applyMinimumEnv();

    const { inspectRuntimeDependencies } = await import('@/utils/runtime-dependencies');
    const report = await inspectRuntimeDependencies();
    const pgDump = report.dependencies.find((dependency) => dependency.name === 'pg_dump');

    expect(pgDump?.status).toBe('available');
    expect(pgDump?.path).toContain(process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
  });

  it('honors explicit executable overrides for host-run parity', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'darshan-runtime-override-'));
    mkdirSync(binDir, { recursive: true });

    const ffmpegPath = createExecutable(binDir, 'custom-ffmpeg');
    const sofficePath = createExecutable(binDir, 'custom-soffice');
    const pgDumpPath = createExecutable(binDir, 'custom-pg-dump');
    const tarPath = createExecutable(binDir, 'custom-tar');
    const agePath = createExecutable(binDir, 'custom-age');
    const chromiumPath = createExecutable(binDir, 'custom-chromium');

    process.env.FFMPEG_PATH = ffmpegPath;
    process.env.LIBREOFFICE_PATH = sofficePath;
    process.env.PG_DUMP_PATH = pgDumpPath;
    process.env.TAR_PATH = tarPath;
    process.env.AGE_PATH = agePath;
    process.env.AGE_VERSION = 'ok';
    process.env.AGE_SHA256 = createHash('sha256').update(readFileSync(agePath)).digest('hex');
    process.env.DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH = chromiumPath;
    process.env.PATH = '';
    applyMinimumEnv();

    const { inspectRuntimeDependencies } = await import('@/utils/runtime-dependencies');
    const report = await inspectRuntimeDependencies();

    expect(report.dependencies.every((dependency) => dependency.status === 'available')).toBe(true);
    expect(report.dependencies.find((dependency) => dependency.name === 'ffmpeg')?.path).toBe(ffmpegPath);
    expect(report.dependencies.find((dependency) => dependency.name === 'libreoffice')?.path).toBe(sofficePath);
    expect(report.dependencies.find((dependency) => dependency.name === 'pg_dump')?.path).toBe(pgDumpPath);
    expect(report.dependencies.find((dependency) => dependency.name === 'tar')?.path).toBe(tarPath);
    expect(report.dependencies.find((dependency) => dependency.name === 'age')?.path).toBe(agePath);
    expect(report.dependencies.find((dependency) => dependency.name === 'chromium')?.path).toBe(chromiumPath);
  });

  it('reports pinned age version and executable digest metadata', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'darshan-runtime-age-'));
    mkdirSync(binDir, { recursive: true });
    const agePath = join(binDir, 'age');
    const ageContents = '#!/bin/sh\necho v1.3.2\n';
    writeFileSync(agePath, ageContents, { mode: 0o755 });
    const ageSha256 = createHash('sha256').update(ageContents).digest('hex');

    process.env.AGE_PATH = agePath;
    process.env.AGE_VERSION = '1.3.2';
    process.env.AGE_SHA256 = ageSha256;
    applyMinimumEnv();

    const { inspectRuntimeDependencies } = await import('@/utils/runtime-dependencies');
    const report = await inspectRuntimeDependencies('api');
    expect(report.dependencies.find((dependency) => dependency.name === 'age')).toMatchObject({
      status: 'available',
      path: agePath,
      version: '1.3.2',
      sha256: ageSha256,
    });
  });

  it('reports an age digest mismatch instead of trusting only the configured path', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'darshan-runtime-age-mismatch-'));
    mkdirSync(binDir, { recursive: true });
    const agePath = createExecutable(binDir, 'age');
    process.env.AGE_PATH = agePath;
    process.env.AGE_VERSION = 'ok';
    process.env.AGE_SHA256 = '0'.repeat(64);
    applyMinimumEnv();

    const { inspectRuntimeDependencies } = await import('@/utils/runtime-dependencies');
    const report = await inspectRuntimeDependencies('api');
    expect(report.dependencies.find((dependency) => dependency.name === 'age')).toMatchObject({
      status: 'optional',
      detail: 'age executable digest does not match pinned AGE_SHA256.',
    });
  });

  it('keeps the legacy HEXMON webpage capture path as a compatibility alias', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'darshan-runtime-legacy-'));
    mkdirSync(binDir, { recursive: true });
    const chromiumPath = createExecutable(binDir, 'legacy-chromium');

    process.env.HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH = chromiumPath;
    applyMinimumEnv();

    const { inspectRuntimeDependencies } = await import('@/utils/runtime-dependencies');
    const report = await inspectRuntimeDependencies('api');

    expect(report.dependencies.find((dependency) => dependency.name === 'chromium')?.path).toBe(chromiumPath);
  });

  it('finds Chromium in the Playwright browser cache when no explicit path is configured', async () => {
    const browserRoot = mkdtempSync(join(tmpdir(), 'darshan-ms-playwright-'));
    const chromiumDir = join(browserRoot, 'chromium-1234', 'chrome-linux64');
    mkdirSync(chromiumDir, { recursive: true });
    const chromiumPath = createExecutable(chromiumDir, 'chrome');

    vi.doMock('playwright', () => ({
      chromium: {
        executablePath: () => join(tmpdir(), 'missing-playwright-chromium'),
      },
    }));

    process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
    applyMinimumEnv();

    const { inspectRuntimeDependencies } = await import('@/utils/runtime-dependencies');
    const report = await inspectRuntimeDependencies('api');

    expect(report.dependencies.find((dependency) => dependency.name === 'chromium')?.path).toBe(chromiumPath);
  });

  it('fails fast when required host-run dependencies are missing', async () => {
    vi.doMock('playwright', () => ({
      chromium: {
        executablePath: () => join(tmpdir(), 'missing-playwright-chromium'),
      },
    }));

    process.env.FFMPEG_PATH = join(tmpdir(), 'missing-ffmpeg');
    process.env.LIBREOFFICE_PATH = join(tmpdir(), 'missing-soffice');
    process.env.PG_DUMP_PATH = join(tmpdir(), 'missing-pg-dump');
    process.env.TAR_PATH = join(tmpdir(), 'missing-tar');
    process.env.PATH = '';
    applyMinimumEnv();

    const { validateRuntimeDependencies } = await import('@/utils/runtime-dependencies');

    await expect(validateRuntimeDependencies()).rejects.toThrow('Missing required runtime dependencies');
  });

  it('treats chromium as optional unless a chromium path is explicitly configured', async () => {
    vi.doMock('playwright', () => ({
      chromium: {
        executablePath: () => join(tmpdir(), 'missing-playwright-chromium'),
      },
    }));

    const binDir = mkdtempSync(join(tmpdir(), 'darshan-runtime-core-'));
    mkdirSync(binDir, { recursive: true });
    createExecutable(binDir, 'ffmpeg');
    createExecutable(binDir, 'soffice');
    createExecutable(binDir, 'pg_dump');
    createExecutable(binDir, 'tar');

    process.env.PATH = binDir;
    applyMinimumEnv();

    const { inspectRuntimeDependencies, validateRuntimeDependencies } = await import('@/utils/runtime-dependencies');

    const report = await inspectRuntimeDependencies();
    expect(report.dependencies.find((dependency) => dependency.name === 'chromium')?.status).toBe('optional');
    await expect(validateRuntimeDependencies()).resolves.toBeDefined();
  });

  it('fails fast when an explicit chromium executable path is invalid', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'darshan-runtime-invalid-chromium-'));
    mkdirSync(binDir, { recursive: true });
    createExecutable(binDir, 'ffmpeg');
    createExecutable(binDir, 'soffice');
    createExecutable(binDir, 'pg_dump');
    createExecutable(binDir, 'tar');

    process.env.PATH = binDir;
    process.env.DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH = join(tmpdir(), 'missing-explicit-chromium');
    applyMinimumEnv();

    const { validateRuntimeDependencies } = await import('@/utils/runtime-dependencies');

    await expect(validateRuntimeDependencies()).rejects.toThrow('Missing required runtime dependencies: chromium');
  });

  it('allows api-only runtime when worker dependencies are absent', async () => {
    vi.doMock('playwright', () => ({
      chromium: {
        executablePath: () => join(tmpdir(), 'missing-playwright-chromium'),
      },
    }));

    process.env.FFMPEG_PATH = join(tmpdir(), 'missing-ffmpeg');
    process.env.LIBREOFFICE_PATH = join(tmpdir(), 'missing-soffice');
    process.env.PG_DUMP_PATH = join(tmpdir(), 'missing-pg-dump');
    process.env.TAR_PATH = join(tmpdir(), 'missing-tar');
    process.env.PATH = '';
    applyMinimumEnv();

    const { inspectRuntimeDependencies, validateRuntimeDependencies } = await import('@/utils/runtime-dependencies');

    const report = await inspectRuntimeDependencies('api');
    expect(report.dependencies.every((dependency) => dependency.status !== 'missing')).toBe(true);
    await expect(validateRuntimeDependencies('api')).resolves.toBeDefined();
  });
});
