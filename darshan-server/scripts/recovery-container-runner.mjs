#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildRecoveryDockerCreateArgs, canonicalJson, recoveryDockerEnvironment, validateRecoveryBoundaryManifest } from './recovery-boundary-lib.mjs'

const CID = /^[a-f0-9]{64}$/
const DOCKER = '/usr/bin/docker'
const CONTROL_OUTPUT_BYTES = 4096
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

export function assertProtectedManifestMetadata(stat, policy = {}) {
  const ownerUid = policy.ownerUid ?? 0; const mode = policy.mode ?? 0o640
  const groups = policy.groups ?? process.getgroups()
  if (!stat.isFile() || stat.nlink !== 1n || stat.size < 2n || stat.size > 64n * 1024n ||
      Number(stat.uid) !== ownerUid || Number(stat.mode & 0o777n) !== mode || (mode & 0o040) !== 0 && !groups.includes(Number(stat.gid))) {
    throw new Error('Recovery boundary manifest is not a protected bounded signed-role file.')
  }
}

export function readProtectedManifest(file, testPolicy) {
  const resolved = path.resolve(file); const handle = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const before = fs.fstatSync(handle, { bigint: true })
    assertProtectedManifestMetadata(before, testPolicy)
    if (fs.realpathSync(resolved) !== resolved) throw new Error('Recovery boundary manifest path is not canonical.')
    const expected = Number(before.size); const bytes = Buffer.allocUnsafe(expected); let offset = 0
    while (offset < expected) {
      const count = fs.readSync(handle, bytes, offset, expected - offset, offset)
      if (count === 0) break
      offset += count
    }
    const overflow = Buffer.allocUnsafe(1); const extra = fs.readSync(handle, overflow, 0, 1, expected)
    const after = fs.fstatSync(handle, { bigint: true })
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw new Error('Recovery boundary manifest changed during read.')
    }
    if (offset !== expected || extra !== 0) throw new Error('Recovery boundary manifest size changed during bounded read.')
    const parsed = validateRecoveryBoundaryManifest(JSON.parse(bytes.toString('utf8')))
    if (!canonicalJson(parsed).equals(bytes)) throw new Error('Recovery boundary manifest is not canonical.')
    const root = path.dirname(path.dirname(resolved)); const artifacts = {
      launcherSha256: sha256(path.join(root, 'recovery-container-runner.mjs')),
      librarySha256: sha256(path.join(root, 'recovery-boundary-lib.mjs')),
      runtimeManifestSha256: sha256(path.join(root, 'recovery-runtime-manifest.json')),
      hostNodeSha256: sha256(path.join(root, 'runtime/node')),
    }
    for (const [name, digest] of Object.entries(artifacts)) if (parsed.artifacts[name] !== digest) throw new Error(`Recovery boundary ${name} mismatch.`)
    if (sha256(process.execPath) !== parsed.artifacts.hostNodeSha256) throw new Error('Recovery runner is not using the pinned host Node runtime content.')
    return parsed
  } finally { fs.closeSync(handle) }
}

function assertProtectedPath(value, expected) {
  const stat = fs.lstatSync(value, { bigint: true })
  if (stat.isSymbolicLink() || (expected.directory ? !stat.isDirectory() : !stat.isFile()) ||
      Number(stat.uid) !== expected.uid || Number(stat.gid) !== expected.gid || Number(stat.mode & 0o777n) !== expected.mode ||
      (!expected.directory && stat.nlink !== 1n) || fs.realpathSync(value) !== value) {
    throw new Error('Recovery host boundary contains an unsafe protected path.')
  }
  return stat
}
function assertFreeBytes(value, minimum) {
  const stat = fs.statfsSync(value, { bigint: true }); const available = stat.bavail * stat.bsize
  if (available < BigInt(minimum)) throw new Error('Recovery host boundary is below an explicit free-space floor.')
}
export function validateRecoveryHostBoundary(manifest, command, offline = false) {
  const protectedIdentity = { uid: 1000, gid: 1000 }
  assertProtectedPath(manifest.paths.configFile, { ...protectedIdentity, directory: false, mode: 0o600 })
  assertProtectedPath(manifest.paths.evidenceDirectory, { ...protectedIdentity, directory: true, mode: 0o700 })
  assertProtectedPath(manifest.paths.dockerConfigDirectory, { uid: process.getuid(), gid: process.getgid(), directory: true, mode: 0o700 })
  if (['discover', 'plan', 'hold', 'verify-source', 'resume'].includes(command)) {
    const repository = assertProtectedPath(manifest.paths.repository, { ...protectedIdentity, directory: true, mode: 0o700 })
    if (repository.dev.toString() !== manifest.repositoryDeviceId) throw new Error('Recovery repository device identity changed.')
    assertProtectedPath(manifest.paths.policyKeyring, { ...protectedIdentity, directory: false, mode: 0o600 })
    assertProtectedPath(manifest.paths.manifestKeyring, { ...protectedIdentity, directory: false, mode: 0o600 })
  }
  if (command !== 'discover') assertProtectedPath(manifest.paths.planDirectory, { ...protectedIdentity, directory: true, mode: 0o700 })
  if (!['discover', 'plan'].includes(command)) assertProtectedPath(manifest.paths.journalDirectory, { ...protectedIdentity, directory: true, mode: 0o700 })
  if (['release', 'abandon'].includes(command)) assertProtectedPath(manifest.paths.reviewDirectory, { ...protectedIdentity, directory: true, mode: 0o700 })
  if (['hold', 'verify-source', 'resume', 'status', 'release', 'abandon'].includes(command) && !offline) {
    assertProtectedPath(manifest.paths.recoverySocketDirectory, { uid: 0, gid: 1000, directory: true, mode: 0o710 })
  }
  assertFreeBytes(manifest.paths.evidenceDirectory, manifest.evidenceMinimumFreeBytes)
  if (command === 'plan') assertFreeBytes(manifest.paths.planDirectory, manifest.outputMinimumFreeBytes)
  if (!['discover', 'plan'].includes(command)) assertFreeBytes(manifest.paths.journalDirectory, manifest.journalMinimumFreeBytes)
}

function execDocker(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(DOCKER, args, { env: options.environment, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []; const stderr = []; let stdoutBytes = 0; let stderrBytes = 0
    let stdoutTruncated = false; let stderrTruncated = false; let timedOut = false
    const collect = (target, chunk, maximum, stream) => {
      const used = stream === 'stdout' ? stdoutBytes : stderrBytes; const remaining = Math.max(0, maximum - used)
      if (remaining > 0) target.push(chunk.subarray(0, remaining))
      if (stream === 'stdout') stdoutBytes += Math.min(chunk.length, remaining); else stderrBytes += Math.min(chunk.length, remaining)
      if (chunk.length > remaining) {
        if (stream === 'stdout') stdoutTruncated = true; else stderrTruncated = true
        child.kill('SIGKILL')
      }
    }
    child.stdout.on('data', (chunk) => collect(stdout, chunk, options.stdoutMaxBytes, 'stdout'))
    child.stderr.on('data', (chunk) => collect(stderr, chunk, options.stderrMaxBytes, 'stderr'))
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, options.timeoutMs); timer.unref?.()
    const abort = () => child.kill('SIGKILL')
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(error) })
    child.once('close', (code, signal) => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); resolve({ code: code ?? (signal ? 130 : 1),
      stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'),
      stdoutTruncated, stderrTruncated, timedOut }) })
  })
}

function writeEvidence(manifest, evidence) {
  const file = path.join(manifest.paths.evidenceDirectory, `recovery-container-${Date.now()}-${randomUUID()}.json`)
  const bytes = canonicalJson(evidence)
  const maximumEvidenceBytes = 2 * (manifest.stdoutMaxBytes + manifest.stderrMaxBytes) + 64 * 1024
  if (bytes.byteLength > maximumEvidenceBytes) throw new Error('Recovery evidence exceeds its base64-derived bounded size.')
  const handle = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  const directory = fs.openSync(manifest.paths.evidenceDirectory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY)
  try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
  return file
}

export async function runRecoveryContainer(argv, dependencies = {}) {
  const docker = dependencies.docker ?? execDocker; const signalProcess = dependencies.process ?? process
  const [manifestFile, command, ...commandArgs] = argv
  if (!manifestFile || !command) throw new Error('Usage: recovery-container-runner <boundary-manifest> <command> [reviewed recovery options]')
  let signalCount = 0; let admitted = false; let running = false; let cid; let manifest; let invoke; let admissionId
  let startAbort; let observedStart; let startSettled = true; let recoveryEvidenceWritten = false; let containerRemoved = false
  const attachJoinTimeoutMs = Number.isSafeInteger(dependencies.attachJoinTimeoutMs) && dependencies.attachJoinTimeoutMs > 0
    ? Math.min(10_000, dependencies.attachJoinTimeoutMs) : 10_000
  let cancellationRequested = false; let wakeCancellation
  const cancellationSignal = new Promise((resolve) => { wakeCancellation = resolve })
  const requestCancellation = () => { cancellationRequested = true; wakeCancellation() }
  let termination = Promise.resolve(); let terminationError
  const terminate = (force) => {
    if (!admitted || !running || !cid || !invoke) return
    termination = termination.then(async () => {
      const action = force ? ['kill', '--signal', 'KILL', cid] : ['stop', '--time', String(manifest.stopGraceSeconds), cid]
      const result = await invoke(action)
      if (result.code !== 0 || result.timedOut || result.stdoutTruncated || result.stderrTruncated) {
        if (!force) {
          const escalated = await invoke(['kill', '--signal', 'KILL', cid])
          if (escalated.code === 0 && !escalated.timedOut && !escalated.stdoutTruncated && !escalated.stderrTruncated) return
        }
        throw new Error('Exact recovery container termination failed closed.')
      }
    }).catch((error) => { terminationError = error })
  }
  const onSignal = () => { signalCount += 1; requestCancellation() }
  signalProcess.on('SIGINT', onSignal); signalProcess.on('SIGTERM', onSignal)
  try {
    manifest = (dependencies.readManifest ?? readProtectedManifest)(manifestFile)
    const offline = command === 'status' && commandArgs.includes('--offline')
    const filtered = offline ? commandArgs.filter((arg) => arg !== '--offline') : commandArgs
    ;(dependencies.validateHost ?? validateRecoveryHostBoundary)(manifest, command, offline)
    const environment = recoveryDockerEnvironment(manifest)
    invoke = (args, stdoutMaxBytes = CONTROL_OUTPUT_BYTES, stderrMaxBytes = CONTROL_OUTPUT_BYTES,
      timeoutMs = manifest.brokerControlTimeoutMs, signal) =>
      docker(args, { environment, stdoutMaxBytes, stderrMaxBytes, timeoutMs, signal })
    const validControlResult = (result) => result && Number.isInteger(result.code) && result.code === 0 &&
      !result.timedOut && !result.stdoutTruncated && !result.stderrTruncated &&
      typeof result.stdout === 'string' && typeof result.stderr === 'string'
    if (signalCount > 0) return 130
    admissionId = randomUUID()
    const created = await invoke(buildRecoveryDockerCreateArgs(manifest, { command, offline, commandArgs: filtered, admissionId }))
    cid = created.stdout.trim()
    if (created.code !== 0 || created.timedOut || created.stdoutTruncated || created.stderrTruncated || !CID.test(cid)) {
      const uncertain = await invoke(['inspect', '--format', '{{.Id}} {{index .Config.Labels "com.darshan.recovery-admission"}}', manifest.containerName])
      const [uncertainCid, uncertainAdmission, ...extra] = uncertain.stdout.trim().split(/\s+/)
      if (validControlResult(uncertain) && CID.test(uncertainCid) && uncertainAdmission === admissionId && extra.length === 0) {
        cid = uncertainCid; admitted = true
        const state = await invoke(['inspect', '--format', '{{.State.Running}} {{.Id}}', cid])
        if (!validControlResult(state)) throw new Error('Created-container running state could not be proven.')
        if (state.stdout.trim() === `true ${cid}`) { running = true; terminate(false); await termination }
        ;(dependencies.writeEvidence ?? writeEvidence)(manifest, { format: 'darshan-recovery-container-evidence-v1', command, cid,
          admission_failed: true, signal_count: signalCount, create_timed_out: Boolean(created.timedOut),
          create_stdout_truncated: Boolean(created.stdoutTruncated), create_stderr_truncated: Boolean(created.stderrTruncated) })
        const stopped = await invoke(['inspect', '--format', '{{.State.Running}} {{.Id}}', cid])
        if (!terminationError && validControlResult(stopped) && stopped.stdout.trim() === `false ${cid}`) {
          const removed = await invoke(['rm', cid]); containerRemoved = validControlResult(removed)
        }
      }
      throw new Error('Recovery container admission failed; no existing fixed-name container was removed.')
    }
    const inspected = await invoke(['inspect', '--format', '{{.Id}}', manifest.containerName])
    if (inspected.code !== 0 || inspected.timedOut || inspected.stdoutTruncated || inspected.stderrTruncated || inspected.stdout.trim() !== cid) {
      const owned = await invoke(['inspect', '--format', '{{.Id}} {{index .Config.Labels "com.darshan.recovery-admission"}}', cid])
      if (validControlResult(owned) && owned.stdout.trim() === `${cid} ${admissionId}`) {
        admitted = true
        ;(dependencies.writeEvidence ?? writeEvidence)(manifest, { format: 'darshan-recovery-container-evidence-v1', command, cid,
          identity_admission_failed: true, signal_count: signalCount })
        const stopped = await invoke(['inspect', '--format', '{{.State.Running}} {{.Id}}', cid])
        if (validControlResult(stopped) && stopped.stdout.trim() === `false ${cid}`) {
          const removed = await invoke(['rm', cid]); containerRemoved = validControlResult(removed)
        }
      }
      throw new Error('Recovery container identity did not match the exact admitted CID.')
    }
    admitted = true
    let execution = { code: 130, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, timedOut: false }
    let cancellationAmbiguous = false
    startSettled = signalCount > 0
    let settleStart
    const startSettlement = new Promise((resolve) => { settleStart = resolve })
    if (startSettled) settleStart()
    startAbort = new AbortController()
    let reconciliationError
    const reconcileCancellation = (async () => {
      await cancellationSignal
      const deadline = Date.now() + Math.min(240_000, Math.max(10_000, manifest.brokerControlTimeoutMs * 3))
      const remaining = () => Math.max(1, deadline - Date.now())
      let actionFailed = false
      for (let attempt = 0; attempt < 8 && Date.now() < deadline; attempt += 1) {
        const [nameIdentity, admissionIdentity, state] = await Promise.all([
          invoke(['inspect', '--format', '{{.Id}}', manifest.containerName], CONTROL_OUTPUT_BYTES, CONTROL_OUTPUT_BYTES, remaining()),
          invoke(['inspect', '--format', '{{.Id}} {{index .Config.Labels "com.darshan.recovery-admission"}}', cid], CONTROL_OUTPUT_BYTES, CONTROL_OUTPUT_BYTES, remaining()),
          invoke(['inspect', '--format', '{{.State.Running}} {{.Id}}', cid], CONTROL_OUTPUT_BYTES, CONTROL_OUTPUT_BYTES, remaining()),
        ])
        if (!validControlResult(nameIdentity) || !validControlResult(admissionIdentity) || !validControlResult(state) ||
            nameIdentity.stdout.trim() !== cid || admissionIdentity.stdout.trim() !== `${cid} ${admissionId}` ||
            ![`false ${cid}`, `true ${cid}`].includes(state.stdout.trim())) return false
        if (startSettled && state.stdout.trim() === `false ${cid}`) return true
        const action = attempt < 2
          ? ['stop', '--time', String(manifest.stopGraceSeconds), cid]
          : ['kill', '--signal', 'KILL', cid]
        const stopped = await invoke(action, CONTROL_OUTPUT_BYTES, CONTROL_OUTPUT_BYTES, remaining())
        if (!validControlResult(stopped)) actionFailed = true
        await Promise.race([startSettlement, new Promise((resolve) => setTimeout(resolve, 25))])
      }
      startAbort.abort()
      await Promise.race([startSettlement, new Promise((resolve) => setTimeout(resolve, Math.min(1_000, remaining())))])
      if (actionFailed) terminationError = new Error('Exact recovery container termination failed closed.')
      return false
    })().catch((error) => { reconciliationError = error; return false })
    if (signalCount === 0) {
      running = true
      const startTask = invoke(['start', '--attach', cid], manifest.stdoutMaxBytes, manifest.stderrMaxBytes,
        manifest.runTimeoutMs, startAbort.signal)
      observedStart = startTask.then((result) => { startSettled = true; settleStart(); return result },
        (error) => { startSettled = true; settleStart(); throw error })
      void observedStart.catch(() => undefined)
      execution = await Promise.race([observedStart, reconcileCancellation.then((reconciled) => {
        if (reconciled) return observedStart
        startAbort.abort()
        throw reconciliationError ?? new Error('Recovery cancellation reconciliation failed closed.')
      })])
      running = false
      if (execution.timedOut || execution.stdoutTruncated || execution.stderrTruncated) requestCancellation()
    }
    if (signalCount > 0 && !startSettled) { startSettled = true; settleStart() }
    if (signalCount > 0 || execution.timedOut || execution.stdoutTruncated || execution.stderrTruncated) {
      if (!cancellationRequested) requestCancellation()
      cancellationAmbiguous = !(await reconcileCancellation)
    }
    const evidence = { format: 'darshan-recovery-container-evidence-v1', command, cid, exit_code: execution.code,
      signal_count: signalCount, timed_out: execution.timedOut, stdout_truncated: execution.stdoutTruncated,
      stderr_truncated: execution.stderrTruncated, termination_failed: Boolean(terminationError), cancellation_ambiguous: cancellationAmbiguous,
      stdout_base64: Buffer.from(execution.stdout).toString('base64'), stderr_base64: Buffer.from(execution.stderr).toString('base64') }
    ;(dependencies.writeEvidence ?? writeEvidence)(manifest, evidence)
    recoveryEvidenceWritten = true
    ;(dependencies.writeStdout ?? ((value) => process.stdout.write(value)))(execution.stdout)
    ;(dependencies.writeStderr ?? ((value) => process.stderr.write(value)))(execution.stderr)
    const stopped = await invoke(['inspect', '--format', '{{.State.Running}} {{.Id}}', cid])
    if (!validControlResult(stopped) || stopped.stdout.trim() !== `false ${cid}`) {
      if (terminationError) throw terminationError
      throw new Error('Exact recovery container stopped state could not be proven; container was retained.')
    }
    const removed = await invoke(['rm', cid])
    if (removed.code !== 0 || removed.timedOut || removed.stdoutTruncated || removed.stderrTruncated) throw new Error('Exact stopped recovery container cleanup failed.')
    containerRemoved = true
    if (terminationError) throw terminationError
    if (cancellationAmbiguous) throw new Error('Recovery container cancellation identity or state remained ambiguous.')
    if (execution.timedOut || execution.stdoutTruncated || execution.stderrTruncated) throw new Error('Recovery container output or execution bound was exceeded.')
    return signalCount > 0 && execution.code === 0 ? 130 : execution.code
  } catch (error) {
    if (admitted && cid && invoke && manifest && !containerRemoved) {
      requestCancellation(); startAbort?.abort()
      if (observedStart && !startSettled) {
        await Promise.race([observedStart.catch(() => undefined), new Promise((resolve) => setTimeout(resolve,
          Math.min(attachJoinTimeoutMs, manifest.brokerControlTimeoutMs)))])
        if (!startSettled) observedStart = undefined
      }
      const safeControl = async (args) => {
        try { return await invoke(args, CONTROL_OUTPUT_BYTES, CONTROL_OUTPUT_BYTES, Math.min(10_000, manifest.brokerControlTimeoutMs)) }
        catch { return undefined }
      }
      const valid = (result) => result && result.code === 0 && !result.timedOut && !result.stdoutTruncated &&
        !result.stderrTruncated && typeof result.stdout === 'string'
      let exact = false; let finalStopped = false; let finalAmbiguous = true
      const name = await safeControl(['inspect', '--format', '{{.Id}}', manifest.containerName])
      const admission = await safeControl(['inspect', '--format', '{{.Id}} {{index .Config.Labels "com.darshan.recovery-admission"}}', cid])
      if (valid(name) && valid(admission) && name.stdout.trim() === cid && admission.stdout.trim() === `${cid} ${admissionId}`) {
        exact = true
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const state = await safeControl(['inspect', '--format', '{{.State.Running}} {{.Id}}', cid])
          if (!valid(state) || ![`true ${cid}`, `false ${cid}`].includes(state.stdout.trim())) break
          if (state.stdout.trim() === `false ${cid}` && startSettled) { finalStopped = true; finalAmbiguous = false; break }
          await safeControl(attempt < 2 ? ['stop', '--time', String(manifest.stopGraceSeconds), cid] : ['kill', '--signal', 'KILL', cid])
        }
      }
      try {
        ;(dependencies.writeEvidence ?? writeEvidence)(manifest, { format: 'darshan-recovery-container-finalization-v1', command, cid,
          runner_failed: true, signal_count: signalCount, exact_identity: exact, attach_settled: startSettled,
          final_stopped: finalStopped, cancellation_ambiguous: finalAmbiguous,
          prior_execution_evidence_written: recoveryEvidenceWritten })
        recoveryEvidenceWritten = true
      } catch { /* retain the original failure; the protected evidence write failed closed */ }
    }
    throw error
  } finally {
    startAbort?.abort()
    if (observedStart && !startSettled && manifest) {
      await Promise.race([observedStart.catch(() => undefined), new Promise((resolve) => setTimeout(resolve,
        Math.min(attachJoinTimeoutMs, manifest.brokerControlTimeoutMs)))])
    }
    signalProcess.off('SIGINT', onSignal); signalProcess.off('SIGTERM', onSignal)
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = await runRecoveryContainer(process.argv.slice(2)) }
  catch { process.stderr.write('Recovery container runner failed closed.\n'); process.exitCode = 78 }
}
