import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, lstat, chmod, symlink, unlink, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisorHeartbeat, supervise } from '../src/supervisor.js';
import { fileURLToPath } from 'node:url';
import { temporaryTmpfs } from './fixtures/tmpfs-directory.mjs';

test('supervisor writes atomic private heartbeat with boot domain and increasing sequence', async (t) => {
  const directory = await temporaryTmpfs('darshan-supervisor-heartbeat-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o700);
  const file = path.join(directory, 'supervisor.json');
  const instance = randomUUID();
  const writer = createSupervisorHeartbeat(file, instance);
  writer.write('STARTING');
  const first = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(first.instance_id, instance);
  assert.equal(first.supervisor_pid, process.pid);
  assert.match(first.process_start_ticks, /^\d+$/);
  assert.ok(first.boottime_ms > 0);
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  writer.write('RUNNING');
  const second = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(second.sequence, first.sequence + 1);
  assert.equal(second.boot_id, first.boot_id);
  assert.equal(second.phase, 'RUNNING');
  await unlink(file);
  await symlink('/dev/null', file);
  assert.throws(() => writer.write('RUNNING'), /Invalid watchdog file/);
});

test('supervisor refuses shared directory before creating heartbeat or media children', async (t) => {
  const directory = await temporaryTmpfs('darshan-supervisor-permission-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o755);
  assert.throws(() => createSupervisorHeartbeat(path.join(directory, 'supervisor.json'), randomUUID()), /privately owned/);
});

test('a resumed supervisor cannot overwrite stale evidence with a fresh RUNNING heartbeat', async (t) => {
  const directory = await temporaryTmpfs('darshan-supervisor-resume-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o700);
  const file = path.join(directory, 'supervisor.json');
  let now = 10_000;
  const writer = createSupervisorHeartbeat(file, randomUUID(), { boottimeNow: () => now });
  writer.write('RUNNING');
  const prior = await readFile(file, 'utf8');
  now += 1501;
  assert.throws(() => writer.write('RUNNING'), /boot-clock gap/);
  assert.equal(await readFile(file, 'utf8'), prior);
});

test('disk-backed heartbeat directory is rejected before any SFU child can start', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  if ((await statfs(root)).type === 0x01021994) return t.skip('No separate disk-backed project filesystem is available');
  const directory = await mkdtemp(path.join(root, '.heartbeat-disk-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o700);
  const file = path.join(directory, 'supervisor.json');
  const marker = path.join(directory, 'child-started');
  assert.throws(() => createSupervisorHeartbeat(file, randomUUID()), /must use tmpfs/);
  await assert.rejects(supervise({
    sfuCommand: [process.execPath, '-e', 'require("fs").writeFileSync(process.argv[1],"started")', marker],
    env: { ...process.env, DARSHAN_MEDIA_SUPERVISOR_STATE_FILE: file, DARSHAN_MEDIA_NODE_INSTANCE_ID: randomUUID() },
  }), (error) => error.code === 'SUPERVISOR_HEARTBEAT_REQUIRES_TMPFS');
  await assert.rejects(lstat(marker), (error) => error.code === 'ENOENT');
  await assert.rejects(lstat(file), (error) => error.code === 'ENOENT');
});
