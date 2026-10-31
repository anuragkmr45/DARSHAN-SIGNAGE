import path from 'node:path'

export const RECOVERY_BOUNDARY_FORMAT = 'darshan-recovery-container-boundary-v1'
const RECOVERY_DOCKER_BASE_ENVIRONMENT = Object.freeze({
  PATH: '/usr/bin:/bin', HOME: '/', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
})
const COMMANDS = new Set(['discover', 'plan', 'hold', 'verify-source', 'resume', 'status', 'release', 'abandon'])
const MUTATING_JOURNAL = new Set(['hold', 'verify-source', 'resume', 'release', 'abandon'])
const BROKER_COMMANDS = new Set(['hold', 'verify-source', 'resume', 'status', 'release', 'abandon'])
const SOURCE_COMMANDS = new Set(['discover', 'plan', 'hold', 'verify-source', 'resume'])

function fail(message) { throw new Error(`Recovery boundary invalid: ${message}`) }
function absolute(name, value) {
  if (typeof value !== 'string' || !path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || value === '/') fail(`${name} must be a canonical non-root absolute path`)
}
function positive(name, value, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`${name} must be an explicitly bounded positive integer`)
}
function distinctRoots(paths) {
  const entries = Object.entries(paths)
  for (let left = 0; left < entries.length; left += 1) for (let right = left + 1; right < entries.length; right += 1) {
    const [leftName, leftPath] = entries[left]; const [rightName, rightPath] = entries[right]
    if (leftPath === rightPath || leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`)) {
      fail(`${leftName} and ${rightName} must not overlap`)
    }
  }
}

export function validateRecoveryBoundaryManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== RECOVERY_BOUNDARY_FORMAT) fail('format is unsupported')
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value.siteId ?? '')) fail('siteId is invalid')
  if (value.containerName !== `darshan-${value.siteId}-recovery-operator`) fail('containerName is not the fixed site-wide name')
  if (!/^sha256:[a-f0-9]{64}$/.test(value.imageId ?? '')) fail('imageId must be an immutable Docker image ID')
  if (typeof value.cpuLimit !== 'string' || !/^(?:0\.[0-9]+|[1-9][0-9]*(?:\.[0-9]+)?)$/.test(value.cpuLimit) ||
      Number(value.cpuLimit) < 0.1 || Number(value.cpuLimit) > 128) fail('cpuLimit is invalid')
  positive('memoryBytes', value.memoryBytes, 64 * 1024 * 1024); positive('pidsLimit', value.pidsLimit, 16)
  positive('scratchTmpfsBytes', value.scratchTmpfsBytes, 1024 * 1024)
  positive('homeTmpfsBytes', value.homeTmpfsBytes, 1024 * 1024); positive('temporaryTmpfsBytes', value.temporaryTmpfsBytes, 1024 * 1024)
  if (value.scratchTmpfsBytes + value.homeTmpfsBytes + value.temporaryTmpfsBytes > value.memoryBytes) fail('tmpfs ceilings exceed the container memory ceiling')
  positive('journalMinimumFreeBytes', value.journalMinimumFreeBytes, 1024 * 1024)
  positive('evidenceMinimumFreeBytes', value.evidenceMinimumFreeBytes, 1024 * 1024)
  positive('outputMinimumFreeBytes', value.outputMinimumFreeBytes, 1024 * 1024)
  positive('brokerControlTimeoutMs', value.brokerControlTimeoutMs, 1000)
  if (value.brokerControlTimeoutMs > 240000) fail('brokerControlTimeoutMs exceeds the protocol maximum')
  positive('runTimeoutMs', value.runTimeoutMs, 60_000)
  if (value.runTimeoutMs > 24 * 60 * 60 * 1000) fail('runTimeoutMs exceeds 24 hours')
  positive('stdoutMaxBytes', value.stdoutMaxBytes, 1024); positive('stderrMaxBytes', value.stderrMaxBytes, 1024)
  if (!Number.isSafeInteger(value.stdoutMaxBytes + value.stderrMaxBytes)) fail('combined log ceiling exceeds the safe bound')
  if (value.stopGraceSeconds < 10 || value.stopGraceSeconds > 240 || !Number.isSafeInteger(value.stopGraceSeconds)) fail('stopGraceSeconds must be 10..240')
  const requiredPaths = ['repository', 'configFile', 'policyKeyring', 'manifestKeyring', 'planDirectory', 'journalDirectory',
    'reviewDirectory', 'evidenceDirectory', 'recoverySocketDirectory', 'dockerConfigDirectory']
  for (const name of requiredPaths) absolute(`paths.${name}`, value.paths?.[name])
  distinctRoots({ repository: value.paths.repository, config: path.posix.dirname(value.paths.configFile),
    policyTrust: path.posix.dirname(value.paths.policyKeyring), manifestTrust: path.posix.dirname(value.paths.manifestKeyring),
    plans: value.paths.planDirectory, journal: value.paths.journalDirectory, reviews: value.paths.reviewDirectory,
    evidence: value.paths.evidenceDirectory, socket: value.paths.recoverySocketDirectory, dockerConfig: value.paths.dockerConfigDirectory })
  if (value.repositoryDeviceId === undefined || !/^[1-9][0-9]*$/.test(value.repositoryDeviceId)) fail('repositoryDeviceId is invalid')
  if (value.ownerUid !== 1000 || value.ownerGid !== 1000) fail('owner identity must be 1000:1000')
  for (const name of ['launcherSha256', 'librarySha256', 'runtimeManifestSha256', 'hostNodeSha256']) {
    if (!/^[a-f0-9]{64}$/.test(value.artifacts?.[name] ?? '')) fail(`artifacts.${name} is invalid`)
  }
  if (value.hostRuntime?.platform !== 'linux' || value.hostRuntime?.arch !== 'x64' || value.hostRuntime?.nodeMajor !== 20) {
    fail('hostRuntime must be the Linux x64 Node.js 20 contract')
  }
  return value
}

export function recoveryDockerEnvironment(manifest) {
  validateRecoveryBoundaryManifest(manifest)
  return Object.freeze({ ...RECOVERY_DOCKER_BASE_ENVIRONMENT, DOCKER_HOST: 'unix:///var/run/docker.sock',
    DOCKER_CONFIG: manifest.paths.dockerConfigDirectory })
}

const mount = (source, target, readOnly) => ({ source, target, readOnly })
export function recoveryMountProfile(manifest, command, offline = false) {
  validateRecoveryBoundaryManifest(manifest)
  if (!COMMANDS.has(command) || (offline && command !== 'status')) fail('command/offline profile is unsupported')
  const mounts = [mount(path.posix.dirname(manifest.paths.configFile), '/run/darshan-recovery-config', true),
    mount(manifest.paths.evidenceDirectory, '/run/darshan-recovery-evidence', false)]
  if (SOURCE_COMMANDS.has(command)) {
    mounts.push(mount(manifest.paths.repository, '/run/darshan-recovery-repository', true))
    mounts.push(mount(path.posix.dirname(manifest.paths.policyKeyring), '/run/darshan-recovery-policy-trust', true))
    mounts.push(mount(path.posix.dirname(manifest.paths.manifestKeyring), '/run/darshan-recovery-manifest-trust', true))
  }
  if (command !== 'discover') mounts.push(mount(manifest.paths.planDirectory, '/run/darshan-recovery-plans', command !== 'plan'))
  if (!['discover', 'plan'].includes(command)) mounts.push(mount(manifest.paths.journalDirectory, '/run/darshan-recovery-journal', !MUTATING_JOURNAL.has(command)))
  if (['release', 'abandon'].includes(command)) mounts.push(mount(manifest.paths.reviewDirectory, '/run/darshan-recovery-reviews', true))
  if (BROKER_COMMANDS.has(command) && !offline) mounts.push(mount(manifest.paths.recoverySocketDirectory, '/run/darshan-recovery-broker', true))
  return mounts
}

function dockerMount(item) {
  return `type=bind,src=${item.source},dst=${item.target}${item.readOnly ? ',readonly' : ''},bind-nonrecursive`
}

export function buildRecoveryDockerCreateArgs(manifest, input) {
  validateRecoveryBoundaryManifest(manifest)
  const { command, offline = false, commandArgs = [], admissionId } = input
  if (!COMMANDS.has(command) || !Array.isArray(commandArgs) || commandArgs.length > 31 || commandArgs.some((arg) => typeof arg !== 'string' || arg.length < 1 || arg.length > 4096 || arg.includes('\0'))) fail('command arguments are invalid')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(admissionId ?? '')) fail('admissionId is invalid')
  for (const argument of commandArgs) {
    if ((argument.startsWith('/') && path.posix.normalize(argument) !== argument) || argument.split('/').includes('..')) fail('command path traversal is forbidden')
  }
  const args = ['create', '--name', manifest.containerName, '--label', `com.darshan.recovery-admission=${admissionId}`, '--pull', 'never', '--network', 'none', '--read-only', '--user', '1000:1000',
    '--cpus', manifest.cpuLimit, '--memory', String(manifest.memoryBytes), '--pids-limit', String(manifest.pidsLimit),
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--stop-signal', 'SIGTERM', '--stop-timeout', String(manifest.stopGraceSeconds),
    '--log-driver', 'local', '--log-opt', `max-size=${manifest.stdoutMaxBytes + manifest.stderrMaxBytes}b`, '--log-opt', 'max-file=1',
    '--entrypoint', '/usr/bin/env',
    '--tmpfs', `/var/tmp/darshan-recovery-runtime:rw,noexec,nosuid,nodev,size=${manifest.scratchTmpfsBytes},mode=0700,uid=1000,gid=1000`,
    '--tmpfs', `/var/tmp/darshan-recovery-runtime/home:rw,noexec,nosuid,nodev,size=${manifest.homeTmpfsBytes},mode=0700,uid=1000,gid=1000`,
    '--tmpfs', `/var/tmp/darshan-recovery-runtime/tmp:rw,noexec,nosuid,nodev,size=${manifest.temporaryTmpfsBytes},mode=0700,uid=1000,gid=1000`]
  for (const item of recoveryMountProfile(manifest, command, offline)) args.push('--mount', dockerMount(item))
  args.push(manifest.imageId, '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8', 'LC_ALL=C.UTF-8', 'TZ=UTC',
    'HOME=/var/tmp/darshan-recovery-runtime/home', 'TMPDIR=/var/tmp/darshan-recovery-runtime/tmp',
    '/usr/local/bin/node', '/app/dist-cli/scripts/recovery-runtime.js', command, '--config-file', '/run/darshan-recovery-config/operator-config.json',
    ...commandArgs, ...(offline ? ['--offline'] : []))
  return args
}

export function canonicalJson(value) {
  const visit = (item) => Array.isArray(item) ? item.map(visit) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([key, child]) => [key, visit(child)])) : item
  return Buffer.from(`${JSON.stringify(visit(value))}\n`)
}
