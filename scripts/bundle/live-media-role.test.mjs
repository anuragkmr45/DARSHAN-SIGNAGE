import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderLiveMediaRole } from './render-live-media-role.mjs'

test('generated media and Backend overlay are parsed by real Compose without starting a service', t => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-live-role-'))
  try {
    const media = path.join(root, 'media'), backend = path.join(root, 'backend')
    fs.mkdirSync(backend)
    const env = { SITE_NAME: 'own-fixture', DARSHAN_RELEASE_ID: 'r1', MEDIA_IMAGE: 'darshan-media:r1', MEDIA_PRIVATE_HOST: 'media.test',
      MEDIA_BIND_ADDRESS: '10.20.0.60', MEDIA_CONTROL_PORT: '18784', MEDIA_SIGNAL_PORT: '18780', MEDIA_RTC_TCP_PORT: '18782',
      MEDIA_RTC_UDP_PORT: '18783', MEDIA_CPU_LIMIT: '4', MEDIA_MEMORY_LIMIT: '4g', MEDIA_PIDS_LIMIT: '512', MEDIA_MIN_FREE_DISK_BYTES: '10737418240',
      BACKEND_PRIVATE_HOST: 'backend.test', API_HOST_PORT: '3000', CMS_PUBLIC_HOST: 'cms.test', CMS_HTTPS_PORT: '443',
      CONTAINER_LOG_MAX_SIZE: '20m', CONTAINER_LOG_MAX_FILES: '5', PLAYER_SOURCE_COMMIT: 'a'.repeat(40), DARSHAN_COMPATIBILITY_GENERATION: '1' }
    renderLiveMediaRole(media, backend, repo, env)
    assert.equal(fs.existsSync(path.join(media, 'host-witness.test.py')), false)
    assert.equal(fs.existsSync(path.join(media, 'watchdog-health.test.py')), false)
    assert.equal(fs.existsSync(path.join(media, '__pycache__')), false)
    assert.equal(fs.existsSync(path.join(media, 'watchdog-health.py')), true)
    assert.equal(fs.existsSync(path.join(media, 'authority.json')), false)
    assert.equal(fs.existsSync(path.join(media, 'media.key')), false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(backend, 'LIVE_RUNTIME.json'))).enabledByDefault, false)
    const result = spawnSync('docker', ['compose', '--env-file', '.env.production', '-f', 'docker-compose.yml', 'config', '--format', 'json'], { cwd: media, encoding: 'utf8' })
    if (result.error?.code === 'ENOENT') { t.skip('Docker Compose CLI unavailable'); return }
    assert.equal(result.status, 0, result.stderr)
    const service = JSON.parse(result.stdout).services.media
    assert.equal(service.user, '1000:1000')
    assert.equal(service.restart, 'no')
    assert.equal(service.pull_policy, 'never')
    assert.equal(service.read_only, true)
    assert.deepEqual(service.cap_drop, ['ALL'])
    assert.equal(service.environment.DARSHAN_MEDIA_HOST_LEASE_FILE, '/run/darshan-media-host-lease/lease.json')
    assert.equal(service.volumes.find(v => v.target === '/run/darshan-media-host-lease').read_only, true)
    assert.equal(service.volumes.some(v => String(v.source).includes('/host')), false)
    assert.equal(service.ports.some(p => p.target === 18781), false)
    assert.equal(service.environment.DARSHAN_MEDIA_SFU_URL, 'http://127.0.0.1:18781')
    fs.writeFileSync(path.join(backend, 'base.yml'), 'services:\n  api:\n    image: fixture:1\n    environment:\n      DARSHAN_CONTAINER_ROLE: api\n  worker:\n    image: fixture:1\n    environment:\n      DARSHAN_CONTAINER_ROLE: worker\n')
    const overlay = spawnSync('docker', ['compose', '-f', 'base.yml', '-f', 'docker-compose.live.yml', 'config', '--format', 'json'], { cwd: backend, encoding: 'utf8' })
    assert.equal(overlay.status, 0, overlay.stderr)
    const model = JSON.parse(overlay.stdout)
    for (const [role, service] of Object.entries(model.services)) {
      assert.equal(service.environment.DARSHAN_LIVE_RUNTIME_ENABLED, 'true')
      assert.equal(service.environment.DARSHAN_CONTAINER_ROLE, role)
      assert.equal(service.volumes.find(v => v.target === '/run/darshan-live').read_only, true)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
