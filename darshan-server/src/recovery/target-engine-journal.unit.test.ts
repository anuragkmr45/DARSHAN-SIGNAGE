import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { TargetEngineJournal, type TargetEngineJournalIdentityV1 } from './target-engine-journal';

const roots: string[] = [];
const d = (character: string) => character.repeat(64);
const h = (kind: string, suffix: string) => `tra:v1:${kind}:${suffix.padEnd(16, 'x')}` as const;
const requestId = '00000000-0000-4000-8000-000000000010';

async function root(): Promise<string> {
  const value = await fs.mkdtemp(join(tmpdir(), 'darshan-engine-journal-')); roots.push(value); await fs.chmod(value, 0o700); return value;
}

function fullBinding() { return { operationId: '00000000-0000-4000-8000-000000000001',
    siteId: 'site-a', hostInstallationId: '00000000-0000-4000-8000-000000000002', planSha256: d('1'),
    targetSetId: d('2'), generation: 1, targetSpecificationSha256: d('3'), outerEnvelopeSha256: d('4'),
    authorizationSha256: d('5'), enrollmentSha256: d('6'), executionProfileSha256: d('7'),
    protectedInventorySha256: d('8') }; }
function identity(): TargetEngineJournalIdentityV1 {
  const binding = fullBinding();
  return { targetHandle: h('target', 'journal'), binding: { operationId: binding.operationId, siteId: binding.siteId,
    hostInstallationId: binding.hostInstallationId, planSha256: binding.planSha256, targetSetId: binding.targetSetId,
    generation: binding.generation, targetSpecificationSha256: binding.targetSpecificationSha256,
    enrollmentSha256: binding.enrollmentSha256, executionProfileSha256: binding.executionProfileSha256,
    protectedInventorySha256: binding.protectedInventorySha256 } };
}

const intent = { binding: fullBinding(), phase: 'INTENT' as const, action: 'PREPARE' as const, step: 'ADMIT_EXISTING_RESOURCES' as const,
  requestId, commandSha256: null, resourceAdmissionSha256: d('9'), resultSha256: null,
  observationSha256: null, lifecycleIdentitySha256: null, terminalState: null };
const receipt = { ...intent, phase: 'RECEIPT' as const, resultSha256: d('a'), observationSha256: d('b'),
  lifecycleIdentitySha256: d('c') };

afterEach(async () => { await Promise.all(roots.splice(0).map((value) => fs.rm(value, { recursive: true, force: true }))); });

describe('Packet 05B1b3b1b target-engine journal', () => {
  it('publishes a canonical append-only hash chain and replays exact duplicates', async () => {
    const journal = new TargetEngineJournal({ root: await root(), now: () => new Date('2026-10-29T00:00:00.000Z') });
    await journal.withTarget(identity(), async (scoped) => {
      const first = await scoped.append(intent); expect(first.body.sequence).toBe('0');
      expect((await scoped.append(intent)).recordSha256).toBe(first.recordSha256);
      const second = await scoped.append(receipt); expect(second.body.previousSha256).toBe(first.recordSha256);
    });
    await expect(journal.read(identity())).resolves.toHaveLength(2);
  });

  it('fails closed on a conflicting pending intent', async () => {
    const journal = new TargetEngineJournal({ root: await root() });
    await journal.withTarget(identity(), async (scoped) => {
      await scoped.append(intent);
      await expect(scoped.append({ ...intent, step: 'ENSURE_INTERNAL_NETWORK', commandSha256: d('c') }))
        .rejects.toThrow(/pending|transition/i);
    });
  });

  it('rejects a receipt whose command or admission digest differs from its exact INTENT', async () => {
    const journal = new TargetEngineJournal({ root: await root() });
    await expect(journal.withTarget(identity(), async (scoped) => {
      await scoped.append(intent);
      await scoped.append({ ...receipt, commandSha256: d('d'), resourceAdmissionSha256: d('e') });
    })).rejects.toThrow(/receipt differs|transition|invalid/i);
  });

  it('adopts the no-clobber hard-link publication after a crash following the link', async () => {
    const path = await root(); let faulted = false;
    const crashing = new TargetEngineJournal({ root: path, fault: async (stage) => {
      if (!faulted && stage === 'after-link-before-directory-fsync') { faulted = true; throw new Error('fixture crash'); }
    } });
    await expect(crashing.withTarget(identity(), async (scoped) => scoped.append(intent))).rejects.toThrow('fixture crash');
    const restarted = new TargetEngineJournal({ root: path });
    const records = await restarted.read(identity()); expect(records).toHaveLength(1);
    expect(records[0]!.body.phase).toBe('INTENT');
  });

  it('reconciles a retained pending/final same-inode publication and rejects a conflicting pending inode', async () => {
    const path = await root(); const journal = new TargetEngineJournal({ root: path });
    await journal.withTarget(identity(), async (scoped) => { await scoped.append(intent); });
    const target = join(path, 'targets', d('2')); const final = (await fs.readdir(target)).find((name) => name.endsWith('.json'))!;
    const pending = join(target, '.pending'); await fs.link(join(target, final), join(pending, `${randomUUID()}.tmp`));
    await expect(journal.read(identity())).resolves.toHaveLength(1);
    expect(await fs.readdir(pending)).toHaveLength(1);
    await journal.withTarget(identity(), async () => undefined);
    expect(await fs.readdir(pending)).toEqual([]);
    await fs.writeFile(join(pending, `${randomUUID()}.tmp`), 'conflicting pending', { mode: 0o600 });
    await expect(journal.read(identity())).rejects.toThrow(/pending publication evidence/i);
  });

  it.each([
    'after-temp-fsync-before-link',
    'after-link-before-directory-fsync',
    'after-directory-fsync-before-temp-unlink',
  ] as const)('fails closed at publication crash boundary %s and leaves only recoverable truth', async (faultStage) => {
    const path = await root(); let injected = false;
    const journal = new TargetEngineJournal({ root: path, fault: async (stage) => {
      if (!injected && stage === faultStage) { injected = true; const error = new Error('injected ENOSPC-like failure');
        Object.assign(error, { code: 'ENOSPC' }); throw error; }
    } });
    await expect(journal.withTarget(identity(), async (scoped) => scoped.append(intent))).rejects.toThrow(/ENOSPC-like/);
    const restarted = new TargetEngineJournal({ root: path });
    const records = await restarted.read(identity());
    expect(records).toHaveLength(faultStage === 'after-temp-fsync-before-link' ? 0 : 1);
    if (records.length === 1) expect(records[0]!.body.phase).toBe('INTENT');
  });

  it.each(['orphan', 'reordered', 'duplicate'] as const)('rejects %s record naming/topology', async (mutation) => {
    const path = await root(); const journal = new TargetEngineJournal({ root: path });
    await journal.withTarget(identity(), async (scoped) => { await scoped.append(intent); await scoped.append(receipt); });
    const target = join(path, 'targets', d('2')); const names = (await fs.readdir(target)).filter((name) => name.endsWith('.json')).sort();
    if (mutation === 'orphan') await fs.writeFile(join(target, `00000000000000000002-${d('c')}.json`), '{}', { mode: 0o600 });
    if (mutation === 'reordered') await fs.rename(join(target, names[0]!), join(target, names[0]!.replace(/^0+0-/, '00000000000000000002-')));
    if (mutation === 'duplicate') await fs.copyFile(join(target, names[0]!), join(target, `00000000000000000002-${d('d')}.json`));
    await expect(journal.read(identity())).rejects.toThrow(/contiguous|filename|corrupt|invalid/i);
  });

  it('rejects conflicting bytes, record-count overflow, symlink, hardlink, unsafe directory mode, and unsafe root', async () => {
    const conflictRoot = await root(); const conflict = new TargetEngineJournal({ root: conflictRoot });
    await conflict.withTarget(identity(), async (scoped) => { await scoped.append(intent); });
    const conflictTarget = join(conflictRoot, 'targets', d('2'));
    const conflictName = (await fs.readdir(conflictTarget)).find((name) => name.endsWith('.json'))!;
    const bytes = await fs.readFile(join(conflictTarget, conflictName)); bytes[bytes.length - 2] ^= 1;
    await fs.writeFile(join(conflictTarget, conflictName), bytes);
    await expect(conflict.read(identity())).rejects.toThrow(/invalid|corrupt/i);

    const countRoot = await root(); const count = new TargetEngineJournal({ root: countRoot });
    await count.withTarget(identity(), async (scoped) => { await scoped.append(intent); });
    const countTarget = join(countRoot, 'targets', d('2'));
    for (let index = 1; index <= 64; index += 1) {
      await fs.writeFile(join(countTarget, `${String(index).padStart(20, '0')}-${index.toString(16).padStart(64, '0')}.json`),
        '{}', { mode: 0o600 });
    }
    await expect(count.read(identity())).rejects.toThrow(/bound|contiguous/i);

    const linkRoot = await root(); const links = new TargetEngineJournal({ root: linkRoot });
    await links.withTarget(identity(), async (scoped) => { await scoped.append(intent); });
    const linkTarget = join(linkRoot, 'targets', d('2')); const linkName = (await fs.readdir(linkTarget)).find((name) => name.endsWith('.json'))!;
    await fs.link(join(linkTarget, linkName), join(linkTarget, `00000000000000000001-${d('e')}.json`));
    await expect(links.read(identity())).rejects.toThrow(/unsafe|corrupt|contiguous/i);

    const symlinkRoot = await root(); const symlinks = new TargetEngineJournal({ root: symlinkRoot });
    await symlinks.withTarget(identity(), async (scoped) => { await scoped.append(intent); });
    const symlinkTarget = join(symlinkRoot, 'targets', d('2')); const symlinkName = (await fs.readdir(symlinkTarget)).find((name) => name.endsWith('.json'))!;
    const outside = join(symlinkRoot, 'outside'); await fs.writeFile(outside, '{}', { mode: 0o600 });
    await fs.unlink(join(symlinkTarget, symlinkName)); await fs.symlink(outside, join(symlinkTarget, symlinkName));
    await expect(symlinks.read(identity())).rejects.toThrow(/unsafe|safely|corrupt/i);

    const modeRoot = await root(); await fs.chmod(modeRoot, 0o755);
    await expect(new TargetEngineJournal({ root: modeRoot }).read(identity())).rejects.toThrow(/protected/i);
    expect(() => new TargetEngineJournal({ root: '/' })).toThrow(/safe canonical/i);
  });

  it('rejects link, mode, owner/device/size/time and byte instability instead of trusting a pathname', async () => {
    const path = await root(); const journal = new TargetEngineJournal({ root: path });
    await journal.withTarget(identity(), async (scoped) => { await scoped.append(intent); });
    const target = join(path, 'targets', d('2')); const name = (await fs.readdir(target)).find((value) => value.endsWith('.json'))!;
    await fs.chmod(join(target, name), 0o644);
    await expect(journal.read(identity())).rejects.toThrow(/unsafe|corrupt/i);
  });

  it.each(['inode', 'size', 'mtime', 'ctime'] as const)(
    'detects an actual %s mutation between record fstat snapshots', async (mutation) => {
      const path = await root(); const writer = new TargetEngineJournal({ root: path });
      await writer.withTarget(identity(), async (scoped) => { await scoped.append(intent); });
      let injected = false;
      const reader = new TargetEngineJournal({ root: path, readHook: async (recordPath) => {
        if (injected) return; injected = true;
        if (mutation === 'inode') {
          const displaced = `${recordPath}.displaced`; await fs.rename(recordPath, displaced);
          await fs.copyFile(displaced, recordPath); await fs.chmod(recordPath, 0o600);
        } else if (mutation === 'size') {
          await fs.writeFile(recordPath, Buffer.from('x'), { flag: 'a' });
        } else if (mutation === 'mtime') {
          const future = new Date(Date.now() + 60_000); await fs.utimes(recordPath, future, future);
        } else {
          await fs.chmod(recordPath, 0o400); await fs.chmod(recordPath, 0o600);
        }
      } });
      await expect(reader.read(identity())).rejects.toThrow(/changed|unsafe|corrupt/i);
      expect(injected).toBe(true);
    });

  it.each(['dead-pid', 'wrong-boot', 'wrong-start', 'malformed', 'multi-link', 'owner-artifact'] as const)(
    'preserves an existing %s lock byte-for-byte and never enters the callback', async (kind) => {
      const path = await root(); const lock = join(path, '.engine.lock');
      const bootId = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      const stat = await fs.readFile(`/proc/${process.pid}/stat`, 'utf8');
      const processStartTicks = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]!;
      const bytes = kind === 'malformed' ? Buffer.from('partial-owner') : canonicalJson({
        bootId: kind === 'wrong-boot' ? randomUUID() : bootId,
        instanceId: randomUUID(),
        pid: kind === 'dead-pid' || kind === 'multi-link' || kind === 'owner-artifact' ? 2_147_483_647 : process.pid,
        processStartTicks: kind === 'wrong-start' ? `${BigInt(processStartTicks) + 1n}` : processStartTicks,
      });
      await fs.writeFile(lock, bytes, { mode: 0o600 });
      if (kind === 'multi-link') await fs.link(lock, join(path, `.engine.lock.owner-${randomUUID()}`));
      if (kind === 'owner-artifact') {
        await fs.writeFile(join(path, `.engine.lock.owner-${randomUUID()}`), Buffer.from('abandoned-owner'), { mode: 0o600 });
      }
      const names = (await fs.readdir(path)).filter((name) => name.startsWith('.engine.lock')).sort();
      const before = await Promise.all(names.map(async (name) => {
        const value = await fs.lstat(join(path, name), { bigint: true });
        return { name, dev: value.dev, ino: value.ino, nlink: value.nlink, bytes: await fs.readFile(join(path, name)) };
      }));
      let entered = false;
      await expect(new TargetEngineJournal({ root: path }).withTarget(identity(), async () => { entered = true; }))
        .rejects.toMatchObject({ code: 'RECOVERY_LOCK_HELD' });
      expect(entered).toBe(false);
      const afterNames = (await fs.readdir(path)).filter((name) => name.startsWith('.engine.lock')).sort();
      expect(afterNames).toEqual(names);
      const after = await Promise.all(names.map(async (name) => {
        const value = await fs.lstat(join(path, name), { bigint: true });
        return { name, dev: value.dev, ino: value.ino, nlink: value.nlink, bytes: await fs.readFile(join(path, name)) };
      }));
      expect(after).toEqual(before);
    });

  it('does not mutate an existing lock or create artifacts under concurrent attempts', async () => {
    const path = await root(); const lock = join(path, '.engine.lock'); const bytes = Buffer.from('existing-lock');
    await fs.writeFile(lock, bytes, { mode: 0o600 }); const before = await fs.lstat(lock, { bigint: true });
    let entered = 0;
    const attempts = await Promise.allSettled([1, 2].map(async () =>
      new TargetEngineJournal({ root: path }).withTarget(identity(), async () => { entered += 1; })));
    expect(attempts.every((attempt) => attempt.status === 'rejected' &&
      (attempt.reason as { code?: string }).code === 'RECOVERY_LOCK_HELD')).toBe(true);
    expect(entered).toBe(0);
    const after = await fs.lstat(lock, { bigint: true });
    expect({ dev: after.dev, ino: after.ino, nlink: after.nlink }).toEqual({ dev: before.dev, ino: before.ino, nlink: before.nlink });
    expect(await fs.readFile(lock)).toEqual(bytes);
    expect((await fs.readdir(path)).filter((name) => name.startsWith('.engine.lock'))).toEqual(['.engine.lock']);
  });

  it('allows one absent-lock publisher, rejects its contender, and preserves the winner inode', async () => {
    const path = await root(); const lock = join(path, '.engine.lock');
    let ready = 0; let bothReady!: () => void; let publish!: () => void; let entered!: () => void; let release!: () => void;
    const bothReadyPromise = new Promise<void>((resolve) => { bothReady = resolve; });
    const publishPromise = new Promise<void>((resolve) => { publish = resolve; });
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const fault = async (stage: string) => {
      if (stage !== 'after-lock-temp-create') return;
      ready += 1; if (ready === 2) bothReady(); await publishPromise;
    };
    const attempt = () => new TargetEngineJournal({ root: path, fault }).withTarget(identity(), async () => {
      entered(); await releasePromise; return 'winner';
    }).then((value) => ({ status: 'winner' as const, value }),
    (cause: unknown) => ({ status: 'held' as const, cause }));
    const first = attempt(); const second = attempt();
    await bothReadyPromise; publish(); await enteredPromise;
    const loser = await Promise.race([first, second]);
    expect(loser.status).toBe('held');
    if (loser.status === 'held') expect(loser.cause).toMatchObject({ code: 'RECOVERY_LOCK_HELD' });
    const published = await fs.lstat(lock, { bigint: true });
    const afterLoser = await fs.lstat(lock, { bigint: true });
    expect({ dev: afterLoser.dev, ino: afterLoser.ino, nlink: afterLoser.nlink })
      .toEqual({ dev: published.dev, ino: published.ino, nlink: published.nlink });
    expect((await fs.readdir(path)).filter((name) => name.startsWith('.engine.lock'))).toEqual(['.engine.lock']);
    release(); const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual(['held', 'winner']);
    await expect(fs.lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['after-lock-temp-create', 'after-lock-link-before-temp-unlink'] as const)(
    'cleans only its own lock inode after initialization failure at %s and permits retry', async (faultStage) => {
      const path = await root(); let injected = false;
      const faulted = new TargetEngineJournal({ root: path, fault: async (stage) => {
        if (!injected && stage === faultStage) { injected = true; throw new Error('owner initialization fault'); }
      } });
      await expect(faulted.withTarget(identity(), async () => undefined)).rejects.toThrow('owner initialization fault');
      expect((await fs.readdir(path)).filter((name) => name.startsWith('.engine.lock'))).toEqual([]);
      await expect(new TargetEngineJournal({ root: path }).withTarget(identity(), async () => 'retried')).resolves.toBe('retried');
    });

  it('releases its own lock after normal return and callback failure', async () => {
    const path = await root(); const lock = join(path, '.engine.lock'); const journal = new TargetEngineJournal({ root: path });
    await expect(journal.withTarget(identity(), async () => 'done')).resolves.toBe('done');
    await expect(fs.lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(journal.withTarget(identity(), async () => { throw new Error('callback failure'); }))
      .rejects.toThrow('callback failure');
    await expect(fs.lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(path)).filter((name) => name.startsWith('.engine.lock'))).toEqual([]);
  });
});

