import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from './backup-broker-protocol';
import {
  assertRepositoryStillMatches,
  ensureRepositoryDirectory,
  fsyncDirectory,
  repositoryPath,
  type LocalRepository,
} from './local-repository';

const AUTHORITY_DIRECTORY = 'broker-authority';
const AUTHORITY_OWNER_FILE = 'owner.json';
const RECOVERY_DIRECTORY = 'broker-authority-recovery';
const AUTHORITY_FORMAT = 'darshan-backup-repository-authority-v1' as const;

const ownerSchema = z.object({
  format: z.literal(AUTHORITY_FORMAT),
  site_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  repository_id: z.string().uuid(),
  owner_instance_id: z.string().uuid(),
  fence_token: z.string().uuid(),
  pid: z.number().int().positive().safe(),
  process_start_ticks: z.string().regex(/^[1-9][0-9]*$/),
  boot_id: z.string().uuid(),
  socket_path_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  acquired_at: z.string().datetime({ offset: true }),
}).strict();

export type RepositoryAuthorityOwner = z.infer<typeof ownerSchema>;

export class RepositoryAuthorityError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RepositoryAuthorityError';
  }
}

async function processStartTicks(pid: number): Promise<string | undefined> {
  let text: string;
  try { text = await fs.readFile(`/proc/${pid}/stat`, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'Unable to prove the repository authority owner is dead.', { cause: error });
  }
  const close = text.lastIndexOf(')');
  const fields = close >= 0 ? text.slice(close + 2).trim().split(/\s+/) : [];
  const start = fields[19];
  if (!start || !/^[1-9][0-9]*$/.test(start)) {
    throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'The repository authority process identity is unreadable.');
  }
  return start;
}

async function bootId(): Promise<string> {
  let value: string;
  try { value = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim().toLowerCase(); }
  catch (error) { throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'The host boot identity is unavailable.', { cause: error }); }
  if (!z.string().uuid().safeParse(value).success) throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'The host boot identity is invalid.');
  return value;
}

async function validateAuthorityDirectory(repository: LocalRepository, path: string): Promise<void> {
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== repository.deviceId ||
      Number(stat.uid) !== repository.ownerUid || Number(stat.gid) !== repository.ownerGid ||
      Number(stat.mode & 0o777n) !== 0o700 || await fs.realpath(path) !== path) {
    throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNSAFE', 'Repository authority storage is unsafe.');
  }
}

async function readOwner(repository: LocalRepository, directory: string): Promise<RepositoryAuthorityOwner> {
  await validateAuthorityDirectory(repository, directory);
  const path = join(directory, AUTHORITY_OWNER_FILE);
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev.toString() !== repository.deviceId || Number(before.uid) !== repository.ownerUid ||
        Number(before.gid) !== repository.ownerGid || Number(before.mode & 0o777n) !== 0o600 || before.nlink !== 1n ||
        before.size < 1n || before.size > 64n * 1024n) {
      throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNSAFE', 'Repository authority owner evidence is unsafe.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || BigInt(bytes.byteLength) !== before.size) {
      throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'Repository authority owner evidence changed while read.');
    }
    try { return ownerSchema.parse(parseStrictJson(bytes, 64 * 1024)); }
    catch (cause) { throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'Repository authority owner evidence is invalid.', { cause }); }
  } finally { await handle.close(); }
}

async function writeOwner(directory: string, owner: RepositoryAuthorityOwner): Promise<void> {
  const path = join(directory, AUTHORITY_OWNER_FILE);
  const handle = await fs.open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(canonicalJson(owner)); await handle.sync(); }
  finally { await handle.close(); }
  await fsyncDirectory(directory);
}

export class RepositoryMutationAuthority {
  private constructor(
    private readonly repository: LocalRepository,
    readonly owner: RepositoryAuthorityOwner,
  ) {}

  static async acquire(input: { repository: LocalRepository; socketPath: string; now?: Date }): Promise<RepositoryMutationAuthority> {
    await assertRepositoryStillMatches(input.repository);
    const directory = repositoryPath(input.repository, AUTHORITY_DIRECTORY);
    const recovery = await ensureRepositoryDirectory(input.repository, RECOVERY_DIRECTORY);
    const currentBootId = await bootId();
    const currentStart = await processStartTicks(process.pid);
    if (!currentStart) throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'Current process identity disappeared during authority acquisition.');
    const owner: RepositoryAuthorityOwner = {
      format: AUTHORITY_FORMAT,
      site_id: input.repository.identity.site_id,
      repository_id: input.repository.identity.repository_id,
      owner_instance_id: randomUUID(),
      fence_token: randomUUID(),
      pid: process.pid,
      process_start_ticks: currentStart,
      boot_id: currentBootId,
      socket_path_sha256: createHash('sha256').update(input.socketPath, 'utf8').digest('hex'),
      acquired_at: (input.now ?? new Date()).toISOString(),
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await fs.mkdir(directory, { mode: 0o700 });
        await writeOwner(directory, owner);
        await fsyncDirectory(input.repository.root);
        return new RepositoryMutationAuthority(input.repository, owner);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          await fs.rm(directory, { recursive: false }).catch(() => undefined);
          throw error;
        }
      }

      const existing = await readOwner(input.repository, directory);
      if (existing.repository_id !== input.repository.identity.repository_id || existing.site_id !== input.repository.identity.site_id) {
        throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'Repository authority identity does not match this repository.');
      }
      const liveStart = existing.boot_id === currentBootId ? await processStartTicks(existing.pid) : undefined;
      if (liveStart === existing.process_start_ticks) {
        throw new RepositoryAuthorityError('BROKER_AUTHORITY_CONTENDED', 'Another exact process identity owns repository mutation authority and may have an active listener.');
      }
      if (liveStart !== undefined) {
        throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'Repository authority PID was reused and crash recovery is uncertain.');
      }
      const stale = join(recovery, `${existing.owner_instance_id}.${existing.fence_token}`);
      try { await fs.rename(directory, stale); await fsyncDirectory(input.repository.root); await fsyncDirectory(recovery); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw new RepositoryAuthorityError('BROKER_AUTHORITY_UNCERTAIN', 'Failed to atomically preserve stale authority evidence.', { cause: error });
      }
    }
    throw new RepositoryAuthorityError('BROKER_AUTHORITY_CONTENDED', 'Repository mutation authority changed during acquisition.');
  }

  async assertCurrent(): Promise<void> {
    await assertRepositoryStillMatches(this.repository);
    const current = await readOwner(this.repository, repositoryPath(this.repository, AUTHORITY_DIRECTORY));
    if (canonicalJson(current).compare(canonicalJson(this.owner)) !== 0) {
      throw new RepositoryAuthorityError('BROKER_AUTHORITY_STALE_FENCE', 'Repository mutation authority fence is stale.');
    }
    const currentBoot = await bootId();
    const currentStart = await processStartTicks(this.owner.pid);
    if (currentBoot !== this.owner.boot_id || currentStart !== this.owner.process_start_ticks) {
      throw new RepositoryAuthorityError('BROKER_AUTHORITY_STALE_FENCE', 'Repository mutation authority process identity is stale.');
    }
  }

  async release(): Promise<void> {
    await this.assertCurrent();
    const directory = repositoryPath(this.repository, AUTHORITY_DIRECTORY);
    const recovery = await ensureRepositoryDirectory(this.repository, RECOVERY_DIRECTORY);
    const released = join(recovery, `${this.owner.owner_instance_id}.${this.owner.fence_token}.released`);
    await fs.rename(directory, released);
    await fsyncDirectory(this.repository.root);
    await fsyncDirectory(recovery);
    await fs.unlink(join(released, AUTHORITY_OWNER_FILE));
    await fs.rmdir(released);
    await fsyncDirectory(recovery);
  }
}
