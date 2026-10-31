import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const sourceRoot = new URL('../', import.meta.url).pathname;
const listenerSource = join(sourceRoot, 'src/native/recovery-target-helper-listener.c');
const bridgeSource = join(sourceRoot, 'src/native/recovery-target-stdio.c');
const roots = [];

async function waitFor(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('fixture deadline exceeded');
}

function quoted(name, value) { return `-D${name}="${value}"`; }

async function fixture(options = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'target-helper-native-')); roots.push(root);
  const socketParent = join(root, 'socket'); const authority = join(root, 'authority'); const journal = join(root, 'journal');
  await Promise.all([fs.mkdir(socketParent), fs.mkdir(authority), fs.mkdir(journal)]);
  await fs.chmod(socketParent, 0o710); await fs.chmod(authority, 0o700); await fs.chmod(journal, 0o700);
  const socket = join(socketParent, 'helper.sock'); const listener = join(root, 'listener'); const bridge = join(root, 'bridge');
  const undrained = join(root, 'undrained'); const undrainedSource = join(root, 'undrained.c');
  const worker = join(root, 'worker.mjs');
  await fs.writeFile(worker, `import { spawn } from 'node:child_process';import { promises as fs } from 'node:fs';\nlet b=[];for await(const c of process.stdin)b.push(c);\nconst q=Buffer.concat(b).toString();\nif(q.includes('hang')){const v={instanceAuthorityToken:process.env.DARSHAN_TARGET_HELPER_INSTANCE_AUTHORITY_TOKEN,instanceId:'00000000-0000-4000-8000-000000000001',pid:process.pid};await fs.writeFile(process.env.DARSHAN_TARGET_HELPER_JOURNAL_ROOT+'/.target-helper.lock',JSON.stringify(v),{mode:0o600});setInterval(()=>{},1000)}else if(q.includes('nested-detached-descendant')){const root=process.env.DARSHAN_TARGET_HELPER_JOURNAL_ROOT;const child=spawn(process.execPath,['-e',\"const{spawn}=require('child_process'),fs=require('fs');fs.writeFileSync(process.argv[1],String(process.pid));const timer=setInterval(()=>{if(!fs.existsSync(process.argv[2]))return;clearInterval(timer);const nested=spawn(process.execPath,['-e','process.on(\\\"SIGTERM\\\",()=>{});require(\\\"fs\\\").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)',process.argv[3]],{stdio:'ignore',detached:true});nested.unref()},10)\",root+'/nested-parent.pid',root+'/nested-parent-exit',root+'/nested-child.pid'],{stdio:'ignore',detached:true});child.unref();process.stdout.write('{"spawned":true}\\n')}else if(q.includes('detached-descendant')){const marker=process.env.DARSHAN_TARGET_HELPER_JOURNAL_ROOT+'/detached-descendant.pid';const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)\",marker],{stdio:'ignore',detached:true});child.unref();process.stdout.write('{"spawned":true}\\n')}else if(q.includes('descendant')){const marker=process.env.DARSHAN_TARGET_HELPER_JOURNAL_ROOT+'/descendant.pid';const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)\",marker],{stdio:'ignore'});child.unref();process.stdout.write('{"spawned":true}\\n')}else if(q.includes('fds')){const fds=[];for(const name of await fs.readdir('/proc/self/fd')){const n=Number(name);if(n<=2)continue;const target=await fs.readlink('/proc/self/fd/'+name).catch(()=>'<closed>');fds.push([n,target])}fds.sort((a,b)=>a[0]-b[0]);process.stdout.write(JSON.stringify({fds})+'\\n')}else if(q.includes('large')){process.stdout.write('x'.repeat(128*1024-1)+'\\n')}else if(q.includes('identity')){const s=await fs.readFile('/proc/self/status','utf8');const v=(n)=>s.match(new RegExp('^'+n+':\\\\s+([^\\\\n]+)','m'))?.[1];process.stdout.write(JSON.stringify({uid:v('Uid'),gid:v('Gid'),noNewPrivs:v('NoNewPrivs'),capEff:v('CapEff')})+'\\n')}else process.stdout.write('{"ok":true}\\n');\n`, { mode: 0o600 });
  const uid = process.getuid(); const gid = process.getgid();
  const common = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    quoted('TARGET_HELPER_SOCKET_PATH', socket), quoted('TARGET_HELPER_AUTHORITY_DIRECTORY', authority),
    quoted('TARGET_HELPER_JOURNAL_ROOT', journal), quoted('TARGET_HELPER_KEYRING_FILE', join(root, 'unused-keys')),
    quoted('TARGET_HELPER_NODE_PATH', process.execPath), quoted('TARGET_HELPER_WORKER_PATH', worker),
    `-DTARGET_HELPER_SUPERVISOR_UID=${uid}`, `-DTARGET_HELPER_BRIDGE_GID=${gid}`,
    `-DTARGET_HELPER_BRIDGE_UID=${options.bridgeUid ?? uid}`, `-DTARGET_HELPER_UID=${uid}`,
    `-DTARGET_HELPER_GID=${gid}`, '-DTARGET_HELPER_SKIP_PRIVILEGE_DROP=1', '-DTARGET_HELPER_LISTENER_TESTING=1'];
  const compiled = spawnSync('cc', [...common, '-o', listener, listenerSource], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const bridgeCompiled = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    quoted('TARGET_HELPER_SOCKET_PATH', socket), '-DIO_TIMEOUT_MILLISECONDS=2000', '-o', bridge, bridgeSource], { encoding: 'utf8' });
  assert.equal(bridgeCompiled.status, 0, bridgeCompiled.stderr);
  await fs.writeFile(undrainedSource, '#define _GNU_SOURCE\n#include <fcntl.h>\n#include <sys/wait.h>\n#include <unistd.h>\nint main(int c,char**v){int p[2],s;if(c!=2||pipe(p)<0||fcntl(p[1],F_SETPIPE_SZ,4096)<0)return 111;pid_t x=fork();if(x==0){close(p[0]);dup2(p[1],1);close(p[1]);execl(v[1],v[1],(char*)0);_exit(112);}close(p[1]);while(waitpid(x,&s,0)<0){}close(p[0]);return WIFEXITED(s)?WEXITSTATUS(s):113;}\n');
  const undrainedCompiled = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-o', undrained, undrainedSource], { encoding: 'utf8' });
  assert.equal(undrainedCompiled.status, 0, undrainedCompiled.stderr);
  return { root, socketParent, authority, journal, socket, listener, bridge, undrained };
}

async function start(value) {
  const child = spawn(value.listener, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  await waitFor(async () => (await fs.lstat(value.socket).catch(() => undefined))?.isSocket() || child.exitCode !== null);
  return child;
}

async function stop(child, signal = 'SIGTERM') {
  child.kill(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('listener did not stop')), 9000);
    child.once('exit', (code, exitSignal) => { clearTimeout(timer); resolve({ code, signal: exitSignal }); });
  });
}

test.after(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

test('fixed bridge reaches only the peer-gated one-shot worker and shutdown preserves exact socket evidence', async () => {
  const value = await fixture(); const listener = await start(value);
  const exchange = spawnSync(value.bridge, [], { input: '{"ping":true}\n', encoding: 'utf8', timeout: 3000 });
  assert.equal(exchange.status, 0, exchange.stderr); assert.equal(exchange.stdout, '{"ok":true}\n');
  const identity = spawnSync(value.bridge, [], { input: '{"identity":true}\n', encoding: 'utf8', timeout: 3000 });
  assert.equal(identity.status, 0, identity.stderr);
  assert.deepEqual(JSON.parse(identity.stdout), { uid: `${process.getuid()}\t${process.getuid()}\t${process.getuid()}\t${process.getuid()}`,
    gid: `${process.getgid()}\t${process.getgid()}\t${process.getgid()}\t${process.getgid()}`, noNewPrivs: '1', capEff: '0000000000000000' });
  const second = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 2000 });
  assert.equal(second.status, 78); assert.match(second.stderr, /authority unavailable/);
  const stopped = await stop(listener); assert.equal(stopped.code, 143);
  await assert.rejects(fs.lstat(value.socket), { code: 'ENOENT' });
  assert.equal((await fs.readdir(value.socketParent)).filter((name) => name.includes('.closed.')).length, 1);
});

test('forced-command stdio rejects nonempty SSH_ORIGINAL_COMMAND and accepts unset or empty', async () => {
  const value = await fixture(); const listener = await start(value);
  for (const original of [undefined, '']) {
    const env = { ...process.env }; if (original === undefined) delete env.SSH_ORIGINAL_COMMAND; else env.SSH_ORIGINAL_COMMAND = original;
    const accepted = spawnSync(value.bridge, [], { input: '{"ping":true}\n', encoding: 'utf8', timeout: 3000, env });
    assert.equal(accepted.status, 0, accepted.stderr); assert.equal(accepted.stdout, '{"ok":true}\n');
  }
  const rejected = spawnSync(value.bridge, [], { input: '{"ping":true}\n', encoding: 'utf8', timeout: 3000,
    env: { ...process.env, SSH_ORIGINAL_COMMAND: 'touch /tmp/forbidden' } });
  assert.equal(rejected.status, 64); assert.equal(rejected.stdout, ''); assert.match(rejected.stderr, /original command forbidden/);
  await stop(listener);
});

test('wrong peer uid is closed without spawning the worker', async () => {
  const value = await fixture({ bridgeUid: process.getuid() + 1 }); const listener = await start(value);
  const exchange = spawnSync(value.bridge, [], { input: '{"ping":true}\n', encoding: 'utf8', timeout: 3000 });
  assert.equal(exchange.status, 74); assert.equal(exchange.stdout, '');
  await stop(listener);
});

test('stdio bridge bounds an undrained stdout with its one absolute deadline', async () => {
  const value = await fixture(); const listener = await start(value);
  const exchange = spawn(value.undrained, [value.bridge], { stdio: ['pipe', 'pipe', 'pipe'] }); exchange.stdin.end('{"large":true}\n');
  const started = Date.now(); const code = await new Promise((resolve) => exchange.once('exit', resolve));
  assert.equal(code, 74); assert.ok(Date.now() - started < 3500); await stop(listener);
});

test('pending TERM after authority fsync exits before bind', async () => {
  const value = await fixture(); const child = spawn(value.listener, [], { env: { ...process.env,
    TARGET_HELPER_TEST_DIRECTORY: value.root, TARGET_HELPER_TEST_PAUSE: 'authority' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitFor(async () => Boolean(await fs.lstat(join(value.root, 'authority.ready')).catch(() => undefined)));
  child.kill('SIGTERM'); await fs.writeFile(join(value.root, 'authority.continue'), '');
  const stopped = await new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  assert.equal(stopped, 143); await assert.rejects(fs.lstat(value.socket), { code: 'ENOENT' });
});

test('pending TERM at the accept/fork boundary admits no worker', async () => {
  const value = await fixture(); const child = spawn(value.listener, [], { env: { ...process.env,
    TARGET_HELPER_TEST_DIRECTORY: value.root, TARGET_HELPER_TEST_PAUSE: 'fork' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitFor(async () => Boolean(await fs.lstat(value.socket).catch(() => undefined)));
  const exchange = spawn(value.bridge, [], { stdio: ['pipe', 'pipe', 'pipe'] }); exchange.stdin.end('{"ping":true}\n');
  await waitFor(async () => Boolean(await fs.lstat(join(value.root, 'fork.ready')).catch(() => undefined)));
  child.kill('SIGTERM'); await fs.writeFile(join(value.root, 'fork.continue'), '');
  const stopped = await new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  assert.equal(stopped, 143); if (exchange.exitCode === null) await new Promise((resolve) => exchange.once('exit', resolve));
  assert.notEqual(exchange.exitCode, 0);
});

test('child exit before gate cannot SIGPIPE or orphan the parent and preserves evidence', async () => {
  const value = await fixture(); const child = spawn(value.listener, [], { env: { ...process.env,
    TARGET_HELPER_TEST_DIRECTORY: value.root, TARGET_HELPER_TEST_PAUSE: 'gate',
    TARGET_HELPER_TEST_CHILD_EXIT_BEFORE_GATE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitFor(async () => Boolean(await fs.lstat(value.socket).catch(() => undefined)));
  const exchange = spawn(value.bridge, [], { stdio: ['pipe', 'pipe', 'pipe'] }); exchange.stdin.end('{"ping":true}\n');
  await waitFor(async () => Boolean(await fs.lstat(join(value.root, 'child-exit.ready')).catch(() => undefined)));
  await waitFor(async () => Boolean(await fs.lstat(join(value.root, 'gate.ready')).catch(() => undefined)));
  await fs.writeFile(join(value.root, 'gate.continue'), '');
  const code = await new Promise((resolve) => child.once('exit', resolve)); assert.equal(code, 78);
  if (exchange.exitCode === null) await new Promise((resolve) => exchange.once('exit', resolve));
  await assert.rejects(fs.lstat(value.socket), { code: 'ENOENT' });
  assert.equal((await fs.readdir(value.socketParent)).some((name) => name.includes('.closed.')), true);
});

test('shutdown denies new work, bounds a hung child drain, and restart reconciles its exact dead lock', async () => {
  const value = await fixture(); const listener = await start(value);
  const exchange = spawn(value.bridge, [], { stdio: ['pipe', 'pipe', 'pipe'] }); exchange.stdin.end('{"hang":true}\n');
  await waitFor(async () => Boolean(await fs.lstat(join(value.journal, '.target-helper.lock')).catch(() => undefined)));
  const started = Date.now(); const stopped = await stop(listener);
  assert.equal(stopped.code, 143); assert.ok(Date.now() - started >= 4500); assert.ok(Date.now() - started < 8500);
  if (exchange.exitCode === null && exchange.signalCode === null) await new Promise((resolve) => exchange.once('exit', resolve));
  const restarted = await start(value); await stop(restarted);
  assert.equal((await fs.readdir(value.journal)).some((name) => name.startsWith('.target-helper.lock.stale.')), true);
});

test('subreaper retains a direct-child slot, kills a TERM-resistant descendant group, and reaps the orphan before authority release', async () => {
  const value = await fixture(); const listener = await start(value);
  const exchange = spawnSync(value.bridge, [], { input: '{"descendant":true}\n', encoding: 'utf8', timeout: 3000 });
  assert.equal(exchange.status, 0, exchange.stderr); assert.equal(exchange.stdout, '{"spawned":true}\n');
  const marker = join(value.journal, 'descendant.pid'); await waitFor(async () => Boolean(await fs.readFile(marker).catch(() => undefined)));
  const descendantPid = Number(await fs.readFile(marker, 'utf8')); assert.ok(descendantPid > 1);
  const started = Date.now(); const stopped = await stop(listener); assert.equal(stopped.code, 143);
  assert.ok(Date.now() - started >= 6500, 'bounded drain + TERM + KILL phases were observed');
  assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
  const restarted = await start(value); await stop(restarted);
});

test('subreaper independently fences, kills, and reaps a detached TERM-resistant descendant before authority release', async () => {
  const value = await fixture(); const listener = await start(value);
  const exchange = spawnSync(value.bridge, [], { input: '{"detached-descendant":true}\n', encoding: 'utf8', timeout: 3000 });
  assert.equal(exchange.status, 0, exchange.stderr); assert.equal(exchange.stdout, '{"spawned":true}\n');
  const marker = join(value.journal, 'detached-descendant.pid'); await waitFor(async () => Boolean(await fs.readFile(marker).catch(() => undefined)));
  const descendantPid = Number(await fs.readFile(marker, 'utf8')); assert.ok(descendantPid > 1);
  const started = Date.now(); const stopped = await stop(listener); assert.equal(stopped.code, 143);
  assert.ok(Date.now() - started >= 6500); assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
  const restarted = await start(value); await stop(restarted);
});

test('discovery failure after an adopted parent exits fail-stops until its nested detached child is proven gone', async () => {
  const value = await fixture();
  const listener = spawn(value.listener, [], { env: { ...process.env,
    TARGET_HELPER_TEST_DIRECTORY: value.root, TARGET_HELPER_TEST_FAIL_DISCOVERY_AFTER_ADOPTED_REAP: '1' },
  stdio: ['ignore', 'pipe', 'pipe'] });
  let nestedPid = 0;
  try {
    await waitFor(async () => (await fs.lstat(value.socket).catch(() => undefined))?.isSocket() || listener.exitCode !== null);
    const exchange = spawnSync(value.bridge, [], { input: '{"nested-detached-descendant":true}\n', encoding: 'utf8', timeout: 3000 });
    assert.equal(exchange.status, 0, exchange.stderr); assert.equal(exchange.stdout, '{"spawned":true}\n');
    const parentMarker = join(value.journal, 'nested-parent.pid');
    await waitFor(async () => Boolean(await fs.readFile(parentMarker).catch(() => undefined)));
    const parentPid = Number(await fs.readFile(parentMarker, 'utf8')); assert.ok(parentPid > 1);
    await waitFor(async () => Boolean(await fs.lstat(join(value.root, `adopted.${parentPid}.ready`)).catch(() => undefined)));
    await fs.writeFile(join(value.journal, 'nested-parent-exit'), '');
    const nestedMarker = join(value.journal, 'nested-child.pid');
    await waitFor(async () => Boolean(await fs.readFile(nestedMarker).catch(() => undefined)));
    nestedPid = Number(await fs.readFile(nestedMarker, 'utf8')); assert.ok(nestedPid > 1);
    await waitFor(async () => Boolean(await fs.lstat(join(value.root, 'discovery-fault.ready')).catch(() => undefined)));
    await new Promise((resolve) => setTimeout(resolve, 250)); assert.equal(listener.exitCode, null);
    const competing = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 2000 });
    assert.equal(competing.status, 78); assert.match(competing.stderr, /authority unavailable/);
    assert.doesNotThrow(() => process.kill(nestedPid, 0));
    await fs.writeFile(join(value.root, 'discovery-fault.continue'), '');
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fail-stop listener did not finish negative liveness proof')), 9000);
      listener.once('exit', (exitCode) => { clearTimeout(timer); resolve(exitCode); });
    });
    assert.equal(code, 78); assert.throws(() => process.kill(nestedPid, 0), { code: 'ESRCH' }); nestedPid = 0;
    const restarted = await start(value); await stop(restarted);
  } finally {
    if (listener.exitCode === null) listener.kill('SIGKILL');
    if (nestedPid > 1) { try { process.kill(nestedPid, 'SIGKILL'); } catch {} }
  }
});

test('worker exec closes every unrelated and inherited descriptor', async () => {
  const value = await fixture(); const listener = await start(value);
  const exchange = spawnSync(value.bridge, [], { input: '{"fds":true}\n', encoding: 'utf8', timeout: 3000 });
  assert.equal(exchange.status, 0, exchange.stderr);
  const { fds } = JSON.parse(exchange.stdout);
  assert.equal(fds.some(([, target]) => target.includes(value.socket) || target.includes(value.authority) || target.includes(value.journal)), false);
  assert.equal(fds.some(([, target]) => /^socket:/.test(target)), false);
  await stop(listener);
});

test('a supervisor crash leaves the socket as fail-closed evidence', async () => {
  const value = await fixture(); const listener = await start(value); await stop(listener, 'SIGKILL');
  assert.equal((await fs.lstat(value.socket)).isSocket(), true);
  const restart = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 2000 });
  assert.equal(restart.status, 78); assert.match(restart.stderr, /listener unavailable/);
  assert.equal((await fs.lstat(value.socket)).isSocket(), true);
});

test('exclusive lifetime authority renames only an exact token-bound dead helper lock', async () => {
  const value = await fixture(); const first = await start(value); await stop(first);
  const record = await fs.readFile(join(value.authority, 'instance-authority'), 'utf8');
  const token = /^instance_authority_token=([a-f0-9]{64})$/m.exec(record)?.[1]; assert.ok(token);
  const lock = { instanceAuthorityToken: token, instanceId: '00000000-0000-4000-8000-000000000001', pid: 2147483646 };
  await fs.writeFile(join(value.journal, '.target-helper.lock'), JSON.stringify(lock), { mode: 0o600 });
  const second = await start(value); await stop(second);
  const names = await fs.readdir(value.journal);
  assert.deepEqual(names, [`.target-helper.lock.stale.${token}`]);
  await fs.writeFile(join(value.journal, '.target-helper.lock'), JSON.stringify({ instanceId: lock.instanceId, pid: lock.pid }), { mode: 0o600 });
  const rejected = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 2000 });
  assert.equal(rejected.status, 78); assert.match(rejected.stderr, /authority unavailable/);
});

test('canonical-path and protected-parent checks reject symlink traversal and unsafe modes', async () => {
  const value = await fixture(); await fs.chmod(value.socketParent, 0o770);
  const rejected = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 2000 });
  assert.equal(rejected.status, 78); assert.match(rejected.stderr, /listener unavailable/);
});

test('corrupt durable authority records are never used for lock reconciliation', async () => {
  const value = await fixture(); const listener = await start(value); await stop(listener);
  const path = join(value.authority, 'instance-authority'); const valid = await fs.readFile(path);
  const tokenOffset = Buffer.from('instance_authority_token=').byteLength;
  for (let index = 0; index < 64; index++) {
    for (const invalid of [0, 'g'.charCodeAt(0)]) {
      const malformed = Buffer.from(valid); malformed[tokenOffset + index] = invalid; await fs.writeFile(path, malformed);
      const rejected = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 2000 });
      assert.equal(rejected.status, 78); assert.deepEqual(await fs.readFile(path), malformed);
    }
  }
  for (const malformed of [valid.subarray(0, valid.byteLength - 1), Buffer.concat([valid, Buffer.from('x')])]) {
    await fs.writeFile(path, malformed); const rejected = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 2000 });
    assert.equal(rejected.status, 78); assert.deepEqual(await fs.readFile(path), malformed);
  }
});

test('unsafe pre-existing authority metadata is rejected without repair', async () => {
  const value = await fixture(); const listener = await start(value); await stop(listener);
  const path = join(value.authority, 'instance-authority'); await fs.chmod(path, 0o644);
  const before = await fs.lstat(path); const rejected = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 2000 });
  assert.equal(rejected.status, 78); const after = await fs.lstat(path);
  assert.equal(after.mode & 0o777, 0o644); assert.equal(after.ino, before.ino);
});

test('helper lock UUID bytes reject NUL and nonhex at every hex position without mutation', async () => {
  const value = await fixture(); const listener = await start(value); await stop(listener);
  const record = await fs.readFile(join(value.authority, 'instance-authority'), 'utf8');
  const token = /^instance_authority_token=([a-f0-9]{64})$/m.exec(record)?.[1]; assert.ok(token);
  const lockPath = join(value.journal, '.target-helper.lock');
  const valid = Buffer.from(JSON.stringify({ instanceAuthorityToken: token,
    instanceId: '00000000-0000-4000-8000-000000000001', pid: 2147483646 }));
  const uuidOffset = valid.indexOf(Buffer.from('00000000-0000-4000-8000-000000000001'));
  for (let index = 0; index < 36; index++) {
    if ([8, 13, 18, 23].includes(index)) continue;
    for (const invalid of [0, 'g'.charCodeAt(0)]) {
      const malformed = Buffer.from(valid); malformed[uuidOffset + index] = invalid; await fs.writeFile(lockPath, malformed, { mode: 0o600 });
      const rejected = spawnSync(value.listener, [], { encoding: 'utf8', timeout: 2000 });
      assert.equal(rejected.status, 78); assert.deepEqual(await fs.readFile(lockPath), malformed);
    }
  }
});
