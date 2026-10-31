import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requestConfigurationCapsule, validateConfigurationCapsule } from './configuration-capsule.js';

const roots: string[] = [];
const siteId = 'site-a';
const runId = randomUUID();
const attemptId = randomUUID();
const helperVersion = '1.0.0';

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'darshan-capsule-test-'));
  roots.push(root);
  await fs.chmod(root, 0o700);
  const content = Buffer.from('synthetic-secret-value');
  await fs.writeFile(join(root, 'backend.env'), content, { mode: 0o600 });
  return {
    root,
    receipt: {
      version: 1,
      helper_version: helperVersion,
      site_id: siteId,
      run_id: runId,
      attempt_id: attemptId,
      capsule_generation: 'deployment-generation-7',
      created_at: new Date().toISOString(),
      entries: [{
        logical_name: 'backend-runtime',
        relative_path: 'backend.env',
        size_bytes: String(content.length),
        sha256: createHash('sha256').update(content).digest('hex'),
      }],
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('configuration capsule validation', () => {
  it('accepts the exact protected allowlisted capsule and reports bigint bytes', async () => {
    const { root, receipt } = await fixture();
    const result = await validateConfigurationCapsule({
      destinationRoot: root,
      receipt,
      expectedSiteId: siteId,
      expectedRunId: runId,
      expectedAttemptId: attemptId,
      expectedHelperVersion: helperVersion,
      contract: [{ logicalName: 'backend-runtime', required: true, maxBytes: 1024n }],
    });
    expect(result.totalBytes).toBe(22n);
  });

  it('rejects missing required and unexpected logical entries', async () => {
    const { root, receipt } = await fixture();
    await expect(validateConfigurationCapsule({
      destinationRoot: root,
      receipt: { ...receipt, entries: [] },
      expectedSiteId: siteId,
      expectedRunId: runId,
      expectedAttemptId: attemptId,
      expectedHelperVersion: helperVersion,
      contract: [{ logicalName: 'backend-runtime', required: true, maxBytes: 1024n }],
    })).rejects.toMatchObject({ code: 'BACKUP_CAPSULE_REQUIRED_ENTRY_MISSING' });

    await expect(validateConfigurationCapsule({
      destinationRoot: root,
      receipt,
      expectedSiteId: siteId,
      expectedRunId: runId,
      expectedAttemptId: attemptId,
      expectedHelperVersion: helperVersion,
      contract: [],
    })).rejects.toMatchObject({ code: 'BACKUP_CAPSULE_UNEXPECTED_ENTRY' });
  });

  it('rejects tampering, unsafe paths, permissive files and identity drift', async () => {
    const { root, receipt } = await fixture();
    await fs.writeFile(join(root, 'backend.env'), 'changed', { mode: 0o600 });
    await expect(validateConfigurationCapsule({
      destinationRoot: root,
      receipt,
      expectedSiteId: siteId,
      expectedRunId: runId,
      expectedAttemptId: attemptId,
      expectedHelperVersion: helperVersion,
      contract: [{ logicalName: 'backend-runtime', required: true, maxBytes: 1024n }],
    })).rejects.toMatchObject({ code: 'BACKUP_CAPSULE_ENTRY_INVALID' });

    const unsafe = { ...receipt, entries: [{ ...receipt.entries[0], relative_path: '../backend.env' }] };
    await expect(validateConfigurationCapsule({
      destinationRoot: root,
      receipt: unsafe,
      expectedSiteId: siteId,
      expectedRunId: runId,
      expectedAttemptId: attemptId,
      expectedHelperVersion: helperVersion,
      contract: [{ logicalName: 'backend-runtime', required: true, maxBytes: 1024n }],
    })).rejects.toMatchObject({ code: 'BACKUP_CAPSULE_UNSAFE_PATH' });

    await expect(validateConfigurationCapsule({
      destinationRoot: root,
      receipt,
      expectedSiteId: 'different-site',
      expectedRunId: runId,
      expectedAttemptId: attemptId,
      expectedHelperVersion: helperVersion,
      contract: [{ logicalName: 'backend-runtime', required: true, maxBytes: 1024n }],
    })).rejects.toMatchObject({ code: 'BACKUP_CAPSULE_IDENTITY_MISMATCH' });
  });

  it('rejects undeclared files and undeclared or unsafe parent entries', async () => {
    const { root, receipt } = await fixture();
    await fs.writeFile(join(root, 'unapproved-secret'), 'must-not-be-packaged', { mode: 0o600 });
    await expect(validateConfigurationCapsule({
      destinationRoot: root,
      receipt,
      expectedSiteId: siteId,
      expectedRunId: runId,
      expectedAttemptId: attemptId,
      expectedHelperVersion: helperVersion,
      contract: [{ logicalName: 'backend-runtime', required: true, maxBytes: 1024n }],
    })).rejects.toMatchObject({ code: 'BACKUP_CAPSULE_UNEXPECTED_ENTRY' });

    await fs.rm(join(root, 'unapproved-secret'));
    await fs.symlink('/tmp', join(root, 'unexpected-link'));
    await expect(validateConfigurationCapsule({
      destinationRoot: root,
      receipt,
      expectedSiteId: siteId,
      expectedRunId: runId,
      expectedAttemptId: attemptId,
      expectedHelperVersion: helperVersion,
      contract: [{ logicalName: 'backend-runtime', required: true, maxBytes: 1024n }],
    })).rejects.toMatchObject({ code: 'BACKUP_CAPSULE_ENTRY_INVALID' });
  });

  it('bounds an oversized receipt even when the helper ignores SIGTERM', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'darshan-capsule-overflow-'));
    roots.push(root);
    const destination = join(root, 'destination');
    await fs.mkdir(destination, { mode: 0o700 });
    const helperPath = join(root, 'helper');
    const source = `#!${process.execPath}\nprocess.on('SIGTERM', () => {});\nprocess.stdout.write('x'.repeat(${1024 * 1024 + 1}));\nsetInterval(() => {}, 1000);\n`;
    await fs.writeFile(helperPath, source, { mode: 0o700 });
    const helperSha256 = createHash('sha256').update(source).digest('hex');

    await expect(requestConfigurationCapsule({
      helperPath,
      expectedHelperVersion: helperVersion,
      expectedHelperSha256: helperSha256,
      siteId,
      runId,
      attemptId,
      destinationRoot: destination,
      allowedDestinationRoot: root,
      contract: [],
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'BACKUP_CAPSULE_RECEIPT_TOO_LARGE' });
  }, 10_000);
});
