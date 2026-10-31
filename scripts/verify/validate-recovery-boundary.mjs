#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { validateRecoveryBoundaryManifest } from '../bundle/recovery-boundary-lib.mjs'

function fail(message) { throw new Error(`recovery-boundary-invalid: ${message}`) }
function sourceValidation(root) {
  const service = fs.readFileSync(path.join(root, 'darshan-server/src/backups/backup-broker-service.ts'), 'utf8')
  const main = fs.readFileSync(path.join(root, 'darshan-server/src/backups/backup-broker-main.ts'), 'utf8')
  const assembly = fs.readFileSync(path.join(root, 'scripts/bundle/assemble-runtime-bundle.sh'), 'utf8')
  const installer = fs.readFileSync(path.join(root, 'scripts/bundle/install-signed-role.sh'), 'utf8')
  const runner = fs.readFileSync(path.join(root, 'darshan-server/scripts/recovery-container-runner.mjs'), 'utf8')
  const listener = fs.readFileSync(path.join(root, 'darshan-server/src/native/backup-broker-listener.c'), 'utf8')
  const dockerfile = fs.readFileSync(path.join(root, 'darshan-server/Dockerfile'), 'utf8')
  for (const operation of ['INSPECT_RESTORE_HOLD', 'ACQUIRE_RESTORE_HOLD', 'RELEASE_RESTORE_HOLD', 'MARK_RESTORE_HOLD_UNCERTAIN']) {
    if (!fs.readFileSync(path.join(root, 'darshan-server/src/backups/backup-broker-protocol.ts'), 'utf8').includes(operation)) fail(`missing recovery allowlist operation ${operation}`)
  }
  if (!service.includes("endpoint === 'recovery'") || !main.includes('BACKUP_BROKER_RECOVERY_SOCKET_PATH') ||
      !main.includes('BACKUP_BROKER_MAIN_LISTEN_FD') || !service.includes("server.listen({ fd: inheritedFd")) fail('inherited dual recovery listener is not wired')
  for (const required of ['BACKUP_RECOVERY_SOCKET_DIR', 'RECOVERY_DOCKER_CONFIG_ROOT', 'recovery-boundary/generated',
    'recovery-boundary/runtime/node', 'create_host_path: false', 'stop_grace_period: 35s']) {
    if (!assembly.includes(required)) fail(`bundle assembly is missing ${required}`)
  }
  for (const forbidden of ['npm run', 'tsx ', '/var/run/docker.sock', '--privileged', '--network host']) {
    if (runner.includes(forbidden)) fail(`host runner contains forbidden production mechanism ${forbidden}`)
  }
  if (!fs.readFileSync(path.join(root, 'scripts/bundle/recovery-boundary-lib.mjs'), 'utf8').includes("'--entrypoint', '/usr/bin/env'")) fail('OCI entrypoint override is missing')
  for (const required of ['chmod 0750 "$recovery"', 'chmod 0640 "$recovery/recovery-boundary-lib.mjs"']) {
    if (!installer.includes(required)) fail(`signed-role installer is missing protected recovery ownership step ${required}`)
  }
  if (!assembly.includes('linux:x64:20') || !runner.includes('assertProtectedManifestMetadata')) fail('pinned host runtime or protected manifest validation is missing')
  for (const required of ['RENAME_NOREPLACE', 'SYS_openat2', 'getrandom(', 'setgroups(0, NULL)', 'setgid(BROKER_GID)', 'setuid(BROKER_UID)',
    'directory_state.st_uid != 0', '(directory_state.st_mode & 0777) != 0710']) {
    if (!listener.includes(required)) fail(`native listener supervisor is missing ${required}`)
  }
  if (!dockerfile.includes('/usr/local/bin/backup-broker-listener') || !assembly.includes('command: ["/usr/local/bin/backup-broker-listener"')) fail('native listener supervisor is not pinned into production launch')
  if (!assembly.includes("'      - KILL'")) fail('native listener supervisor is missing its sole child-signal capability')
  if (!assembly.includes('test: ["CMD", "/usr/bin/setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", "--no-new-privs", "--inh-caps=-all", "--ambient-caps=-all"')) fail('broker healthcheck does not drop to the socket-owning identity')
  if (listener.includes('unlink(')) fail('native listener supervisor must never unlink a pathname')
}
function bundleValidation(backendRoot) {
  const boundary = path.join(backendRoot, 'recovery-boundary')
  const manifest = validateRecoveryBoundaryManifest(JSON.parse(fs.readFileSync(path.join(boundary, 'generated/boundary-manifest.json'), 'utf8')))
  const config = JSON.parse(fs.readFileSync(path.join(boundary, 'generated/operator-config.json'), 'utf8'))
  if (config.format !== 'darshan-recovery-operator-config-v2' || config.broker?.socket_path !== '/run/darshan-recovery-broker/recovery.sock') fail('operator config does not select the recovery-only endpoint')
  if (config.repository?.root !== '/run/darshan-recovery-repository' || config.journal?.root !== '/run/darshan-recovery-journal') fail('operator config mount targets are unstable')
  for (const relative of ['policy-trust/policy-keyring.json', 'manifest-trust/manifest-keyring.json', 'generated/boundary-manifest.json', 'generated/operator-config.json']) {
    const stat = fs.lstatSync(path.join(boundary, relative))
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) fail(`${relative} is not a mode-0600 regular file`)
  }
  const digests = { launcherSha256: 'recovery-container-runner.mjs', librarySha256: 'recovery-boundary-lib.mjs',
    runtimeManifestSha256: 'recovery-runtime-manifest.json', hostNodeSha256: 'runtime/node' }
  for (const [name, relative] of Object.entries(digests)) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(boundary, relative))).digest('hex')
    if (manifest.artifacts[name] !== digest) fail(`${relative} does not match the boundary digest`)
  }
  if (manifest.paths.repository === manifest.paths.recoverySocketDirectory) fail('repository and recovery socket overlap')
}

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [mode = '--source', target = here] = process.argv.slice(2)
if (mode === '--source') sourceValidation(path.resolve(target))
else if (mode === '--bundle') bundleValidation(path.resolve(target))
else fail('usage: validate-recovery-boundary.mjs [--source REPO|--bundle BACKEND_ROLE]')
process.stdout.write('recovery-boundary-ok\n')
