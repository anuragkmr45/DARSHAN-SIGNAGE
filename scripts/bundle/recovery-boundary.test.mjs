import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateRecoveryBoundary } from './generate-recovery-boundary.mjs'

test('generator binds an immutable image and emits a separate canonical c2 boundary manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-recovery-boundary-'))
  const output = path.join(root, 'out'); const imageManifest = path.join(root, 'IMAGE_MANIFEST.tsv')
  const artifacts = { launcher: path.join(root, 'runner'), library: path.join(root, 'library'), runtimeManifest: path.join(root, 'runtime-manifest'), hostNode: path.join(root, 'node') }
  for (const [name, file] of Object.entries(artifacts)) fs.writeFileSync(file, name)
  fs.writeFileSync(artifacts.hostNode, '#!/bin/sh\nprintf "linux:x64:20\\n"\n', { mode: 0o755 })
  fs.chmodSync(artifacts.hostNode, 0o755)
  fs.writeFileSync(imageManifest, `backend.tar\tbackend:r1\tsha256:${'a'.repeat(64)}\tamd64\tlinux\n`)
  const prior = { ...process.env }
  Object.assign(process.env, { BACKUP_SITE_ID: 'site-a', BACKUP_REPOSITORY_ROOT: '/var/lib/darshan/site-a/backup-repository',
    BACKUP_REPOSITORY_DEVICE_ID: '123', BACKUP_REPOSITORY_ID: '11111111-1111-4111-8111-111111111111',
    BACKUP_RECOVERY_SOCKET_DIR: '/var/lib/darshan/site-a/recovery-broker-socket', BACKUP_BROKER_HELPER_VERSION: '2.0.0',
    BACKUP_BROKER_POLICY_SHA256: 'b'.repeat(64), RECOVERY_OPERATOR_CONFIG_ROOT: '/var/lib/darshan/site-a/recovery-operator-config',
    RECOVERY_PLAN_ROOT: '/var/lib/darshan/site-a/recovery-plans', RECOVERY_JOURNAL_ROOT: '/var/lib/darshan/site-a/recovery-journal',
    RECOVERY_REVIEW_ROOT: '/var/lib/darshan/site-a/recovery-reviews', RECOVERY_EVIDENCE_ROOT: '/var/lib/darshan/site-a/recovery-evidence',
    RECOVERY_DOCKER_CONFIG_ROOT: '/var/lib/darshan/site-a/recovery-docker-config', RECOVERY_CPU_LIMIT: '1.5', RECOVERY_MEMORY_LIMIT: '512m', RECOVERY_PIDS_LIMIT: '128', RECOVERY_SCRATCH_TMPFS_BYTES: '268435456',
    RECOVERY_HOME_TMPFS_BYTES: '16777216', RECOVERY_TMP_TMPFS_BYTES: '67108864', RECOVERY_JOURNAL_MIN_FREE_BYTES: '1073741824',
    RECOVERY_EVIDENCE_MIN_FREE_BYTES: '1073741824', RECOVERY_OUTPUT_MIN_FREE_BYTES: '1073741824', RECOVERY_BROKER_CONTROL_TIMEOUT_MS: '60000',
    RECOVERY_RUN_TIMEOUT_MS: '14400000', RECOVERY_STDOUT_MAX_BYTES: '524288', RECOVERY_STDERR_MAX_BYTES: '524288', NODE_OPTIONS: '--require=/poisoned/loader.cjs' })
  try {
    const manifest = generateRecoveryBoundary(output, imageManifest, 'backend:r1', artifacts)
    assert.equal(manifest.imageId, `sha256:${'a'.repeat(64)}`)
    assert.equal(manifest.paths.recoverySocketDirectory, '/var/lib/darshan/site-a/recovery-broker-socket')
    assert.equal(manifest.cpuLimit, '1.5'); assert.match(manifest.artifacts.launcherSha256, /^[a-f0-9]{64}$/)
    assert.deepEqual(manifest.hostRuntime, { platform: 'linux', arch: 'x64', nodeMajor: 20 })
    const bytes = fs.readFileSync(path.join(output, 'boundary-manifest.json'))
    assert.equal(bytes.at(-1), 0x0a); assert.equal(fs.statSync(path.join(output, 'boundary-manifest.json')).mode & 0o777, 0o600)
    const config = JSON.parse(fs.readFileSync(path.join(output, 'operator-config.json'), 'utf8'))
    assert.equal(config.broker.socket_path, '/run/darshan-recovery-broker/recovery.sock')
    assert.equal(config.trust.policy_keyring_file, '/run/darshan-recovery-policy-trust/policy-keyring.json')
    assert.ok(!bytes.includes(Buffer.from('NODE_OPTIONS')))
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key]
    Object.assign(process.env, prior); fs.rmSync(root, { recursive: true, force: true })
  }
})
