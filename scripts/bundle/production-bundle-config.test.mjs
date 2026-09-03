import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseBundleEnvText, loadProductionBundleConfig, toAssemblerEnvironment } from './production-bundle-config.mjs'

test('parser rejects unknown, duplicate, placeholder, and interpolated values', () => {
  assert.throws(() => parseBundleEnvText('UNKNOWN=value\n'), /unknown key/)
  assert.throws(() => parseBundleEnvText('SITE_NAME=a\nSITE_NAME=b\n'), /duplicates key/)
  assert.throws(() => parseBundleEnvText('SITE_NAME=<site>\n'), /placeholder/)
  assert.throws(() => parseBundleEnvText('JWT_SECRET=change-me-with-a-long-random-value\n'), /placeholder/)
  assert.throws(() => parseBundleEnvText('SITE_NAME=$(hostname)\n'), /shell interpolation/)
})

test('parser reports every malformed line in one pass', () => {
  let error
  try {
    parseBundleEnvText([
      'UNKNOWN=value',
      'SITE_NAME=site-a',
      'SITE_NAME=site-b',
      'CMS_PUBLIC_HOST=$(hostname)',
      'not-a-key-value-line',
    ].join('\n'))
  } catch (caught) {
    error = caught
  }
  assert.ok(error)
  assert.match(error.message, /unknown key/)
  assert.match(error.message, /duplicates key/)
  assert.match(error.message, /shell interpolation/)
  assert.match(error.message, /KEY=value syntax/)
})

test('production config derives HTTPS and separates transport from device CA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-bundle-config-'))
  const pkiRoot = path.join(root, 'pki')
  const secure = path.join(pkiRoot, 'site-a')
  const packages = path.join(root, 'packages')
  fs.mkdirSync(secure, { recursive: true })
  for (const role of ['server', 'cms', 'electron']) fs.mkdirSync(path.join(packages, 'r1', role), { recursive: true })
  for (const name of ['transport-ca.crt', 'transport-ca.key', 'device-ca.crt', 'device-ca.key']) {
    const file = path.join(secure, name)
    fs.writeFileSync(file, name)
    fs.chmodSync(file, name.endsWith('.key') ? 0o600 : 0o644)
  }
  const envFile = path.join(root, 'bundle.env')
  fs.writeFileSync(envFile, `RELEASE_ID=r1
SITE_NAME=site-a
EXPORT_SERVER=false
EXPORT_CMS=false
EXPORT_ELECTRON=false
PLAYER_TARGET_PLATFORMS=linux
PACKAGE_OUTPUT_BASE=${packages}
CMS_PUBLIC_HOST=10.20.0.30
BACKEND_PRIVATE_HOST=10.20.0.20
DATA_PRIVATE_HOST=10.20.0.10
OBSERVABILITY_PRIVATE_HOST=10.20.0.40
TRANSPORT_TLS_MODE=internal-ca
PKI_ROOT_DIR=${pkiRoot}
POSTGRES_PASSWORD=strong-postgres-pass
MINIO_ACCESS_KEY=darshan1
MINIO_SECRET_KEY=strong-minio-secret
JWT_SECRET=01234567890123456789012345678901
ADMIN_EMAIL=admin@example.test
ADMIN_PASSWORD=strong-admin-pass
`)
  const loaded = loadProductionBundleConfig(envFile, root)
  const runtime = toAssemblerEnvironment(loaded.config)
  assert.equal(runtime.CMS_PUBLIC_SCHEME, 'https')
  assert.equal(runtime.MINIO_USE_SSL, 'true')
  assert.equal(runtime.SERVER_TLS_ENABLED, 'true')
  assert.equal(runtime.CA_CERT_PATH, '/app/certs/device-ca.crt')
  assert.equal(runtime.TLS_CERT_PATH, '/app/certs/server.crt')
  assert.equal(loaded.config.BACKEND_DEVICE_HOST, '10.20.0.20')
  assert.equal(loaded.config.VALKEY_PRIVATE_HOST, '10.20.0.20')
  assert.equal(loaded.config.PLAYER_TARGET_PLATFORMS, 'linux')
  assert.equal(loaded.config.SITE_PKI_DIR, secure)
  const validText = fs.readFileSync(envFile, 'utf8')
  fs.writeFileSync(envFile, validText.replace('PLAYER_TARGET_PLATFORMS=linux', 'PLAYER_TARGET_PLATFORMS=macos'))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /PLAYER_TARGET_PLATFORMS must be/)
  fs.writeFileSync(envFile, validText
    .replace('strong-postgres-pass', 'has:a:colon-password')
    .replace('darshan1', 'darshan:access')
    .replace('strong-minio-secret', 'has:a:strong-minio-secret')
    .replace('01234567890123456789012345678901', 'has:a:01234567890123456789012345678901')
    .replace('strong-admin-pass', 'has:a:strong-admin-pass'))
  let error
  try {
    loadProductionBundleConfig(envFile, root)
  } catch (caught) {
    error = caught
  }
  assert.ok(error)
  for (const name of ['POSTGRES_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'JWT_SECRET', 'ADMIN_PASSWORD']) {
    assert.match(error.message, new RegExp(`${name} may contain only`))
  }
})
