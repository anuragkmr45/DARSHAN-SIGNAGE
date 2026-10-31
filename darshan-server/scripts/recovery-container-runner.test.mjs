import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { buildRecoveryDockerCreateArgs, canonicalJson, recoveryDockerEnvironment, recoveryMountProfile, validateRecoveryBoundaryManifest } from './recovery-boundary-lib.mjs'
import { assertProtectedManifestMetadata, readProtectedManifest, runRecoveryContainer, validateRecoveryHostBoundary } from './recovery-container-runner.mjs'

const manifest = Object.freeze({
  format: 'darshan-recovery-container-boundary-v1', siteId: 'site-a', containerName: 'darshan-site-a-recovery-operator',
  imageId: `sha256:${'a'.repeat(64)}`, cpuLimit: '1', memoryBytes: 536870912, pidsLimit: 128,
  scratchTmpfsBytes: 268435456, homeTmpfsBytes: 16777216, temporaryTmpfsBytes: 67108864,
  journalMinimumFreeBytes: 1073741824, evidenceMinimumFreeBytes: 1073741824, outputMinimumFreeBytes: 1073741824,
  brokerControlTimeoutMs: 60000, runTimeoutMs: 14400000, stdoutMaxBytes: 524288, stderrMaxBytes: 524288, stopGraceSeconds: 15,
  repositoryDeviceId: '123', ownerUid: 1000, ownerGid: 1000,
  paths: { repository: '/var/lib/darshan/site-a/backup-repository', configFile: '/etc/darshan-recovery/operator/config.json',
    policyKeyring: '/etc/darshan-recovery/policy/policy-keyring.json', manifestKeyring: '/etc/darshan-recovery/manifest/manifest-keyring.json',
    planDirectory: '/var/lib/darshan/site-a/recovery-plans', journalDirectory: '/var/lib/darshan/site-a/recovery-journal',
    reviewDirectory: '/var/lib/darshan/site-a/recovery-reviews', evidenceDirectory: '/var/lib/darshan/site-a/recovery-evidence',
    recoverySocketDirectory: '/var/lib/darshan/site-a/recovery-broker-socket',
    dockerConfigDirectory: '/var/lib/darshan/site-a/recovery-docker-config' },
  artifacts: { launcherSha256: '1'.repeat(64), librarySha256: '2'.repeat(64), runtimeManifestSha256: '3'.repeat(64), hostNodeSha256: '4'.repeat(64) },
  hostRuntime: { platform: 'linux', arch: 'x64', nodeMajor: 20 },
})
const admissionId = '11111111-1111-4111-8111-111111111111'
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

test('validates explicit non-overlapping production inputs and immutable image identity', () => {
  assert.equal(validateRecoveryBoundaryManifest(manifest), manifest)
  assert.throws(() => validateRecoveryBoundaryManifest({ ...manifest, imageId: 'backend:latest' }), /immutable/)
  assert.throws(() => validateRecoveryBoundaryManifest({ ...manifest, paths: { ...manifest.paths, journalDirectory: `${manifest.paths.repository}/journal` } }), /overlap/)
  assert.throws(() => validateRecoveryBoundaryManifest({ ...manifest, brokerControlTimeoutMs: 240001 }), /protocol maximum/)
  assert.equal(validateRecoveryBoundaryManifest({ ...manifest, cpuLimit: '1.5' }).cpuLimit, '1.5')
  assert.deepEqual(recoveryDockerEnvironment(manifest), { PATH: '/usr/bin:/bin', HOME: '/', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
    DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONFIG: manifest.paths.dockerConfigDirectory })
})

test('reads only a bounded canonical operator-owned manifest and binds launcher, library, c1 manifest, and pinned Node digests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-runner-manifest-'))
  try {
    fs.mkdirSync(path.join(root, 'generated')); fs.mkdirSync(path.join(root, 'runtime'))
    fs.copyFileSync(new URL('./recovery-container-runner.mjs', import.meta.url), path.join(root, 'recovery-container-runner.mjs'))
    fs.copyFileSync(new URL('../../scripts/bundle/recovery-boundary-lib.mjs', import.meta.url), path.join(root, 'recovery-boundary-lib.mjs'))
    fs.writeFileSync(path.join(root, 'recovery-runtime-manifest.json'), '{}\n'); fs.copyFileSync(process.execPath, path.join(root, 'runtime/node'))
    const bound = { ...manifest, artifacts: { launcherSha256: digest(path.join(root, 'recovery-container-runner.mjs')),
      librarySha256: digest(path.join(root, 'recovery-boundary-lib.mjs')), runtimeManifestSha256: digest(path.join(root, 'recovery-runtime-manifest.json')),
      hostNodeSha256: digest(path.join(root, 'runtime/node')) } }
    const file = path.join(root, 'generated/boundary-manifest.json'); fs.writeFileSync(file, canonicalJson(bound), { mode: 0o600 })
    const testPolicy = { ownerUid: process.getuid(), mode: 0o600, groups: process.getgroups() }
    assert.equal(readProtectedManifest(file, testPolicy).artifacts.launcherSha256, bound.artifacts.launcherSha256)
    fs.appendFileSync(path.join(root, 'recovery-boundary-lib.mjs'), '\n')
    assert.throws(() => readProtectedManifest(file, testPolicy), /librarySha256 mismatch/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('accepts fresh installed root:docker manifest metadata only for a non-writing docker-group reader', () => {
  const dockerGid = 991; const safe = { isFile: () => true, nlink: 1n, size: 1024n, uid: 0n, gid: BigInt(dockerGid), mode: 0o100640n }
  assert.doesNotThrow(() => assertProtectedManifestMetadata(safe, { groups: [dockerGid] }))
  assert.throws(() => assertProtectedManifestMetadata(safe, { groups: [1000] }), /protected bounded signed-role/)
  assert.throws(() => assertProtectedManifestMetadata({ ...safe, mode: 0o100660n }, { groups: [dockerGid] }), /protected bounded signed-role/)
  const installer = fs.readFileSync(new URL('../../scripts/bundle/install-signed-role.sh', import.meta.url), 'utf8')
  const assembly = fs.readFileSync(new URL('../../scripts/bundle/assemble-runtime-bundle.sh', import.meta.url), 'utf8')
  assert.match(installer, /chown -R root:docker/); assert.match(installer, /chmod 0640 .*boundary-manifest\.json/)
  assert.match(assembly, /requires the packaged uid-1000 sudo deployment operator/)
  assert.match(assembly, /Recovery deployment operator must belong to the docker group/)
  assert.match(assembly, /linux:x64:20/)
})

test('emits the exact static mount matrix and fixed pre-Node env-i entrypoint', () => {
  const names = (command, offline = false) => recoveryMountProfile(manifest, command, offline).map((entry) => `${entry.target}:${entry.readOnly ? 'ro' : 'rw'}`)
  assert.deepEqual(names('discover'), ['/run/darshan-recovery-config:ro', '/run/darshan-recovery-evidence:rw', '/run/darshan-recovery-repository:ro', '/run/darshan-recovery-policy-trust:ro', '/run/darshan-recovery-manifest-trust:ro'])
  assert.deepEqual(names('plan').slice(-1), ['/run/darshan-recovery-plans:rw'])
  assert.deepEqual(names('hold').slice(-3), ['/run/darshan-recovery-plans:ro', '/run/darshan-recovery-journal:rw', '/run/darshan-recovery-broker:ro'])
  assert.deepEqual(names('status', true), ['/run/darshan-recovery-config:ro', '/run/darshan-recovery-evidence:rw', '/run/darshan-recovery-plans:ro', '/run/darshan-recovery-journal:ro'])
  assert.deepEqual(names('release').slice(-4), ['/run/darshan-recovery-plans:ro', '/run/darshan-recovery-journal:rw', '/run/darshan-recovery-reviews:ro', '/run/darshan-recovery-broker:ro'])
  const args = buildRecoveryDockerCreateArgs(manifest, { command: 'status', offline: true, admissionId, commandArgs: ['--plan-file', '/run/darshan-recovery-plans/p.json', '--plan-sha256', 'b'.repeat(64)] })
  assert.ok(args.includes('--read-only')); assert.ok(args.includes('no-new-privileges:true')); assert.ok(args.includes(manifest.imageId))
  assert.deepEqual(args.slice(args.indexOf('--entrypoint'), args.indexOf('--entrypoint') + 2), ['--entrypoint', '/usr/bin/env'])
  const image = args.indexOf(manifest.imageId)
  assert.deepEqual(args.slice(image + 1, image + 9), ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8', 'LC_ALL=C.UTF-8', 'TZ=UTC', 'HOME=/var/tmp/darshan-recovery-runtime/home', 'TMPDIR=/var/tmp/darshan-recovery-runtime/tmp', '/usr/local/bin/node'])
  assert.ok(args.indexOf('--entrypoint') < image, 'image ENTRYPOINT must be bypassed before the immutable image argument')
  assert.ok(!args.join('\n').includes('/var/run/docker.sock')); assert.ok(!args.includes('--privileged')); assert.ok(!args.includes('--env'))
  const literal = '$(touch /tmp/never-executed)'
  assert.ok(buildRecoveryDockerCreateArgs(manifest, { command: 'discover', admissionId, commandArgs: ['--after-run-id', literal] }).includes(literal))
  assert.throws(() => buildRecoveryDockerCreateArgs(manifest, { command: 'status', admissionId, commandArgs: ['--plan-file', '/run/darshan-recovery-plans/../escape'] }), /traversal/)
})

test('all online command profiles require the root-owned mode-0710 recovery listener parent', () => {
  const original = { lstatSync: fs.lstatSync, realpathSync: fs.realpathSync, statfsSync: fs.statfsSync }
  const directories = new Set([manifest.paths.repository, manifest.paths.planDirectory, manifest.paths.journalDirectory,
    manifest.paths.reviewDirectory, manifest.paths.evidenceDirectory, manifest.paths.recoverySocketDirectory,
    manifest.paths.dockerConfigDirectory])
  let unsafeRecovery = false
  fs.lstatSync = (value) => {
    const directory = directories.has(value); const recovery = value === manifest.paths.recoverySocketDirectory
    const dockerConfig = value === manifest.paths.dockerConfigDirectory
    return { isSymbolicLink: () => false, isDirectory: () => directory, isFile: () => !directory,
      uid: BigInt(recovery && !unsafeRecovery ? 0 : dockerConfig ? process.getuid() : 1000),
      gid: BigInt(dockerConfig ? process.getgid() : 1000),
      mode: BigInt(recovery && !unsafeRecovery ? 0o710 : directory ? 0o700 : 0o600), nlink: 1n,
      dev: BigInt(value === manifest.paths.repository ? manifest.repositoryDeviceId : 1) }
  }
  fs.realpathSync = (value) => value
  fs.statfsSync = () => ({ bavail: 10_000_000_000n, bsize: 4096n })
  try {
    for (const command of ['hold', 'verify-source', 'resume', 'status', 'release', 'abandon']) {
      assert.doesNotThrow(() => validateRecoveryHostBoundary(manifest, command, false), command)
    }
    unsafeRecovery = true
    assert.throws(() => validateRecoveryHostBoundary(manifest, 'hold', false), /unsafe protected path/)
  } finally { Object.assign(fs, original) }
})

test('fake Docker harness admits, captures evidence, and cleans only an exact stopped CID while preserving exit 7 and 130', async () => {
  for (const exitCode of [7, 130]) {
    const cid = exitCode === 7 ? 'b'.repeat(64) : 'c'.repeat(64); const calls = []
    const docker = async (args) => {
      calls.push(args)
      if (args[0] === 'create') return { code: 0, stdout: `${cid}\n`, stderr: '' }
      if (args[0] === 'inspect' && args[2] === '{{.Id}}') return { code: 0, stdout: `${cid}\n`, stderr: '' }
      if (args[0] === 'start') return { code: exitCode, stdout: '', stderr: '' }
      if (args[0] === 'inspect') return { code: 0, stdout: `false ${cid}\n`, stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    const evidence = []
    assert.equal(await runRecoveryContainer(['/protected/boundary.json', 'status', '--offline'], { docker, readManifest: () => manifest,
      validateHost: () => undefined, writeEvidence: (_manifest, item) => evidence.push(item), writeStdout: () => undefined, writeStderr: () => undefined }), exitCode)
    assert.deepEqual(calls.at(-1), ['rm', cid]); assert.equal(calls.filter((args) => args[0] === 'rm').length, 1)
    assert.equal(evidence.length, 1); assert.equal(evidence[0].exit_code, exitCode)
  }
})

test('fake Docker harness never deletes a pre-existing name or unproven CID', async () => {
  let calls = 0
  await assert.rejects(runRecoveryContainer(['/protected/boundary.json', 'discover'], { readManifest: () => manifest,
    validateHost: () => undefined, docker: async () => { calls += 1; return { code: 1, stdout: '', stderr: 'name exists' } } }), /admission failed/)
  assert.equal(calls, 2)
  const docker = async (args) => args[0] === 'create' ? { code: 0, stdout: `${'d'.repeat(64)}\n`, stderr: '' }
    : { code: 0, stdout: `${'e'.repeat(64)}\n`, stderr: '' }
  await assert.rejects(runRecoveryContainer(['/protected/boundary.json', 'discover'], { docker, readManifest: () => manifest, validateHost: () => undefined }), /identity/)
})

test('signals are installed before admission, repeated signals escalate, and Docker calls are bounded under a scrubbed daemon environment', async () => {
  const cid = 'f'.repeat(64); const process = new EventEmitter(); const calls = []; let releaseStart
  const startGate = new Promise((resolve) => { releaseStart = resolve })
  const docker = async (args, options) => {
    calls.push({ args, options })
    assert.deepEqual(Object.keys(options.environment).sort(), ['DOCKER_CONFIG', 'DOCKER_HOST', 'HOME', 'LANG', 'LC_ALL', 'PATH', 'TZ'])
    assert.ok(Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0)
    if (args[0] === 'create') return { code: 0, stdout: `${cid}\n`, stderr: '' }
    if (args[0] === 'inspect' && args[2] === '{{.Id}}') return { code: 0, stdout: `${cid}\n`, stderr: '' }
    if (args[0] === 'inspect' && args[2].includes('.Config.Labels')) return { code: 0, stdout: `${cid} ${calls[0].args[calls[0].args.indexOf('--label') + 1].split('=')[1]}\n`, stderr: '' }
    if (args[0] === 'start') { process.emit('SIGTERM'); process.emit('SIGTERM'); await startGate; return { code: 0, stdout: '', stderr: '' } }
    if (args[0] === 'inspect') return { code: 0, stdout: `false ${cid}\n`, stderr: '' }
    if (args[0] === 'kill') releaseStart()
    return { code: 0, stdout: '', stderr: '' }
  }
  assert.equal(await runRecoveryContainer(['/protected/boundary.json', 'status', '--offline'], { docker, process, readManifest: () => manifest,
    validateHost: () => undefined, writeEvidence: () => undefined, writeStdout: () => undefined, writeStderr: () => undefined }), 130)
  assert.ok(calls.some(({ args }) => args[0] === 'stop')); assert.ok(calls.some(({ args }) => args[0] === 'kill'))
})

test('a signal delivered before create prevents any Docker mutation', async () => {
  const process = new EventEmitter(); let calls = 0
  assert.equal(await runRecoveryContainer(['/protected/boundary.json', 'discover'], { process,
    readManifest: () => { process.emit('SIGTERM'); return manifest }, validateHost: () => undefined,
    docker: async () => { calls += 1; throw new Error('must not run') } }), 130)
  assert.equal(calls, 0)
})

test('a signal delivered during create skips start, records evidence, and removes only the exact stopped CID', async () => {
  const cid = '7'.repeat(64); const process = new EventEmitter(); const calls = []; const evidence = []
  const docker = async (args) => {
    calls.push(args)
    if (args[0] === 'create') { process.emit('SIGINT'); return { code: 0, stdout: `${cid}\n`, stderr: '' } }
    if (args[0] === 'inspect' && args[2] === '{{.Id}}') return { code: 0, stdout: `${cid}\n`, stderr: '' }
    if (args[0] === 'inspect' && args[2].includes('.Config.Labels')) return { code: 0, stdout: `${cid} ${calls[0][calls[0].indexOf('--label') + 1].split('=')[1]}\n`, stderr: '' }
    if (args[0] === 'inspect') return { code: 0, stdout: `false ${cid}\n`, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  assert.equal(await runRecoveryContainer(['/protected/boundary.json', 'status', '--offline'], { docker, process,
    readManifest: () => manifest, validateHost: () => undefined, writeEvidence: (_manifest, item) => evidence.push(item),
    writeStdout: () => undefined, writeStderr: () => undefined }), 130)
  assert.equal(calls.some((args) => args[0] === 'start'), false); assert.deepEqual(calls.at(-1), ['rm', cid]); assert.equal(evidence.length, 1)
})

test('cancellation reconciles a stop-before-start race with a second bounded stop and leaves no pending runner', async () => {
  const cid = '3'.repeat(64); const process = new EventEmitter(); const calls = []; let containerRunning = false; let startSettled = false
  let releaseStart; const startGate = new Promise((resolve) => { releaseStart = resolve }); let stopCount = 0
  const docker = async (args) => {
    calls.push(args)
    if (args[0] === 'create') return { code: 0, stdout: `${cid}\n`, stderr: '' }
    if (args[0] === 'inspect' && args[2] === '{{.Id}}') return { code: 0, stdout: `${cid}\n`, stderr: '' }
    if (args[0] === 'inspect' && args[2].includes('.Config.Labels')) return { code: 0, stdout: `${cid} ${calls[0][calls[0].indexOf('--label') + 1].split('=')[1]}\n`, stderr: '' }
    if (args[0] === 'inspect') return { code: 0, stdout: `${containerRunning ? 'true' : 'false'} ${cid}\n`, stderr: '' }
    if (args[0] === 'start') {
      process.emit('SIGTERM'); await startGate
      containerRunning = true; startSettled = true; return { code: 130, stdout: '', stderr: '' }
    }
    if (args[0] === 'stop') {
      stopCount += 1; containerRunning = false
      if (stopCount === 1) setImmediate(releaseStart)
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  const result = await runRecoveryContainer(['/protected/boundary.json', 'status', '--offline'], { docker, process,
    readManifest: () => manifest, validateHost: () => undefined, writeEvidence: () => undefined,
    writeStdout: () => undefined, writeStderr: () => undefined })
  assert.equal(result, 130); assert.equal(startSettled, true); assert.equal(containerRunning, false)
  assert.ok(calls.filter((args) => args[0] === 'stop').length >= 2); assert.deepEqual(calls.at(-1), ['rm', cid])
})

test('pending attach cancellation contains inspect failures, truncation, mismatch, and rejection without unhandled work', async () => {
  for (const fault of ['exit', 'timeout', 'truncated', 'mismatch', 'reject', 'pending']) {
    const cid = '2'.repeat(64); const signalProcess = new EventEmitter(); const evidence = []; let admission; let afterStart = false
    let faultUsed = false; let attachAborted = false
    const docker = async (args, options) => {
      if (args[0] === 'create') { admission = args[args.indexOf('--label') + 1].split('=')[1]; return { code: 0, stdout: `${cid}\n`, stderr: '' } }
      if (args[0] === 'start') {
        afterStart = true; signalProcess.emit('SIGTERM')
        return new Promise((resolve, reject) => {
          const abort = () => { attachAborted = true; if (fault !== 'pending') reject(new Error('attach aborted')) }
          if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true })
        })
      }
      if (args[0] === 'inspect' && afterStart && !faultUsed) {
        faultUsed = true
        if (fault === 'reject') throw new Error('inspect spawn rejected')
        if (fault === 'exit') return { code: 1, stdout: '', stderr: 'inspect failed' }
        if (fault === 'timeout') return { code: 124, stdout: '', stderr: '', timedOut: true }
        if (fault === 'truncated') return { code: 0, stdout: cid, stderr: '', stdoutTruncated: true }
        return { code: 0, stdout: `${'1'.repeat(64)}\n`, stderr: '' }
      }
      if (args[0] === 'inspect' && args[2] === '{{.Id}}') return { code: 0, stdout: `${cid}\n`, stderr: '' }
      if (args[0] === 'inspect' && args[2].includes('.Config.Labels')) return { code: 0, stdout: `${cid} ${admission}\n`, stderr: '' }
      if (args[0] === 'inspect') return { code: 0, stdout: `false ${cid}\n`, stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    const unhandled = []; const onUnhandled = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const started = Date.now()
    try {
      await assert.rejects(runRecoveryContainer(['/protected/boundary.json', 'status', '--offline'], { docker, process: signalProcess,
        readManifest: () => manifest, validateHost: () => undefined, writeEvidence: (_manifest, item) => evidence.push(item),
        writeStdout: () => undefined, writeStderr: () => undefined, attachJoinTimeoutMs: 25 }), /failed closed|attach aborted|inspect spawn rejected/)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(attachAborted, true, fault); assert.equal(unhandled.length, 0, fault)
      assert.ok(Date.now() - started < 1_000, fault); assert.ok(evidence.some((item) => item.runner_failed), fault)
    } finally { process.off('unhandledRejection', onUnhandled) }
  }
})

test('an uncertain create result cleans a container only when its generated admission label is proven', async () => {
  const cid = '6'.repeat(64); const calls = []; let label
  const docker = async (args) => {
    calls.push(args)
    if (args[0] === 'create') { label = args[args.indexOf('--label') + 1].split('=')[1]; return { code: 130, stdout: '', stderr: '', timedOut: true } }
    if (args[0] === 'inspect' && args[2].includes('.Config.Labels')) return { code: 0, stdout: `${cid} ${label}\n`, stderr: '' }
    if (args[0] === 'inspect') return { code: 0, stdout: `false ${cid}\n`, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  await assert.rejects(runRecoveryContainer(['/protected/boundary.json', 'discover'], { docker, readManifest: () => manifest,
    validateHost: () => undefined, writeEvidence: () => undefined }), /admission failed/)
  assert.deepEqual(calls.at(-1), ['rm', cid])
})

test('a fixed-name identity mismatch cleans only the returned CID carrying this admission label', async () => {
  const cid = '5'.repeat(64); const other = '4'.repeat(64); const calls = []; let label
  const docker = async (args) => {
    calls.push(args)
    if (args[0] === 'create') { label = args[args.indexOf('--label') + 1].split('=')[1]; return { code: 0, stdout: `${cid}\n`, stderr: '' } }
    if (args[0] === 'inspect' && args[2] === '{{.Id}}') return { code: 0, stdout: `${other}\n`, stderr: '' }
    if (args[0] === 'inspect' && args[2].includes('.Config.Labels')) return { code: 0, stdout: `${cid} ${label}\n`, stderr: '' }
    if (args[0] === 'inspect') return { code: 0, stdout: `false ${cid}\n`, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  await assert.rejects(runRecoveryContainer(['/protected/boundary.json', 'discover'], { docker, readManifest: () => manifest,
    validateHost: () => undefined, writeEvidence: () => undefined }), /identity/)
  assert.deepEqual(calls.at(-1), ['rm', cid]); assert.equal(calls.some((args) => args[0] === 'rm' && args[1] === other), false)
})

test('failed bounded stop and kill retain the admitted container after recording evidence', async () => {
  const cid = '8'.repeat(64); const calls = []; const process = new EventEmitter(); const evidence = []; let admission
  const docker = async (args) => {
    calls.push(args)
    if (args[0] === 'create') { admission = args[args.indexOf('--label') + 1].split('=')[1]; return { code: 0, stdout: `${cid}\n`, stderr: '' } }
    if (args[0] === 'inspect' && args[2] === '{{.Id}}') return { code: 0, stdout: `${cid}\n`, stderr: '' }
    if (args[0] === 'inspect' && args[2].includes('.Config.Labels')) return { code: 0, stdout: `${cid} ${admission}\n`, stderr: '' }
    if (args[0] === 'start') { process.emit('SIGTERM'); return { code: 130, stdout: '', stderr: '' } }
    if (args[0] === 'stop') return { code: 124, stdout: '', stderr: '', timedOut: true }
    if (args[0] === 'kill') return { code: 1, stdout: '', stderr: 'daemon unavailable' }
    return { code: 0, stdout: `true ${cid}\n`, stderr: '' }
  }
  await assert.rejects(runRecoveryContainer(['/protected/boundary.json', 'status', '--offline'], { docker, process,
    readManifest: () => manifest, validateHost: () => undefined, writeEvidence: (_manifest, item) => evidence.push(item),
    writeStdout: () => undefined, writeStderr: () => undefined }), /termination failed closed/)
  assert.equal(evidence[0].termination_failed, true); assert.equal(calls.some((args) => args[0] === 'rm'), false)
})

test('bounded stdout overflow is recorded before exact stopped-CID cleanup and then fails closed', async () => {
  const cid = '9'.repeat(64); const order = []; let admission
  const docker = async (args) => {
    if (args[0] === 'create') { admission = args[args.indexOf('--label') + 1].split('=')[1]; return { code: 0, stdout: `${cid}\n`, stderr: '' } }
    if (args[0] === 'inspect' && args[2] === '{{.Id}}') return { code: 0, stdout: `${cid}\n`, stderr: '' }
    if (args[0] === 'inspect' && args[2].includes('.Config.Labels')) return { code: 0, stdout: `${cid} ${admission}\n`, stderr: '' }
    if (args[0] === 'start') return { code: 130, stdout: 'x'.repeat(manifest.stdoutMaxBytes), stderr: '', stdoutTruncated: true }
    if (args[0] === 'stop') return { code: 0, stdout: '', stderr: '' }
    if (args[0] === 'inspect') return { code: 0, stdout: `false ${cid}\n`, stderr: '' }
    if (args[0] === 'rm') order.push('rm')
    return { code: 0, stdout: '', stderr: '' }
  }
  await assert.rejects(runRecoveryContainer(['/protected/boundary.json', 'status', '--offline'], { docker, readManifest: () => manifest,
    validateHost: () => undefined, writeEvidence: (_manifest, evidence) => { assert.equal(evidence.stdout_truncated, true); order.push('evidence') },
    writeStdout: () => undefined, writeStderr: () => undefined }), /bound was exceeded/)
  assert.deepEqual(order, ['evidence', 'rm'])
})
