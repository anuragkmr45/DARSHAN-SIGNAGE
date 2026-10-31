#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { canonicalJson, RECOVERY_BOUNDARY_FORMAT, validateRecoveryBoundaryManifest } from './recovery-boundary-lib.mjs'

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value }
function integer(name) { const value = required(name); if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${name} is invalid`); return Number(value) }
function memoryBytes(value) {
  const match = /^([1-9][0-9]*)([kmg])$/i.exec(value)
  if (!match) throw new Error('RECOVERY_MEMORY_LIMIT must use canonical k/m/g units')
  const multiplier = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2].toLowerCase()]
  const result = Number(match[1]) * multiplier
  if (!Number.isSafeInteger(result)) throw new Error('RECOVERY_MEMORY_LIMIT exceeds the safe bound')
  return result
}
function imageId(manifestFile, expectedRef) {
  const lines = fs.readFileSync(manifestFile, 'utf8').trim().split('\n').map((line) => line.split('\t'))
  const found = lines.filter((fields) => fields.length === 5 && fields[1] === expectedRef)
  if (found.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(found[0][2])) throw new Error('Backend image identity is absent or ambiguous')
  return found[0][2]
}
function sha256(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function hostRuntime(file) {
  const value = execFileSync(file, ['-p', '`${process.platform}:${process.arch}:${process.versions.node.split(".")[0]}`'],
    { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: '/', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' }, timeout: 10_000 }).trim()
  if (value !== 'linux:x64:20') throw new Error('Pinned recovery host runtime must execute as Linux x64 Node.js 20 on the build host')
  return { platform: 'linux', arch: 'x64', nodeMajor: 20 }
}

export function generateRecoveryBoundary(outputDirectory, imageManifestFile, expectedImageRef, artifactFiles) {
  const siteId = required('BACKUP_SITE_ID'); const base = `/var/lib/darshan/${siteId}`
  const manifest = validateRecoveryBoundaryManifest({
    format: RECOVERY_BOUNDARY_FORMAT, siteId, containerName: `darshan-${siteId}-recovery-operator`,
    imageId: imageId(imageManifestFile, expectedImageRef), cpuLimit: required('RECOVERY_CPU_LIMIT'),
    memoryBytes: memoryBytes(required('RECOVERY_MEMORY_LIMIT')), pidsLimit: integer('RECOVERY_PIDS_LIMIT'),
    scratchTmpfsBytes: integer('RECOVERY_SCRATCH_TMPFS_BYTES'), homeTmpfsBytes: integer('RECOVERY_HOME_TMPFS_BYTES'),
    temporaryTmpfsBytes: integer('RECOVERY_TMP_TMPFS_BYTES'), journalMinimumFreeBytes: integer('RECOVERY_JOURNAL_MIN_FREE_BYTES'),
    evidenceMinimumFreeBytes: integer('RECOVERY_EVIDENCE_MIN_FREE_BYTES'), outputMinimumFreeBytes: integer('RECOVERY_OUTPUT_MIN_FREE_BYTES'),
    brokerControlTimeoutMs: integer('RECOVERY_BROKER_CONTROL_TIMEOUT_MS'), stdoutMaxBytes: integer('RECOVERY_STDOUT_MAX_BYTES'),
    stderrMaxBytes: integer('RECOVERY_STDERR_MAX_BYTES'), runTimeoutMs: integer('RECOVERY_RUN_TIMEOUT_MS'), stopGraceSeconds: 15,
    repositoryDeviceId: required('BACKUP_REPOSITORY_DEVICE_ID'), ownerUid: 1000, ownerGid: 1000,
    paths: { repository: required('BACKUP_REPOSITORY_ROOT'), configFile: `${required('RECOVERY_OPERATOR_CONFIG_ROOT')}/operator-config.json`,
      policyKeyring: `${base}/recovery-policy-trust/policy-keyring.json`, manifestKeyring: `${base}/recovery-manifest-trust/manifest-keyring.json`,
      planDirectory: required('RECOVERY_PLAN_ROOT'), journalDirectory: required('RECOVERY_JOURNAL_ROOT'), reviewDirectory: required('RECOVERY_REVIEW_ROOT'),
      evidenceDirectory: required('RECOVERY_EVIDENCE_ROOT'), recoverySocketDirectory: required('BACKUP_RECOVERY_SOCKET_DIR'),
      dockerConfigDirectory: required('RECOVERY_DOCKER_CONFIG_ROOT') },
    artifacts: { launcherSha256: sha256(artifactFiles.launcher), librarySha256: sha256(artifactFiles.library),
      runtimeManifestSha256: sha256(artifactFiles.runtimeManifest), hostNodeSha256: sha256(artifactFiles.hostNode) },
    hostRuntime: hostRuntime(artifactFiles.hostNode),
  })
  const operatorConfig = { format: 'darshan-recovery-operator-config-v2', site_id: siteId,
    repository: { root: '/run/darshan-recovery-repository', device_id: manifest.repositoryDeviceId, owner_uid: 1000, owner_gid: 1000,
      repository_id: required('BACKUP_REPOSITORY_ID') },
    trust: { policy_keyring_file: '/run/darshan-recovery-policy-trust/policy-keyring.json', manifest_keyring_file: '/run/darshan-recovery-manifest-trust/manifest-keyring.json' },
    target: { target_id: 'darshan-server-release-01', release_id: 'release-01', migrations_directory: '/app/drizzle/migrations' },
    broker: { socket_path: '/run/darshan-recovery-broker/recovery.sock', helper_version: required('BACKUP_BROKER_HELPER_VERSION'),
      policy_sha256: required('BACKUP_BROKER_POLICY_SHA256'), control_timeout_ms: manifest.brokerControlTimeoutMs },
    journal: { root: '/run/darshan-recovery-journal' } }
  fs.mkdirSync(outputDirectory, { recursive: false, mode: 0o700 })
  fs.writeFileSync(path.join(outputDirectory, 'boundary-manifest.json'), canonicalJson(manifest), { mode: 0o600 })
  fs.writeFileSync(path.join(outputDirectory, 'operator-config.json'), canonicalJson(operatorConfig), { mode: 0o600 })
  return manifest
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [outputDirectory, imageManifestFile, expectedImageRef, launcher, library, runtimeManifest, hostNode] = process.argv.slice(2)
  if (![outputDirectory, imageManifestFile, expectedImageRef, launcher, library, runtimeManifest, hostNode].every(Boolean)) {
    throw new Error('Usage: generate-recovery-boundary OUTPUT IMAGE_MANIFEST IMAGE_REF LAUNCHER LIBRARY RUNTIME_MANIFEST HOST_NODE')
  }
  generateRecoveryBoundary(outputDirectory, imageManifestFile, expectedImageRef, { launcher, library, runtimeManifest, hostNode })
}
