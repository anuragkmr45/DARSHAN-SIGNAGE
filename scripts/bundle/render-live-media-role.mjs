#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

export function renderLiveMediaRole(mediaDir, backendDir, repo, env = process.env) {
  const required = key => { if (!env[key]) throw new Error(`${key} is required for the media role`); return env[key] }
  const values = Object.fromEntries(['SITE_NAME', 'DARSHAN_RELEASE_ID', 'MEDIA_IMAGE', 'MEDIA_PRIVATE_HOST', 'MEDIA_BIND_ADDRESS',
    'MEDIA_CONTROL_PORT', 'MEDIA_SIGNAL_PORT', 'MEDIA_RTC_TCP_PORT', 'MEDIA_RTC_UDP_PORT', 'MEDIA_CPU_LIMIT', 'MEDIA_MEMORY_LIMIT',
    'MEDIA_PIDS_LIMIT', 'MEDIA_MIN_FREE_DISK_BYTES', 'BACKEND_PRIVATE_HOST', 'API_HOST_PORT', 'CMS_PUBLIC_HOST', 'CMS_HTTPS_PORT',
    'CONTAINER_LOG_MAX_SIZE', 'CONTAINER_LOG_MAX_FILES'].map(key => [key, required(key)]))
  values.PRIVATE_ROOT = `/etc/darshan/sites/${values.SITE_NAME}/live`
  const put = (name, content, mode = 0o750) => fs.writeFileSync(path.join(mediaDir, name), content, { mode })
  fs.mkdirSync(mediaDir, { recursive: true })
  const templateRoot = path.join(repo, 'deploy/production/media')
  for (const file of fs.readdirSync(templateRoot)) {
    if (!fs.statSync(path.join(templateRoot, file)).isFile()) continue
    if (file.startsWith('.') || file.endsWith('.test.py') || file === 'backend-live-runtime.sh') continue
    fs.copyFileSync(path.join(repo, 'deploy/production/media', file), path.join(mediaDir, file))
    fs.chmodSync(path.join(mediaDir, file), file.endsWith('.sh') || file.endsWith('.py') ? 0o750 : 0o640)
  }
  // The updated watchdog is installed atomically before the backend-mode node
  // starts; its optional authority boot field must never reach an old parser.
  fs.copyFileSync(path.join(repo, 'darshan-media/host-watchdog.py'), path.join(mediaDir, 'host-watchdog.py'))
  fs.copyFileSync(path.join(repo, 'darshan-media/deploy/darshan-media-watchdog@.service'), path.join(mediaDir, 'darshan-media-watchdog@.service'))
  put('.env.production', Object.entries({ ...values, COMPOSE_PROJECT_NAME: `darshan-${values.SITE_NAME}-media` }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', 0o640)
  put('role.json', JSON.stringify({ version: 1, site: values.SITE_NAME, release: values.DARSHAN_RELEASE_ID,
    private_root: values.PRIVATE_ROOT, control_url: `https://${values.MEDIA_PRIVATE_HOST}:${values.MEDIA_CONTROL_PORT}`,
    witness_url: `https://${values.BACKEND_PRIVATE_HOST}:${values.API_HOST_PORT}/api/v1/internal/live-media-witness`,
    media_image: values.MEDIA_IMAGE, media_uid: 1000, backend_effective_uid: 1000,
    acceptance: { capacity: 'UNMEASURED', direct_pidfd_lsm: 'OPEN', cross_vm: 'OPEN', windows: 'OPEN', restore: 'OPEN' } }, null, 2) + '\n', 0o640)
  put('COMPATIBILITY.json', JSON.stringify({ schemaVersion: 1, siteName: values.SITE_NAME, role: 'media', releaseId: values.DARSHAN_RELEASE_ID,
    sourceCommit: env.PLAYER_SOURCE_COMMIT, compatibilityGeneration: Number(env.DARSHAN_COMPATIBILITY_GENERATION),
    requires: { backend: Number(env.DARSHAN_COMPATIBILITY_GENERATION), player: Number(env.DARSHAN_COMPATIBILITY_GENERATION) } }, null, 2) + '\n', 0o640)
  fs.copyFileSync(path.join(repo, 'docs/runbooks/live-media-vm-deployment.md'), path.join(mediaDir, 'README.md'))
  const privateRoot = values.PRIVATE_ROOT
  fs.copyFileSync(path.join(repo, 'deploy/production/media/provision-private.py'), path.join(backendDir, 'provision-live-private.py'))
  fs.copyFileSync(path.join(repo, 'deploy/production/media/backend-live-runtime.sh'), path.join(backendDir, 'live-runtime.sh'))
  fs.chmodSync(path.join(backendDir, 'live-runtime.sh'), 0o750)
  fs.writeFileSync(path.join(backendDir, 'docker-compose.live.yml'), `services:
  api: &live-api
    environment:
      DARSHAN_LIVE_RUNTIME_ENABLED: "true"
      DARSHAN_LIVE_AUTHORITY_FILE: /run/darshan-live/authority.json
      DARSHAN_LIVE_MEDIA_CONTROL_URL: https://${values.MEDIA_PRIVATE_HOST}:${values.MEDIA_CONTROL_PORT}
      DARSHAN_LIVE_MEDIA_CA_CERT_PATH: /run/darshan-live/site-ca.crt
      DARSHAN_LIVE_MEDIA_CONTROL_SECRET_FILE: /run/darshan-live/control-secret
      DARSHAN_LIVE_NODE_WITNESS_SECRET_FILE: /run/darshan-live/witness-secret
    volumes:
      - ${privateRoot}/backend:/run/darshan-live:ro
  worker:
    <<: *live-api
`, { mode: 0o640 })
  fs.writeFileSync(path.join(backendDir, 'LIVE_RUNTIME.json'), JSON.stringify({ enabledByDefault: false, privateRoot,
    effectiveUid: 1000, mediaOrigin: `https://${values.MEDIA_PRIVATE_HOST}:${values.MEDIA_CONTROL_PORT}` }, null, 2) + '\n', { mode: 0o640 })
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  renderLiveMediaRole(...process.argv.slice(2))
}
