import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(serverRoot, 'src/native/backup-broker-listener.c')
const outerUid = process.getuid(); const outerGid = process.getgid(); const username = os.userInfo().username
const subuid = fs.readFileSync('/etc/subuid', 'utf8').split('\n').find((line) => line.startsWith(`${username}:`))?.split(':')
const subgid = fs.readFileSync('/etc/subgid', 'utf8').split('\n').find((line) => line.startsWith(`${username}:`))?.split(':')

function waitFor(file, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = () => {
      if (fs.existsSync(file)) return resolve()
      if (Date.now() >= deadline) return reject(new Error(`Timed out waiting for ${file}`))
      setTimeout(poll, 10)
    }
    poll()
  })
}

function namespaceArgs(binary, child, environment) {
  if (!subuid || !subgid) throw new Error('Listener test requires subordinate uid/gid mappings.')
  return [
    '--map-users', `0:${outerUid}:1`, '--map-users', `1:${subuid[1]}:${subuid[2]}`,
    '--map-groups', `0:${outerGid}:1`, '--map-groups', `1:${subgid[1]}:${subgid[2]}`,
    '--setuid', '0', '--setgid', '0', '--keep-caps',
    '/usr/bin/env', ...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
    '/bin/sh', '-c', 'chown 0:1000 "$TEST_MAIN_DIR" "$TEST_RECOVERY_DIR"; chmod "${TEST_PARENT_MODE:-0710}" "$TEST_MAIN_DIR" "$TEST_RECOVERY_DIR"; exec /usr/bin/setpriv --nnp --bounding-set=-all,+chown,+kill,+setgid,+setuid --inh-caps=-all /usr/sbin/capsh --caps=cap_chown,cap_kill,cap_setgid,cap_setuid+ep -- -c \'exec "$@"\' listener-caps "$@"',
    'listener-test', binary, process.execPath, child,
  ]
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-listener-')); fs.chmodSync(root, 0o755)
  const main = path.join(root, 'main'); const recovery = path.join(root, 'recovery')
  fs.mkdirSync(main); fs.mkdirSync(recovery)
  fs.chmodSync(main, 0o710); fs.chmodSync(recovery, 0o710)
  const child = path.join(root, 'child.mjs')
  fs.writeFileSync(child, "import net from 'node:net'\n" +
    "const serve = (socket) => { const chunks = []; socket.on('data', (chunk) => chunks.push(chunk)); socket.on('end', () => { const request = JSON.parse(Buffer.concat(chunks)); const response = { protocol_version: 2, request_id: request.request_id, helper_version: request.helper_version, policy_sha256: request.policy_sha256, operation: 'DESCRIBE', site_id: request.site_id, repository_id: request.repository_id, capsule_generation: 'g', capsule_sha256: 'a'.repeat(64), capsule_size_bytes: '1', release_generation: 'r', deployment_generation: 'd', compatibility_generation: 1, age_recipient_key_id: 'k', contract_id: 'c', encrypted_inventory_sha256: 'b'.repeat(64), required_roles: ['backend'], capabilities: { durable_publication: true, repository_retention_authority: true, durable_restore_holds: true, whole_run_deletion: true }, manifest_verification_keys: [{ key_id: 'k', algorithm: 'Ed25519', public_key_pem: 'pem', active: true }], configuration_contract: [{ logical_name: 'x', required: true, max_bytes: '1' }] }; socket.end(JSON.stringify(response) + '\\n') }) }\n" +
    "const servers = [3, 4].map((fd) => net.createServer(serve).listen({ fd }))\n" +
    "await Promise.all(servers.map((server) => new Promise((resolve) => server.once('listening', resolve))))\n" +
    "let closing = false; const close = (signal) => { process.stdout.write((closing ? 'REPEAT:' : 'DRAIN:') + signal + '\\n'); if (closing) return; closing = true; setTimeout(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))).then(() => process.exit(0)), 100) }\n" +
    "process.once('SIGTERM', () => close('SIGTERM')); process.once('SIGINT', () => close('SIGINT'))\n" +
    "process.stdout.write('READY\\n')\n", { mode: 0o644 })
  const moduleDirectory = path.join(root, 'dist/backups'); fs.mkdirSync(moduleDirectory, { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n')
  fs.writeFileSync(path.join(moduleDirectory, 'backup-broker-client.js'), "import net from 'node:net'\n" +
    "export class BackupBrokerClient { constructor(options) { this.options = options } async describe() { const status=(await import('node:fs')).readFileSync('/proc/self/status','utf8'); const zeroCaps=status.match(/^Cap(?:Inh|Prm|Eff|Amb):\\s+0+$/gm)??[]; if (process.getuid() !== 1000 || process.getgid() !== 1000 || process.getgroups().some(group => group !== 1000) || zeroCaps.length !== 4 || !/^NoNewPrivs:\\s+1$/m.test(status)) throw new Error('unsafe health identity'); const request = { protocol_version: 2, operation: 'DESCRIBE', request_id: '11111111-1111-4111-8111-111111111111', helper_version: this.options.helperVersion, policy_sha256: this.options.policySha256, site_id: this.options.siteId, repository_id: this.options.repositoryId, deadline: new Date(Date.now()+4000).toISOString() }; return new Promise((resolve,reject) => { const socket=net.createConnection(this.options.socketPath); const chunks=[]; socket.on('connect',()=>socket.end(JSON.stringify(request)+'\\n')); socket.on('data',(chunk)=>chunks.push(chunk)); socket.on('error',reject); socket.on('end',()=>{ const response=JSON.parse(Buffer.concat(chunks)); if(response.operation!=='DESCRIBE'||response.request_id!==request.request_id) reject(new Error('bad DESCRIBE')); else resolve(response) }) }) } }\n", { mode: 0o644 })
  const node = path.join(root, 'node'); fs.copyFileSync(process.execPath, node); fs.chmodSync(node, 0o755)
  const binary = path.join(root, 'listener')
  const productionBinary = path.join(root, 'listener-production')
  const built = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    '-DBACKUP_BROKER_LISTENER_TESTING', '-o', binary, source], { encoding: 'utf8' })
  assert.equal(built.status, 0, built.stderr)
  const productionBuilt = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-o', productionBinary, source], { encoding: 'utf8' })
  assert.equal(productionBuilt.status, 0, productionBuilt.stderr)
  return { root, mainSocket: path.join(main, 'broker.sock'), recoverySocket: path.join(recovery, 'recovery.sock'), child, binary, productionBinary, node }
}

function startListener(f, extraEnvironment = {}) {
  const needsTestHooks = Object.keys(extraEnvironment).some((name) => name.startsWith('BACKUP_BROKER_LISTENER_TEST_'))
  return spawn('unshare', namespaceArgs(needsTestHooks ? f.binary : f.productionBinary, f.child, {
    BACKUP_BROKER_SOCKET_PATH: f.mainSocket,
    BACKUP_BROKER_RECOVERY_SOCKET_PATH: f.recoverySocket,
    BACKUP_BROKER_LISTENER_TEST_DIRECTORY: f.root,
    TEST_MAIN_DIR: path.dirname(f.mainSocket), TEST_RECOVERY_DIR: path.dirname(f.recoverySocket),
    ...extraEnvironment,
  }).map((arg) => arg === process.execPath ? f.node : arg), { stdio: ['ignore', 'pipe', 'pipe'] })
}

function healthcheckNamespaceArgs(f) {
  const inline = "import { BackupBrokerClient } from './dist/backups/backup-broker-client.js'; const client = new BackupBrokerClient({ socketPath: process.env.BACKUP_BROKER_SOCKET_PATH, helperVersion: process.env.BACKUP_BROKER_HELPER_VERSION, policySha256: process.env.BACKUP_BROKER_POLICY_SHA256, siteId: process.env.BACKUP_SITE_ID, repositoryId: process.env.BACKUP_REPOSITORY_ID, controlTimeoutMs: 4000 }); await client.describe();"
  const environment = {
    BACKUP_BROKER_SOCKET_PATH: f.mainSocket, BACKUP_BROKER_HELPER_VERSION: '2.0.0',
    BACKUP_BROKER_POLICY_SHA256: 'a'.repeat(64), BACKUP_SITE_ID: 'site-a',
    BACKUP_REPOSITORY_ID: '11111111-1111-4111-8111-111111111111', TEST_WORK: f.root,
  }
  return [
    '--map-users', `0:${outerUid}:1`, '--map-users', `1:${subuid[1]}:${subuid[2]}`,
    '--map-groups', `0:${outerGid}:1`, '--map-groups', `1:${subgid[1]}:${subgid[2]}`,
    '--setuid', '0', '--setgid', '0', '--keep-caps',
    '/usr/bin/env', ...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
    '/bin/sh', '-c', 'cd "$TEST_WORK"; exec /usr/bin/setpriv --nnp --bounding-set=-all,+chown,+kill,+setgid,+setuid --inh-caps=-all /usr/sbin/capsh --caps=cap_chown,cap_kill,cap_setgid,cap_setuid+ep -- -c \'exec "$@"\' health-root "$@"',
    'health-wrapper', '/usr/bin/setpriv', '--reuid=1000', '--regid=1000', '--clear-groups', '--no-new-privs',
    '--inh-caps=-all', '--ambient-caps=-all', '--', f.node, '--input-type=module', '-e', inline,
  ]
}

async function waitReady(child) {
  let output = ''; let errors = ''
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('READY\n')) resolve() })
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.once('exit', (code) => reject(new Error(`listener exited before ready: ${code}: ${errors}`)))
  })
}

test('inherited-FD supervisor preserves raced replacements at both protected paths without deleting them', async () => {
  const f = fixture(); let child
  try {
    child = startListener(f, { BACKUP_BROKER_LISTENER_TEST_PAUSE_PRESERVE: '1' }); await waitReady(child)
    child.kill('SIGTERM')
    for (const [index, socket, marker] of [[1, f.recoverySocket, 'recovery replacement'], [0, f.mainSocket, 'main replacement']]) {
      await waitFor(path.join(f.root, `preserve.${index}.ready`))
      fs.unlinkSync(socket); fs.writeFileSync(socket, marker)
      fs.writeFileSync(path.join(f.root, `preserve.${index}.continue`), '')
    }
    const exit = await new Promise((resolve) => child.once('exit', resolve)); assert.equal(exit, 78)
    for (const [directory, prefix, marker] of [
      [path.dirname(f.mainSocket), 'broker.sock.closed.', 'main replacement'],
      [path.dirname(f.recoverySocket), 'recovery.sock.closed.', 'recovery replacement'],
    ]) {
      const preserved = fs.readdirSync(directory).find((entry) => entry.startsWith(prefix))
      assert.ok(preserved); assert.equal(fs.readFileSync(path.join(directory, preserved), 'utf8'), marker)
    }
  } finally { if (child?.exitCode === null) child.kill('SIGKILL'); fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('second-listener startup rollback preserves a raced main-path replacement and occupied recovery entry', async () => {
  const f = fixture()
  try {
    fs.writeFileSync(f.recoverySocket, 'occupied')
    const child = startListener(f, { BACKUP_BROKER_LISTENER_TEST_PAUSE_PRESERVE: '1' }); await waitFor(path.join(f.root, 'preserve.0.ready'))
    fs.unlinkSync(f.mainSocket); fs.writeFileSync(f.mainSocket, 'rollback replacement')
    fs.writeFileSync(path.join(f.root, 'preserve.0.continue'), '')
    const exit = await new Promise((resolve) => child.once('exit', resolve))
    assert.equal(exit, 78); assert.equal(fs.readFileSync(f.recoverySocket, 'utf8'), 'occupied')
    const preserved = fs.readdirSync(path.dirname(f.mainSocket)).find((entry) => entry.startsWith('broker.sock.closed.'))
    assert.ok(preserved); assert.equal(fs.readFileSync(path.join(path.dirname(f.mainSocket), preserved), 'utf8'), 'rollback replacement')
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('listener fails safely for an unprotected parent', () => {
  const f = fixture()
  try {
    const result = spawnSync('unshare', namespaceArgs(f.productionBinary, f.child, {
      BACKUP_BROKER_SOCKET_PATH: f.mainSocket,
      BACKUP_BROKER_RECOVERY_SOCKET_PATH: f.recoverySocket,
      BACKUP_BROKER_LISTENER_TEST_DIRECTORY: f.root,
      TEST_MAIN_DIR: path.dirname(f.mainSocket), TEST_RECOVERY_DIR: path.dirname(f.recoverySocket), TEST_PARENT_MODE: '0700',
    }), { encoding: 'utf8' })
    assert.equal(result.status, 78); assert.equal(fs.existsSync(f.mainSocket), false)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('listener rejects an overlong sockaddr path before creating either listener', () => {
  const f = fixture()
  try {
    const overlong = path.join(path.dirname(f.mainSocket), 'x'.repeat(108))
    const args = namespaceArgs(f.productionBinary, f.child, {
      BACKUP_BROKER_SOCKET_PATH: overlong,
      BACKUP_BROKER_RECOVERY_SOCKET_PATH: f.recoverySocket,
      BACKUP_BROKER_LISTENER_TEST_DIRECTORY: f.root,
      TEST_MAIN_DIR: path.dirname(f.mainSocket), TEST_RECOVERY_DIR: path.dirname(f.recoverySocket),
    }).map((arg) => arg === process.execPath ? f.node : arg)
    const result = spawnSync('unshare', args, { encoding: 'utf8' })
    assert.equal(result.status, 78); assert.equal(fs.existsSync(overlong), false); assert.equal(fs.existsSync(f.recoverySocket), false)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('crash-orphan socket is retained unchanged and blocks automatic startup reclamation', async () => {
  const f = fixture()
  try {
    const orphan = spawn(process.execPath, ['-e', "require('node:net').createServer().listen(process.argv[1],()=>process.stdout.write('READY\\n'))", f.mainSocket],
      { stdio: ['ignore', 'pipe', 'pipe'] })
    await waitReady(orphan); orphan.kill('SIGKILL'); await new Promise((resolve) => orphan.once('exit', resolve))
    const before = fs.lstatSync(f.mainSocket)
    const args = namespaceArgs(f.productionBinary, f.child, {
      BACKUP_BROKER_SOCKET_PATH: f.mainSocket,
      BACKUP_BROKER_RECOVERY_SOCKET_PATH: f.recoverySocket,
      BACKUP_BROKER_LISTENER_TEST_DIRECTORY: f.root,
      TEST_MAIN_DIR: path.dirname(f.mainSocket), TEST_RECOVERY_DIR: path.dirname(f.recoverySocket),
    }).map((arg) => arg === process.execPath ? f.node : arg)
    const result = spawnSync('unshare', args, { encoding: 'utf8' })
    const after = fs.lstatSync(f.mainSocket)
    assert.equal(result.status, 78); assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino)
    assert.equal(fs.existsSync(f.recoverySocket), false)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('exact production capabilities support metadata and graceful TERM and INT forwarding', async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const f = fixture(); let child
    try {
      child = startListener(f); let output = ''; child.stdout.on('data', (chunk) => { output += chunk })
      await waitReady(child)
      const status = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8')
      assert.match(status, /^CapEff:\s+00000000000000e1$/m); assert.match(status, /^CapBnd:\s+00000000000000e1$/m)
      assert.equal(fs.statSync(f.mainSocket).mode & 0o777, 0o660); assert.equal(fs.statSync(f.recoverySocket).mode & 0o777, 0o660)
      child.kill(signal)
      const exit = await new Promise((resolve) => child.once('exit', resolve))
      assert.equal(exit, 0); assert.match(output, new RegExp(`DRAIN:${signal}`))
      assert.equal(fs.existsSync(f.mainSocket), false); assert.equal(fs.existsSync(f.recoverySocket), false)
      assert.equal(fs.readdirSync(path.dirname(f.mainSocket)).filter((name) => name.includes('.closed.')).length, 1)
      assert.equal(fs.readdirSync(path.dirname(f.recoverySocket)).filter((name) => name.includes('.closed.')).length, 1)
    } finally { if (child?.exitCode === null) child.kill('SIGKILL'); fs.rmSync(f.root, { recursive: true, force: true }) }
  }
})

test('generated healthcheck identity drops capabilities and completes DESCRIBE over the production socket', async () => {
  const f = fixture(); let supervisor
  try {
    supervisor = startListener(f); await waitReady(supervisor)
    const health = spawnSync('unshare', healthcheckNamespaceArgs(f), { encoding: 'utf8', timeout: 5000 })
    assert.equal(health.status, 0, health.stderr); assert.equal(health.signal, null)
    supervisor.kill('SIGTERM'); assert.equal(await new Promise((resolve) => supervisor.once('exit', resolve)), 0)
  } finally { if (supervisor?.exitCode === null) supervisor.kill('SIGKILL'); fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('blocked termination signals exit safely in the early startup window before bind', async () => {
  const f = fixture(); let child
  try {
    child = startListener(f, { BACKUP_BROKER_LISTENER_TEST_EARLY_SIGNAL: '1' })
    await waitFor(path.join(f.root, 'startup.ready')); child.kill('SIGTERM')
    fs.writeFileSync(path.join(f.root, 'startup.continue'), '')
    const exit = await new Promise((resolve) => child.once('exit', resolve))
    assert.equal(exit, 143); assert.equal(fs.existsSync(f.mainSocket), false); assert.equal(fs.existsSync(f.recoverySocket), false)
  } finally { if (child?.exitCode === null) child.kill('SIGKILL'); fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('blocked signal wait has no check-to-wait gap and forwards repeated interrupts', async () => {
  const f = fixture(); let child
  try {
    child = startListener(f, { BACKUP_BROKER_LISTENER_TEST_WAIT_BOUNDARY: '1' }); let output = ''
    child.stdout.on('data', (chunk) => { output += chunk }); await waitReady(child)
    fs.writeFileSync(path.join(f.root, 'wait.arm'), ''); await waitFor(path.join(f.root, 'wait.ready'))
    child.kill('SIGTERM'); child.kill('SIGINT'); fs.writeFileSync(path.join(f.root, 'wait.continue'), '')
    assert.equal(await new Promise((resolve) => child.once('exit', resolve)), 0)
    assert.match(output, /(?:DRAIN|REPEAT):SIGTERM/); assert.match(output, /(?:DRAIN|REPEAT):SIGINT/)
  } finally { if (child?.exitCode === null) child.kill('SIGKILL'); fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('supervisor rejects relative and lexically non-canonical socket paths before bind', () => {
  for (const malformed of ['relative/broker.sock', '/tmp/./broker.sock', '/tmp/a/../broker.sock', '/tmp//broker.sock']) {
    const f = fixture()
    try {
      const args = namespaceArgs(f.productionBinary, f.child, {
        BACKUP_BROKER_SOCKET_PATH: malformed, BACKUP_BROKER_RECOVERY_SOCKET_PATH: f.recoverySocket,
        TEST_MAIN_DIR: path.dirname(f.mainSocket), TEST_RECOVERY_DIR: path.dirname(f.recoverySocket),
      }).map((arg) => arg === process.execPath ? f.node : arg)
      const result = spawnSync('unshare', args, { encoding: 'utf8', timeout: 5000 })
      assert.equal(result.status, 78, malformed); assert.equal(fs.existsSync(f.recoverySocket), false)
    } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
  }
})

test('collision-resistant preservation retries retained evidence names across repeated supervisor runs', async () => {
  const f = fixture()
  try {
    for (let run = 0; run < 2; run += 1) {
      const child = startListener(f, { BACKUP_BROKER_LISTENER_TEST_TOKEN: '1' }); await waitReady(child)
      child.kill('SIGTERM'); assert.equal(await new Promise((resolve) => child.once('exit', resolve)), 0)
    }
    for (const [directory, base] of [[path.dirname(f.mainSocket), 'broker.sock'], [path.dirname(f.recoverySocket), 'recovery.sock']]) {
      const names = fs.readdirSync(directory).filter((name) => name.startsWith(`${base}.closed.`)).sort()
      assert.equal(names.length, 2); assert.match(names[0], /\.0$/); assert.match(names[1], /\.1$/)
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})
