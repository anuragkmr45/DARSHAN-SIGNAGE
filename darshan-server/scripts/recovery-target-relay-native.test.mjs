import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const sourceRoot = new URL('../', import.meta.url).pathname;
const listenerSource = join(sourceRoot, 'src/native/recovery-target-relay-listener.c');
const roots = [];
function quoted(name, value) { return `-D${name}="${value}"`; }
async function waitFor(predicate, timeout = 3000) { const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error('fixture deadline exceeded'); }

async function fixture(options = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'target-relay-native-')); roots.push(root);
  const socketParent = join(root, 'socket'); const authority = join(root, 'authority');
  await Promise.all([fs.mkdir(socketParent), fs.mkdir(authority)]); await fs.chmod(socketParent, 0o710); await fs.chmod(authority, 0o700);
  const socket = join(socketParent, 'relay.sock'); const listener = join(root, 'listener'); const worker = join(root, 'worker.mjs');
  const processTree = join(root, 'process-tree.json');
  await fs.writeFile(worker, `import { spawn } from 'node:child_process';import { readFileSync,writeFileSync } from 'node:fs';let b=[];for await(const c of process.stdin)b.push(c);const q=Buffer.concat(b).toString();if(q.includes('tree')){process.on('SIGTERM',()=>{});const x=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});const pgrp=p=>readFileSync('/proc/'+p+'/stat','utf8').split(' ')[4];writeFileSync(${JSON.stringify(processTree)},JSON.stringify({workerPid:process.pid,workerPgid:pgrp(process.pid),descendantPid:x.pid,descendantPgid:pgrp(x.pid)}));setInterval(()=>{},1000)}else if(q.includes('hang'))setInterval(()=>{},1000);else if(q.includes('identity')){const s=await import('node:fs/promises').then(x=>x.readFile('/proc/self/status','utf8'));const v=n=>s.match(new RegExp('^'+n+':\\\\s+([^\\\\n]+)','m'))?.[1];process.stdout.write(JSON.stringify({uid:v('Uid'),gid:v('Gid'),nnp:v('NoNewPrivs'),cap:v('CapEff')})+'\\n')}else process.stdout.write('{"ok":true}\\n');`, { mode: 0o600 });
  const uid = process.getuid(), gid = process.getgid();
  const flags = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', quoted('TARGET_RELAY_SOCKET_PATH', socket),
    quoted('TARGET_RELAY_AUTHORITY_DIRECTORY', authority), quoted('TARGET_RELAY_CONFIG_FILE', join(root, 'relay.json')),
    quoted('TARGET_RELAY_NODE_PATH', process.execPath), quoted('TARGET_RELAY_WORKER_PATH', worker),
    `-DTARGET_RELAY_SUPERVISOR_UID=${uid}`, `-DTARGET_RELAY_RUNNER_UID=${options.runnerUid ?? uid}`,
    `-DTARGET_RELAY_RUNNER_GID=${gid}`, `-DTARGET_RELAY_UID=${uid}`, `-DTARGET_RELAY_GID=${gid}`,
    '-DTARGET_RELAY_SKIP_PRIVILEGE_DROP=1', '-DDRAIN_MILLISECONDS=200', '-DTERM_MILLISECONDS=100', '-o', listener, listenerSource];
  const compiled = spawnSync('cc', flags, { encoding: 'utf8' }); assert.equal(compiled.status, 0, compiled.stderr);
  return { root, socketParent, authority, socket, listener, processTree };
}

async function start(value) { const child = spawn(value.listener, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  await waitFor(async () => (await fs.lstat(value.socket).catch(() => undefined))?.isSocket() || child.exitCode !== null); return child; }
async function stop(child, signal = 'SIGTERM') { child.kill(signal); return new Promise((resolve) => child.once('exit', (code) => resolve(code))); }
function exchange(socketPath, bytes) { return new Promise((resolve, reject) => { const chunks = []; const socket = net.createConnection(socketPath);
  socket.on('connect', () => socket.end(bytes)); socket.on('data', (chunk) => chunks.push(chunk)); socket.on('error', reject);
  socket.on('end', () => resolve(Buffer.concat(chunks))); }); }

test.after(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

test('relay listener admits only exact runner uid and preserves exact socket evidence on TERM', async () => {
  const value = await fixture(); const listener = await start(value);
  assert.deepEqual(await exchange(value.socket, '{"request":true}\n'), Buffer.from('{"ok":true}\n'));
  const socketState = await fs.lstat(value.socket); assert.equal(socketState.mode & 0o777, 0o660);
  assert.equal(await stop(listener), 143); await assert.rejects(fs.lstat(value.socket), { code: 'ENOENT' });
  assert.equal((await fs.readdir(value.socketParent)).filter((name) => name.includes('.closed.')).length, 1);
});

test('wrong peer uid is rejected without a worker response', async () => {
  const value = await fixture({ runnerUid: process.getuid() + 1 }); const listener = await start(value);
  const response = await exchange(value.socket, '{"request":true}\n').catch(() => Buffer.alloc(0)); assert.equal(response.byteLength, 0);
  await stop(listener);
});

test('four live children are the hard admission bound', async () => {
  const value = await fixture(); const listener = await start(value); const clients = [];
  for (let index = 0; index < 4; index++) clients.push(net.createConnection(value.socket));
  await Promise.all(clients.map((socket) => new Promise((resolve, reject) => { socket.once('connect', () => { socket.write('{"hang":true}\n'); resolve(); }); socket.once('error', reject); })));
  const fifth = net.createConnection(value.socket); await new Promise((resolve, reject) => { fifth.once('connect', resolve); fifth.once('error', reject); });
  fifth.end('{"request":true}\n'); await new Promise((resolve) => fifth.once('close', resolve));
  for (const client of clients) client.destroy(); assert.equal(await stop(listener), 143);
});

test('worker process group contains and reaps a TERM-resistant descendant before authority release', async () => {
  const value = await fixture(); const listener = await start(value); const client = net.createConnection(value.socket);
  await new Promise((resolve, reject) => { client.once('connect', () => { client.end('{"tree":true}\n'); resolve(); }); client.once('error', reject); });
  await waitFor(async () => Boolean(await fs.lstat(value.processTree).catch(() => undefined)));
  const tree = JSON.parse(await fs.readFile(value.processTree, 'utf8'));
  assert.equal(String(tree.workerPid), tree.workerPgid); assert.equal(tree.descendantPgid, tree.workerPgid);
  assert.equal(await stop(listener), 143);
  for (const pid of [tree.workerPid, tree.descendantPid]) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.throws(() => process.kill(-tree.workerPid, 0), { code: 'ESRCH' });
});

test('OFD authority contention and corrupt authority fail closed without repair', async () => {
  const value = await fixture(); const first = await start(value);
  const second = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 1000 }); assert.equal(second.status, 78); assert.match(second.stderr, /authority unavailable/);
  await stop(first); const path = join(value.authority, 'instance-authority'); const malformed = Buffer.from('corrupt\n'); await fs.writeFile(path, malformed);
  const rejected = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 1000 }); assert.equal(rejected.status, 78);
  assert.deepEqual(await fs.readFile(path), malformed);
});

test('SIGKILL leaves crash socket evidence and restart does not unlink it', async () => {
  const value = await fixture(); const first = await start(value); await stop(first, 'SIGKILL'); assert.equal((await fs.lstat(value.socket)).isSocket(), true);
  const rejected = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 1000 }); assert.equal(rejected.status, 78); assert.equal((await fs.lstat(value.socket)).isSocket(), true);
});
