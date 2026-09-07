import fs from 'node:fs'
import crypto from 'node:crypto'
import net from 'node:net'
import path from 'node:path'

const BOOLEAN_FIELDS = new Set([
  'EXPORT_SERVER', 'EXPORT_CMS', 'EXPORT_ELECTRON', 'INSTALL_PLAYWRIGHT_CHROMIUM',
  'VITE_ENABLE_PRODUCTION_LOCKDOWN', 'VITE_REALTIME_DELIVERY_STATUS_UI', 'VITE_MEDIA_CACHE_STATUS_UI',
  'WEBPAGE_ALLOW_HTTP',
])

const PORT_FIELDS = new Set([
  'CMS_HTTPS_PORT', 'CMS_HTTP_PORT', 'API_HOST_PORT', 'POSTGRES_HOST_PORT', 'MINIO_HOST_PORT',
  'MINIO_CONSOLE_PORT', 'VALKEY_HOST_PORT', 'PROMETHEUS_HOST_PORT', 'ALERTMANAGER_HOST_PORT', 'GRAFANA_HOST_PORT',
  'NODE_EXPORTER_HOST_PORT', 'POSTGRES_EXPORTER_HOST_PORT', 'NGINX_EXPORTER_HOST_PORT',
])

const HOST_FIELDS = new Set([
  'CMS_PUBLIC_HOST', 'BACKEND_PRIVATE_HOST', 'BACKEND_DEVICE_HOST', 'DATA_PRIVATE_HOST',
  'VALKEY_PRIVATE_HOST', 'OBSERVABILITY_PRIVATE_HOST',
])

// Docker host-port publication needs a concrete local interface. Keeping this
// separate from service DNS names avoids accidentally publishing sensitive
// services on every network interface when a host name is used for TLS/SAN.
const BIND_ADDRESS_FIELDS = new Set([
  'CMS_BIND_ADDRESS', 'BACKEND_BIND_ADDRESS', 'DATA_BIND_ADDRESS',
  'VALKEY_BIND_ADDRESS', 'OBSERVABILITY_BIND_ADDRESS',
])

const PATH_FIELDS = new Set([
  'PACKAGE_OUTPUT_BASE', 'BUNDLE_OUTPUT_BASE', 'SERVER_PACKAGE_DIR', 'CMS_PACKAGE_DIR', 'PLAYER_ARTIFACTS_DIR',
  'PKI_ROOT_DIR', 'SITE_PKI_DIR',
  'TRANSPORT_CA_CERT_FILE', 'TRANSPORT_CA_KEY_FILE', 'CMS_TLS_CERT_FILE', 'CMS_TLS_KEY_FILE',
  'BACKEND_TLS_CERT_FILE', 'BACKEND_TLS_KEY_FILE', 'MINIO_TLS_CERT_FILE', 'MINIO_TLS_KEY_FILE',
  'POSTGRES_TLS_CERT_FILE', 'POSTGRES_TLS_KEY_FILE', 'VALKEY_TLS_CERT_FILE', 'VALKEY_TLS_KEY_FILE',
  'DEVICE_CA_CERT_FILE', 'DEVICE_CA_KEY_FILE',
  'RELEASE_SIGNING_PRIVATE_KEY',
  'CAPACITY_EVIDENCE_FILE',
])

const SECRET_FIELDS = new Set([
  'POSTGRES_PASSWORD', 'POSTGRES_MONITORING_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'JWT_SECRET', 'VALKEY_PASSWORD',
  'OBSERVABILITY_METRICS_BEARER_TOKEN', 'GRAFANA_ADMIN_PASSWORD',
  'BACKUP_OFFHOST_ACCESS_KEY', 'BACKUP_OFFHOST_SECRET_KEY',
  'TRANSPORT_CA_KEY_FILE', 'CMS_TLS_KEY_FILE', 'BACKEND_TLS_KEY_FILE', 'MINIO_TLS_KEY_FILE',
  'POSTGRES_TLS_KEY_FILE', 'VALKEY_TLS_KEY_FILE', 'DEVICE_CA_KEY_FILE',
  'RELEASE_SIGNING_PRIVATE_KEY',
])

// Production capacity is deliberately a site decision. These values have no
// defaults and are consumed by the generated Compose roles.
const RESOURCE_COMPONENTS = [
  'POSTGRES', 'MINIO', 'VALKEY', 'BACKEND_API', 'BACKEND_WORKER', 'CMS',
  'PROMETHEUS', 'ALERTMANAGER', 'GRAFANA', 'EXPORTER',
]
const RESOURCE_LIMIT_FIELDS = RESOURCE_COMPONENTS.flatMap((component) => [
  `${component}_CPU_LIMIT`, `${component}_MEMORY_LIMIT`, `${component}_PIDS_LIMIT`,
])
const DISK_FREE_FIELDS = [
  'DATA_MIN_FREE_DISK_BYTES', 'VALKEY_MIN_FREE_DISK_BYTES', 'BACKEND_MIN_FREE_DISK_BYTES',
  'CMS_MIN_FREE_DISK_BYTES', 'OBSERVABILITY_MIN_FREE_DISK_BYTES',
]
const OPERATIONS_POLICY_FIELDS = [
  'CAPACITY_EVIDENCE_FILE',
  'BACKUP_INTERVAL_HOURS', 'BACKUP_RETENTION_DAYS', 'BACKUP_OFFHOST_DESTINATION',
  'BACKUP_OFFHOST_ENDPOINT', 'BACKUP_OFFHOST_REGION',
  'CONTAINER_LOG_MAX_SIZE', 'CONTAINER_LOG_MAX_FILES',
  ...DISK_FREE_FIELDS,
  ...RESOURCE_LIMIT_FIELDS,
]

const OUTPUTS = {
  RELEASE_ID: ['BUNDLE_OVERVIEW.md', 'CONFIGURATION_MANIFEST.json'],
  SITE_NAME: ['BUNDLE_OVERVIEW.md', 'CONFIGURATION_MANIFEST.json'],
  PLAYER_TARGET_PLATFORMS: ['BUNDLE_OVERVIEW.md', 'CONFIGURATION_MANIFEST.json', 'production/electron/'],
  CMS_PUBLIC_HOST: ['production/cms/.env.production', 'production/cms/nginx/default.conf', 'production/cms/www/config/app-config.json', 'production/observability/.env.production'],
  BACKEND_PRIVATE_HOST: ['production/backend/.env.production', 'production/cms/nginx/default.conf', 'production/observability/prometheus/prometheus.yml'],
  BACKEND_DEVICE_HOST: ['production/electron/config.json'],
  DATA_PRIVATE_HOST: ['production/backend/.env.production', 'production/cms/.env.production', 'production/observability/.env.production', 'production/observability/prometheus/prometheus.yml'],
  VALKEY_PRIVATE_HOST: ['production/backend/.env.production', 'production/valkey/.env.production', 'production/observability/.env.production', 'production/observability/prometheus/prometheus.yml'],
  CMS_BIND_ADDRESS: ['production/cms/.env.production'],
  BACKEND_BIND_ADDRESS: ['production/backend/.env.production', 'production/cms/.env.production', 'production/observability/.env.production'],
  DATA_BIND_ADDRESS: ['production/data/.env.production', 'production/backend/.env.production', 'production/cms/.env.production', 'production/observability/.env.production'],
  VALKEY_BIND_ADDRESS: ['production/valkey/.env.production', 'production/backend/.env.production', 'production/observability/.env.production'],
  OBSERVABILITY_BIND_ADDRESS: ['production/cms/.env.production', 'production/observability/.env.production'],
  DEVICE_AUTH_MODE: ['production/backend/.env.production'],
  DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT: ['production/backend/.env.production'],
  OBSERVABILITY_PRIVATE_HOST: ['production/cms/.env.production', 'production/observability/.env.production'],
  TRANSPORT_TLS_MODE: ['production/data/tls', 'production/backend/certs', 'production/cms/tls', 'production/electron/transport-ca.crt'],
  TRANSPORT_CA_CERT_FILE: ['production/data/tls/CAs/transport-ca.crt', 'production/backend/certs/transport-ca.crt', 'production/cms/tls/transport-ca.crt', 'production/electron/transport-ca.crt'],
  POSTGRES_TLS_CERT_FILE: ['production/data/tls/postgres.crt'],
  VALKEY_TLS_CERT_FILE: ['production/valkey/tls/server.crt'],
  DEVICE_CA_CERT_FILE: ['production/backend/certs/device-ca.crt'],
  DEVICE_CA_KEY_FILE: ['production/backend/certs/device-ca.key'],
  POSTGRES_PASSWORD: ['production/data/.env.production', 'production/backend/.env.production'],
  POSTGRES_MONITORING_PASSWORD: ['production/data/secrets/postgres-monitoring-password'],
  VALKEY_PASSWORD: ['production/valkey/secrets/valkey-password', 'production/backend/secrets/valkey-url'],
  OBSERVABILITY_METRICS_BEARER_TOKEN: [
    'production/backend/secrets/observability-metrics-bearer-token',
    'production/observability/secrets/backend-metrics-bearer-token',
  ],
  GRAFANA_ADMIN_USER: ['production/observability/.env.production'],
  GRAFANA_ADMIN_PASSWORD: ['production/observability/secrets/grafana-admin-password'],
  MINIO_ACCESS_KEY: ['production/data/.env.production', 'production/backend/.env.production'],
  MINIO_SECRET_KEY: ['production/data/.env.production', 'production/backend/.env.production'],
  JWT_SECRET: ['production/backend/.env.production'],
  BACKUP_INTERVAL_HOURS: ['OPERATIONS_POLICY.json'],
  BACKUP_RETENTION_DAYS: ['OPERATIONS_POLICY.json'],
  BACKUP_OFFHOST_DESTINATION: ['OPERATIONS_POLICY.json'],
  BACKUP_OFFHOST_ENDPOINT: ['OPERATIONS_POLICY.json', 'production/backend/.env.production'],
  BACKUP_OFFHOST_REGION: ['OPERATIONS_POLICY.json', 'production/backend/.env.production'],
  CAPACITY_EVIDENCE_FILE: ['OPERATIONS_POLICY.json', 'CONFIGURATION_MANIFEST.json'],
  BACKUP_OFFHOST_ACCESS_KEY: ['production/backend/worker-secrets/backup-offhost-access-key'],
  BACKUP_OFFHOST_SECRET_KEY: ['production/backend/worker-secrets/backup-offhost-secret-key'],
  CONTAINER_LOG_MAX_SIZE: ['OPERATIONS_POLICY.json'],
  CONTAINER_LOG_MAX_FILES: ['OPERATIONS_POLICY.json'],
  DATA_MIN_FREE_DISK_BYTES: ['OPERATIONS_POLICY.json', 'production/data/.env.production'],
  VALKEY_MIN_FREE_DISK_BYTES: ['OPERATIONS_POLICY.json', 'production/valkey/.env.production'],
  BACKEND_MIN_FREE_DISK_BYTES: ['OPERATIONS_POLICY.json', 'production/backend/.env.production'],
  CMS_MIN_FREE_DISK_BYTES: ['OPERATIONS_POLICY.json', 'production/cms/.env.production'],
  OBSERVABILITY_MIN_FREE_DISK_BYTES: ['OPERATIONS_POLICY.json', 'production/observability/.env.production'],
  INITIAL_ADMIN_EMAIL: ['production/backend/.env.production'],
  MAX_UPLOAD_MB: ['production/backend/.env.production'],
  WEBPAGE_NAVIGATION_ALLOWLIST: ['production/backend/.env.production', 'production/electron/config.json'],
  WEBPAGE_RESOURCE_ALLOWLIST: ['production/backend/.env.production', 'production/electron/config.json'],
  WEBPAGE_ALLOWED_CIDRS: ['production/backend/.env.production', 'production/electron/config.json'],
  WEBPAGE_ALLOWED_PORTS: ['production/backend/.env.production', 'production/electron/config.json'],
  WEBPAGE_ALLOW_HTTP: ['production/backend/.env.production', 'production/electron/config.json'],
  VITE_ENABLE_PRODUCTION_LOCKDOWN: ['CMS build artifact'],
  VITE_REALTIME_DELIVERY_STATUS_UI: ['CMS build artifact'],
  VITE_MEDIA_CACHE_STATUS_UI: ['CMS build artifact'],
}

const ALLOWED_FIELDS = new Set([
  'RELEASE_ID', 'SITE_NAME', 'EXPORT_SERVER', 'EXPORT_CMS', 'EXPORT_ELECTRON', 'ELECTRON_PLATFORM', 'PLAYER_TARGET_PLATFORMS',
  'INSTALL_PLAYWRIGHT_CHROMIUM', 'PACKAGE_OUTPUT_BASE', 'BUNDLE_OUTPUT_BASE', 'SERVER_PACKAGE_DIR', 'PKI_ROOT_DIR', 'SITE_PKI_DIR',
  'CMS_PACKAGE_DIR', 'PLAYER_ARTIFACTS_DIR', 'CMS_PUBLIC_HOST', 'BACKEND_PRIVATE_HOST', 'BACKEND_DEVICE_HOST',
  'DATA_PRIVATE_HOST', 'VALKEY_PRIVATE_HOST', 'OBSERVABILITY_PRIVATE_HOST',
  'CMS_BIND_ADDRESS', 'BACKEND_BIND_ADDRESS', 'DATA_BIND_ADDRESS', 'VALKEY_BIND_ADDRESS', 'OBSERVABILITY_BIND_ADDRESS',
  'CMS_HTTPS_PORT', 'CMS_HTTP_PORT',
  'API_HOST_PORT', 'POSTGRES_HOST_PORT', 'MINIO_HOST_PORT', 'MINIO_CONSOLE_PORT', 'VALKEY_HOST_PORT',
  'PROMETHEUS_HOST_PORT', 'ALERTMANAGER_HOST_PORT', 'GRAFANA_HOST_PORT',
  'NODE_EXPORTER_HOST_PORT', 'POSTGRES_EXPORTER_HOST_PORT', 'NGINX_EXPORTER_HOST_PORT', 'TRANSPORT_TLS_MODE',
  'TRANSPORT_CA_CERT_FILE', 'TRANSPORT_CA_KEY_FILE', 'CMS_TLS_CERT_FILE', 'CMS_TLS_KEY_FILE',
  'BACKEND_TLS_CERT_FILE', 'BACKEND_TLS_KEY_FILE', 'MINIO_TLS_CERT_FILE', 'MINIO_TLS_KEY_FILE',
  'POSTGRES_TLS_CERT_FILE', 'POSTGRES_TLS_KEY_FILE', 'VALKEY_TLS_CERT_FILE', 'VALKEY_TLS_KEY_FILE',
  'DEVICE_CA_CERT_FILE', 'DEVICE_CA_KEY_FILE', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_MONITORING_USER', 'POSTGRES_MONITORING_PASSWORD', 'POSTGRES_DB',
  'RELEASE_SIGNING_PRIVATE_KEY',
  'CAPACITY_EVIDENCE_FILE',
  'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'MINIO_REGION', 'JWT_SECRET', 'VALKEY_PASSWORD', 'OBSERVABILITY_METRICS_BEARER_TOKEN', 'GRAFANA_ADMIN_USER', 'GRAFANA_ADMIN_PASSWORD', 'JWT_EXPIRY', 'INITIAL_ADMIN_EMAIL',
  'BACKUP_OFFHOST_ACCESS_KEY', 'BACKUP_OFFHOST_SECRET_KEY',
  'DEVICE_AUTH_MODE', 'DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT',
  'MAX_UPLOAD_MB',
  'WEBPAGE_NAVIGATION_ALLOWLIST', 'WEBPAGE_RESOURCE_ALLOWLIST', 'WEBPAGE_ALLOWED_CIDRS', 'WEBPAGE_ALLOWED_PORTS', 'WEBPAGE_ALLOW_HTTP',
  'LOG_LEVEL', 'POSTGRES_IMAGE', 'MINIO_IMAGE', 'VALKEY_IMAGE', 'NGINX_IMAGE',
  'NODE_EXPORTER_IMAGE', 'POSTGRES_EXPORTER_IMAGE', 'NGINX_PROMETHEUS_EXPORTER_IMAGE',
  'PROMETHEUS_IMAGE', 'ALERTMANAGER_IMAGE', 'GRAFANA_IMAGE', 'PROMETHEUS_SCRAPE_INTERVAL',
  'PROMETHEUS_EVALUATION_INTERVAL', 'PROMETHEUS_RETENTION_TIME', 'VITE_ENABLE_PRODUCTION_LOCKDOWN',
  'VITE_REALTIME_DELIVERY_STATUS_UI', 'VITE_MEDIA_CACHE_STATUS_UI',
  ...OPERATIONS_POLICY_FIELDS,
])

const REQUIRED_FIELDS = [
  'RELEASE_ID', 'SITE_NAME', 'CMS_PUBLIC_HOST', 'BACKEND_PRIVATE_HOST', 'DATA_PRIVATE_HOST',
  'OBSERVABILITY_PRIVATE_HOST', 'CMS_BIND_ADDRESS', 'BACKEND_BIND_ADDRESS', 'DATA_BIND_ADDRESS',
  'VALKEY_BIND_ADDRESS', 'OBSERVABILITY_BIND_ADDRESS',
  'TRANSPORT_TLS_MODE', 'TRANSPORT_CA_CERT_FILE', 'DEVICE_CA_CERT_FILE', 'DEVICE_CA_KEY_FILE',
  'RELEASE_SIGNING_PRIVATE_KEY',
  'POSTGRES_PASSWORD', 'POSTGRES_MONITORING_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'JWT_SECRET', 'VALKEY_PASSWORD', 'OBSERVABILITY_METRICS_BEARER_TOKEN', 'GRAFANA_ADMIN_USER', 'GRAFANA_ADMIN_PASSWORD', 'INITIAL_ADMIN_EMAIL',
  'BACKUP_OFFHOST_ACCESS_KEY', 'BACKUP_OFFHOST_SECRET_KEY',
  'WEBPAGE_NAVIGATION_ALLOWLIST',
  ...OPERATIONS_POLICY_FIELDS,
]

const DEFAULTS = {
  EXPORT_SERVER: 'true', EXPORT_CMS: 'true', EXPORT_ELECTRON: 'false', ELECTRON_PLATFORM: 'linux',
  PLAYER_TARGET_PLATFORMS: 'windows,linux',
  INSTALL_PLAYWRIGHT_CHROMIUM: 'true', PACKAGE_OUTPUT_BASE: 'out', BUNDLE_OUTPUT_BASE: 'dist/onprem',
  CMS_HTTPS_PORT: '443', CMS_HTTP_PORT: '80', API_HOST_PORT: '3000', POSTGRES_HOST_PORT: '5432',
  MINIO_HOST_PORT: '9000', MINIO_CONSOLE_PORT: '9001', VALKEY_HOST_PORT: '6379',
  PROMETHEUS_HOST_PORT: '9090', ALERTMANAGER_HOST_PORT: '9093', GRAFANA_HOST_PORT: '3001',
  NODE_EXPORTER_HOST_PORT: '9100', POSTGRES_EXPORTER_HOST_PORT: '9187', NGINX_EXPORTER_HOST_PORT: '9113',
  POSTGRES_USER: 'postgres', POSTGRES_MONITORING_USER: 'darshan_monitoring', POSTGRES_DB: 'darshan', MINIO_REGION: 'us-east-1', BACKUP_OFFHOST_REGION: 'us-east-1', JWT_EXPIRY: '900', LOG_LEVEL: 'info', MAX_UPLOAD_MB: '500', WEBPAGE_RESOURCE_ALLOWLIST: '', WEBPAGE_ALLOWED_CIDRS: '', WEBPAGE_ALLOWED_PORTS: '443', WEBPAGE_ALLOW_HTTP: 'false',
  POSTGRES_IMAGE: 'postgres:15-alpine', MINIO_IMAGE: 'minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e', VALKEY_IMAGE: 'valkey/valkey:7-alpine',
  NGINX_IMAGE: 'nginx:1.27-alpine', PROMETHEUS_IMAGE: 'prom/prometheus:v3.3.1',
  ALERTMANAGER_IMAGE: 'prom/alertmanager:v0.28.1', GRAFANA_IMAGE: 'grafana/grafana:12.0.2',
  NODE_EXPORTER_IMAGE: 'prom/node-exporter:v1.9.1',
  POSTGRES_EXPORTER_IMAGE: 'quay.io/prometheuscommunity/postgres-exporter:v0.15.0',
  NGINX_PROMETHEUS_EXPORTER_IMAGE: 'nginx/nginx-prometheus-exporter:1.4.2',
  PROMETHEUS_SCRAPE_INTERVAL: '30s', PROMETHEUS_EVALUATION_INTERVAL: '30s', PROMETHEUS_RETENTION_TIME: '30d',
  VITE_ENABLE_PRODUCTION_LOCKDOWN: 'true', VITE_REALTIME_DELIVERY_STATUS_UI: 'true',
  VITE_MEDIA_CACHE_STATUS_UI: 'true',
  // Fresh installations do not need a legacy protocol window. Existing fleets
  // must explicitly opt into dual mode and provide a finite expiry below.
  DEVICE_AUTH_MODE: 'signature',
}

function fail(message) {
  throw createValidationError([message])
}

function createValidationError(messages) {
  const uniqueMessages = [...new Set(messages)]
  const count = uniqueMessages.length
  if (count === 1) return new Error(`Invalid production bundle config: ${uniqueMessages[0]}`)
  return new Error([
    `Invalid production bundle config (${count} errors):`,
    ...uniqueMessages.map((message, index) => `  ${index + 1}. ${message}`),
  ].join('\n'))
}

function unquote(value, lineNumber, addError) {
  if (!value.startsWith('"') && !value.startsWith("'")) return value
  const quote = value[0]
  if (value.length < 2 || value.at(-1) !== quote) {
    addError(`line ${lineNumber} has an unterminated quoted value`)
    return undefined
  }
  const body = value.slice(1, -1)
  if (body.includes(quote)) {
    addError(`line ${lineNumber} contains an unsupported embedded quote`)
    return undefined
  }
  return body
}

function parseBundleEnvTextInternal(text) {
  const values = {}
  const explicit = new Set()
  const invalidKeys = new Set()
  const errors = []
  const addError = (message) => errors.push(message)
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) return
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) {
      addError(`line ${lineNumber} must use KEY=value syntax`)
      return
    }
    const [, key, rawValue] = match
    if (!ALLOWED_FIELDS.has(key)) {
      addError(`line ${lineNumber} uses unknown key ${key}`)
      return
    }
    if (explicit.has(key)) {
      addError(`line ${lineNumber} duplicates key ${key}`)
      return
    }
    const value = unquote(rawValue.trim(), lineNumber, addError)
    if (value === undefined) {
      invalidKeys.add(key)
      return
    }
    if (/\$\{|\$\(|`/.test(value)) {
      addError(`line ${lineNumber} contains shell interpolation; values must be literal`)
      invalidKeys.add(key)
      return
    }
    if (/[<>]/.test(value) || /^(change[-_ ]?me|replace[-_ ]?me)(?:\b|[-_])/i.test(value)) {
      addError(`line ${lineNumber} contains an unresolved placeholder for ${key}`)
      invalidKeys.add(key)
      return
    }
    values[key] = value
    explicit.add(key)
  })
  return { values, explicit, invalidKeys, errors }
}

export function parseBundleEnvText(text) {
  const parsed = parseBundleEnvTextInternal(text)
  if (parsed.errors.length) throw createValidationError(parsed.errors)
  return { values: parsed.values, explicit: parsed.explicit }
}

function isValidHostname(value) {
  if (!value || value.length > 253 || value.endsWith('.')) return false
  return value.split('.').every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
}

function validateHost(name, value, addError) {
  if (!value) return
  if (value.includes('://') || value.includes('/') || value.includes(':')) {
    addError(`${name} must be a hostname or IPv4 address without a scheme, path, or port`)
    return
  }
  if (net.isIP(value) !== 4 && !isValidHostname(value)) addError(`${name} must be a valid hostname or IPv4 address`)
}

function validateBindAddress(name, value, addError) {
  if (!value) return
  if (net.isIP(value) !== 4) {
    addError(`${name} must be a concrete IPv4 address assigned to the target VM`)
    return
  }
  if (value === '0.0.0.0' || value.startsWith('127.')) {
    addError(`${name} must not publish a production service on an unspecified or loopback interface`)
  }
}

function resolvePath(repoRoot, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(repoRoot, value)
}

function requireReadableFile(name, value, addError) {
  let stats
  try {
    stats = fs.statSync(value)
  } catch {
    addError(`${name} file does not exist: ${value}`)
    return
  }
  if (!stats.isFile()) {
    addError(`${name} must point to a file: ${value}`)
    return
  }
  try {
    fs.accessSync(value, fs.constants.R_OK)
  } catch {
    addError(`${name} file is not readable: ${value}`)
  }
}

function requirePrivateKeyPermissions(name, value, addError) {
  if (process.platform === 'win32') return
  let mode
  try {
    mode = fs.statSync(value).mode & 0o777
  } catch {
    return
  }
  if ((mode & 0o077) !== 0) addError(`${name} must not be accessible by group/other (current mode ${mode.toString(8)})`)
}

function validateSecret(name, value, minimumLength, addError) {
  if (value.length < minimumLength) addError(`${name} must be at least ${minimumLength} characters`)
  if (/^(postgres|minioadmin|admin|password|secret|localdev@123)$/i.test(value)) addError(`${name} uses a development default`)
  if (!/^[A-Za-z0-9._~-]+$/.test(value)) {
    addError(`${name} may contain only letters, numbers, dot, underscore, tilde, and hyphen`)
  }
}

function validatePositiveInteger(name, value, minimum, maximum, addError) {
  if (!/^\d+$/.test(value)) {
    addError(`${name} must be an integer`)
    return
  }
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < minimum || numeric > maximum) {
    addError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
}

function validateWebpageHostList(name, value, addError) {
  const entries = String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
  for (const entry of entries) {
    const wildcard = entry.startsWith('*.')
    const host = wildcard ? entry.slice(2) : entry
    if (
      entry !== entry.toLowerCase()
      || entry.includes('://')
      || entry.includes('/')
      || entry.includes('@')
      || (wildcard && net.isIP(host) !== 0)
      || (net.isIP(host) === 0 && !isValidHostname(host))
    ) {
      addError(`${name} contains invalid host pattern ${entry}; use lowercase exact hosts or *.example.com wildcards`)
    }
  }
}

function validateWebpageCidrs(value, addError) {
  const entries = String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
  for (const entry of entries) {
    const [address, prefixText, extra] = entry.split('/')
    const version = net.isIP(address)
    const prefix = Number(prefixText)
    const maximum = version === 4 ? 32 : 128
    if (extra !== undefined || version === 0 || !/^\d+$/.test(prefixText ?? '') || prefix < 0 || prefix > maximum) {
      addError(`WEBPAGE_ALLOWED_CIDRS contains invalid CIDR ${entry}`)
    }
  }
}

function validateWebpagePorts(value, addError) {
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  if (entries.length === 0) {
    addError('WEBPAGE_ALLOWED_PORTS must contain at least one port')
    return
  }
  const seen = new Set()
  for (const entry of entries) {
    const port = Number(entry)
    if (!/^\d+$/.test(entry) || !Number.isInteger(port) || port < 1 || port > 65535) {
      addError(`WEBPAGE_ALLOWED_PORTS contains invalid port ${entry}`)
    } else if (seen.has(port)) {
      addError(`WEBPAGE_ALLOWED_PORTS contains duplicate port ${entry}`)
    }
    seen.add(port)
  }
}

function validateCpuLimit(name, value, addError) {
  if (!/^(?:0\.[0-9]+|[1-9][0-9]*(?:\.[0-9]+)?)$/.test(value)) {
    addError(`${name} must be a positive decimal CPU count`)
    return
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0.1 || numeric > 128) {
    addError(`${name} must be from 0.1 to 128 CPUs`)
  }
}

function validateMemoryLimit(name, value, addError) {
  if (!/^[1-9][0-9]*[mMgG]$/.test(value)) {
    addError(`${name} must be a whole-number Docker memory limit ending in m or g`)
  }
}

function validateOffHostHost(name, hostname, addError) {
  if (['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase()) || net.isIP(hostname)) {
    addError(`${name} must not resolve to a local or VM IP address`)
  }
}

function validateOffHostBackupDestination(value, addError) {
  if (/(?:^|\/)\.\.(?:\/|$)|(?:^|\/)\.(?:\/|$)/.test(value)) {
    addError('BACKUP_OFFHOST_DESTINATION prefix must not contain dot path segments')
    return
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    addError('BACKUP_OFFHOST_DESTINATION must be an s3:// bucket/prefix URI without credentials')
    return
  }
  if (parsed.protocol !== 's3:' || !parsed.hostname || parsed.username || parsed.password || !parsed.pathname || parsed.pathname === '/' || parsed.search || parsed.hash) {
    addError('BACKUP_OFFHOST_DESTINATION must be an s3:// bucket/prefix URI without credentials')
    return
  }
  if (parsed.pathname.split('/').some((segment) => segment === '.' || segment === '..')) {
    addError('BACKUP_OFFHOST_DESTINATION prefix must not contain dot path segments')
  }
  validateOffHostHost('BACKUP_OFFHOST_DESTINATION', parsed.hostname, addError)
}

function validateOffHostBackupEndpoint(value, addError) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    addError('BACKUP_OFFHOST_ENDPOINT must be an https:// S3-compatible endpoint without credentials')
    return
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    addError('BACKUP_OFFHOST_ENDPOINT must be an https:// S3-compatible endpoint without credentials')
    return
  }
  validateOffHostHost('BACKUP_OFFHOST_ENDPOINT', parsed.hostname, addError)
}

function validateBackupCredential(name, value, minimumLength, addError) {
  if (value.length < minimumLength || value.length > 1024 || /[\r\n\0]/.test(value)) {
    addError(`${name} must be ${minimumLength}-1024 characters and contain no control characters`)
  }
}

function readJsonFile(name, value, addError) {
  try {
    return JSON.parse(fs.readFileSync(value, 'utf8'))
  } catch (error) {
    addError(`${name} must be readable JSON: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function validateSha256Field(name, value, addError) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    addError(`${name} must be a SHA-256 hex digest`)
  }
}

function validateCapacityEvidence(config, addError) {
  if (!config.CAPACITY_EVIDENCE_FILE) return
  let stats
  try {
    stats = fs.statSync(config.CAPACITY_EVIDENCE_FILE)
  } catch {
    return
  }
  if (!stats.isFile()) return

  const evidence = readJsonFile('CAPACITY_EVIDENCE_FILE', config.CAPACITY_EVIDENCE_FILE, addError)
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    addError('CAPACITY_EVIDENCE_FILE must contain a JSON object')
    return
  }

  if (evidence.evidence_type !== 'darshan.production.capacity-certification.v1') {
    addError('CAPACITY_EVIDENCE_FILE evidence_type must be darshan.production.capacity-certification.v1')
  }
  if (evidence.site_name !== config.SITE_NAME) {
    addError('CAPACITY_EVIDENCE_FILE site_name must match SITE_NAME')
  }
  if (evidence.release_id !== config.RELEASE_ID) {
    addError('CAPACITY_EVIDENCE_FILE release_id must match RELEASE_ID')
  }
  if (evidence.status !== 'approved') {
    addError('CAPACITY_EVIDENCE_FILE status must be approved')
  }
  if (evidence.model_only === true) {
    addError('CAPACITY_EVIDENCE_FILE must reference measured runtime evidence, not model-only sizing')
  }
  if (typeof evidence.profile_name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/.test(evidence.profile_name)) {
    addError('CAPACITY_EVIDENCE_FILE profile_name must be 1-80 safe characters')
  }
  if (!Number.isSafeInteger(evidence.max_players) || evidence.max_players < 1) {
    addError('CAPACITY_EVIDENCE_FILE max_players must be a positive integer')
  }
  if (evidence.resource_policy_reviewed !== true) {
    addError('CAPACITY_EVIDENCE_FILE resource_policy_reviewed must be true')
  }
  const validUntil = new Date(evidence.valid_until)
  if (typeof evidence.valid_until !== 'string' || Number.isNaN(validUntil.getTime())) {
    addError('CAPACITY_EVIDENCE_FILE valid_until must be an ISO-8601 timestamp')
  } else if (validUntil.getTime() <= Date.now()) {
    addError('CAPACITY_EVIDENCE_FILE valid_until must be in the future')
  }

  if (!Array.isArray(evidence.runtime_evidence) || evidence.runtime_evidence.length === 0) {
    addError('CAPACITY_EVIDENCE_FILE runtime_evidence must contain at least one measured artifact')
  } else {
    evidence.runtime_evidence.forEach((artifact, index) => {
      const prefix = `CAPACITY_EVIDENCE_FILE runtime_evidence[${index}]`
      if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
        addError(`${prefix} must be an object`)
        return
      }
      if (typeof artifact.kind !== 'string' || !/^(load-test|hardware-certification|qa-runtime|soak-test)$/.test(artifact.kind)) {
        addError(`${prefix}.kind must be load-test, hardware-certification, qa-runtime, or soak-test`)
      }
      validateSha256Field(`${prefix}.artifact_sha256`, artifact.artifact_sha256, addError)
    })
  }

  if (typeof evidence.approved_by !== 'string' || evidence.approved_by.trim().length < 3) {
    addError('CAPACITY_EVIDENCE_FILE approved_by must name the approver or approval authority')
  }

  const evidenceText = fs.readFileSync(config.CAPACITY_EVIDENCE_FILE)
  config.CAPACITY_EVIDENCE_SHA256 = crypto.createHash('sha256').update(evidenceText).digest('hex')
  config.CAPACITY_EVIDENCE_PROFILE_NAME = evidence.profile_name
  config.CAPACITY_EVIDENCE_MAX_PLAYERS = String(evidence.max_players)
  config.CAPACITY_EVIDENCE_VALID_UNTIL = evidence.valid_until
}

export function loadProductionBundleConfig(envFile, repoRoot = process.cwd()) {
  const absoluteEnvFile = path.resolve(envFile)
  let text
  try { text = fs.readFileSync(absoluteEnvFile, 'utf8') } catch { fail(`file not found: ${absoluteEnvFile}`) }
  const parsed = parseBundleEnvTextInternal(text)
  const errors = [...parsed.errors]
  const addError = (message) => errors.push(message)
  const config = { ...DEFAULTS, ...parsed.values }
  if (config.PKI_ROOT_DIR && !config.SITE_PKI_DIR && config.SITE_NAME) {
    config.SITE_PKI_DIR = path.join(config.PKI_ROOT_DIR, config.SITE_NAME)
  }
  if (config.SITE_PKI_DIR) {
    config.TRANSPORT_CA_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'transport-ca.crt')
    config.TRANSPORT_CA_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'transport-ca.key')
    config.DEVICE_CA_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'device-ca.crt')
    config.DEVICE_CA_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'device-ca.key')
    if (config.TRANSPORT_TLS_MODE === 'provided') {
      config.CMS_TLS_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'cms.crt')
      config.CMS_TLS_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'cms.key')
      config.BACKEND_TLS_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'backend.crt')
      config.BACKEND_TLS_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'backend.key')
      config.MINIO_TLS_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'minio.crt')
      config.MINIO_TLS_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'minio.key')
      config.POSTGRES_TLS_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'postgres.crt')
      config.POSTGRES_TLS_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'postgres.key')
      config.VALKEY_TLS_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'valkey.crt')
      config.VALKEY_TLS_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'valkey.key')
    }
  }
  if (config.RELEASE_ID && config.PACKAGE_OUTPUT_BASE) {
    config.SERVER_PACKAGE_DIR ||= path.join(config.PACKAGE_OUTPUT_BASE, config.RELEASE_ID, 'server')
    config.CMS_PACKAGE_DIR ||= path.join(config.PACKAGE_OUTPUT_BASE, config.RELEASE_ID, 'cms')
    config.PLAYER_ARTIFACTS_DIR ||= path.join(config.PACKAGE_OUTPUT_BASE, config.RELEASE_ID, 'electron')
  }
  config.BACKEND_DEVICE_HOST ||= config.BACKEND_PRIVATE_HOST
  config.VALKEY_PRIVATE_HOST ||= config.BACKEND_PRIVATE_HOST
  config.CMS_BIND_ADDRESS ||= config.CMS_PUBLIC_HOST
  config.BACKEND_BIND_ADDRESS ||= config.BACKEND_PRIVATE_HOST
  config.DATA_BIND_ADDRESS ||= config.DATA_PRIVATE_HOST
  config.VALKEY_BIND_ADDRESS ||= config.VALKEY_PRIVATE_HOST
  config.OBSERVABILITY_BIND_ADDRESS ||= config.OBSERVABILITY_PRIVATE_HOST
  for (const name of REQUIRED_FIELDS) {
    if (!config[name] && !parsed.invalidKeys.has(name)) addError(`${name} is required`)
  }
  if (config.RELEASE_ID && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.RELEASE_ID)) {
    addError('RELEASE_ID has invalid characters')
  }
  if (config.SITE_NAME && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.SITE_NAME)) {
    addError('SITE_NAME must be a lowercase DNS-style label')
  }
  if (config.PLAYER_TARGET_PLATFORMS && !/^(?:linux|windows|linux,windows|windows,linux)$/.test(config.PLAYER_TARGET_PLATFORMS)) {
    addError('PLAYER_TARGET_PLATFORMS must be linux, windows, or windows,linux')
  }
  if (config.POSTGRES_USER && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.POSTGRES_USER)) {
    addError('POSTGRES_USER must be a PostgreSQL identifier')
  }
  if (config.POSTGRES_MONITORING_USER && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.POSTGRES_MONITORING_USER)) {
    addError('POSTGRES_MONITORING_USER must be a PostgreSQL identifier')
  }
  if (config.POSTGRES_DB && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.POSTGRES_DB)) {
    addError('POSTGRES_DB must be a PostgreSQL identifier')
  }
  for (const name of BOOLEAN_FIELDS) {
    if (!['true', 'false'].includes(config[name])) addError(`${name} must be true or false`)
  }
  if (config.INSTALL_PLAYWRIGHT_CHROMIUM === 'false') {
    addError('INSTALL_PLAYWRIGHT_CHROMIUM must be true because production exposes PDF export endpoints')
  }
  for (const name of PORT_FIELDS) {
    const port = Number(config[name])
    if (!Number.isInteger(port) || port < 1 || port > 65535) addError(`${name} must be an integer from 1 to 65535`)
  }
  for (const name of HOST_FIELDS) validateHost(name, config[name], addError)
  for (const name of BIND_ADDRESS_FIELDS) validateBindAddress(name, config[name], addError)
  if (config.TRANSPORT_TLS_MODE && !['internal-ca', 'provided'].includes(config.TRANSPORT_TLS_MODE)) {
    addError('TRANSPORT_TLS_MODE must be internal-ca or provided')
  }
  if (!['windows', 'macos', 'linux', 'all-supported'].includes(config.ELECTRON_PLATFORM)) addError('ELECTRON_PLATFORM is invalid')
  if (!['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(config.LOG_LEVEL)) addError('LOG_LEVEL is invalid')
  if (!/^\d+$/.test(config.JWT_EXPIRY) || Number(config.JWT_EXPIRY) < 60) addError('JWT_EXPIRY must be at least 60 seconds')
  if (!/^\d+$/.test(config.MAX_UPLOAD_MB) || Number(config.MAX_UPLOAD_MB) !== 500) {
    addError('MAX_UPLOAD_MB must be exactly 500 so the application policy remains below the 512m proxy envelope')
  }
  validateWebpageHostList('WEBPAGE_NAVIGATION_ALLOWLIST', config.WEBPAGE_NAVIGATION_ALLOWLIST, addError)
  validateWebpageHostList('WEBPAGE_RESOURCE_ALLOWLIST', config.WEBPAGE_RESOURCE_ALLOWLIST, addError)
  validateWebpageCidrs(config.WEBPAGE_ALLOWED_CIDRS, addError)
  validateWebpagePorts(config.WEBPAGE_ALLOWED_PORTS, addError)
  if (config.WEBPAGE_ALLOW_HTTP === 'true') {
    addError('WEBPAGE_ALLOW_HTTP must be false for production bundles')
  }
  if (config.INITIAL_ADMIN_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.INITIAL_ADMIN_EMAIL)) addError('INITIAL_ADMIN_EMAIL must be valid')
  if (!['dual', 'signature'].includes(config.DEVICE_AUTH_MODE)) {
    addError('DEVICE_AUTH_MODE must be dual or signature for production')
  }
  if (config.DEVICE_AUTH_MODE === 'dual') {
    const expiresAt = new Date(config.DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT)
    if (!config.DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT || Number.isNaN(expiresAt.getTime())) {
      addError('DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT is required as an ISO-8601 timestamp when DEVICE_AUTH_MODE=dual')
    } else if (expiresAt.getTime() <= Date.now()) {
      addError('DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT must be in the future when DEVICE_AUTH_MODE=dual')
    }
  }
  if (config.POSTGRES_PASSWORD) validateSecret('POSTGRES_PASSWORD', config.POSTGRES_PASSWORD, 12, addError)
  if (config.POSTGRES_MONITORING_PASSWORD) validateSecret('POSTGRES_MONITORING_PASSWORD', config.POSTGRES_MONITORING_PASSWORD, 24, addError)
  if (config.MINIO_ACCESS_KEY) validateSecret('MINIO_ACCESS_KEY', config.MINIO_ACCESS_KEY, 8, addError)
  if (config.MINIO_SECRET_KEY) validateSecret('MINIO_SECRET_KEY', config.MINIO_SECRET_KEY, 16, addError)
  if (config.JWT_SECRET) validateSecret('JWT_SECRET', config.JWT_SECRET, 32, addError)
  if (config.VALKEY_PASSWORD) validateSecret('VALKEY_PASSWORD', config.VALKEY_PASSWORD, 24, addError)
  if (config.OBSERVABILITY_METRICS_BEARER_TOKEN) validateSecret('OBSERVABILITY_METRICS_BEARER_TOKEN', config.OBSERVABILITY_METRICS_BEARER_TOKEN, 32, addError)
  if (config.GRAFANA_ADMIN_USER && !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(config.GRAFANA_ADMIN_USER)) {
    addError('GRAFANA_ADMIN_USER must be 3-64 letters, numbers, dot, underscore, or hyphen')
  }
  if (config.GRAFANA_ADMIN_PASSWORD) validateSecret('GRAFANA_ADMIN_PASSWORD', config.GRAFANA_ADMIN_PASSWORD, 24, addError)
  if (config.BACKUP_OFFHOST_ACCESS_KEY) validateBackupCredential('BACKUP_OFFHOST_ACCESS_KEY', config.BACKUP_OFFHOST_ACCESS_KEY, 8, addError)
  if (config.BACKUP_OFFHOST_SECRET_KEY) validateBackupCredential('BACKUP_OFFHOST_SECRET_KEY', config.BACKUP_OFFHOST_SECRET_KEY, 16, addError)
  if (config.BACKUP_INTERVAL_HOURS) validatePositiveInteger('BACKUP_INTERVAL_HOURS', config.BACKUP_INTERVAL_HOURS, 1, 168, addError)
  if (config.BACKUP_RETENTION_DAYS) validatePositiveInteger('BACKUP_RETENTION_DAYS', config.BACKUP_RETENTION_DAYS, 1, 3650, addError)
  if (config.BACKUP_OFFHOST_DESTINATION) validateOffHostBackupDestination(config.BACKUP_OFFHOST_DESTINATION, addError)
  if (config.BACKUP_OFFHOST_ENDPOINT) validateOffHostBackupEndpoint(config.BACKUP_OFFHOST_ENDPOINT, addError)
  if (config.CONTAINER_LOG_MAX_SIZE) validateMemoryLimit('CONTAINER_LOG_MAX_SIZE', config.CONTAINER_LOG_MAX_SIZE, addError)
  if (config.CONTAINER_LOG_MAX_FILES) validatePositiveInteger('CONTAINER_LOG_MAX_FILES', config.CONTAINER_LOG_MAX_FILES, 2, 100, addError)
  for (const name of DISK_FREE_FIELDS) {
    if (config[name]) validatePositiveInteger(name, config[name], 1_073_741_824, 9_007_199_254_740_991, addError)
  }
  for (const component of RESOURCE_COMPONENTS) {
    if (config[`${component}_CPU_LIMIT`]) validateCpuLimit(`${component}_CPU_LIMIT`, config[`${component}_CPU_LIMIT`], addError)
    if (config[`${component}_MEMORY_LIMIT`]) validateMemoryLimit(`${component}_MEMORY_LIMIT`, config[`${component}_MEMORY_LIMIT`], addError)
    if (config[`${component}_PIDS_LIMIT`]) validatePositiveInteger(`${component}_PIDS_LIMIT`, config[`${component}_PIDS_LIMIT`], 16, 32768, addError)
  }
  for (const name of PATH_FIELDS) if (config[name]) config[name] = resolvePath(repoRoot, config[name])
  const requiredFiles = ['TRANSPORT_CA_CERT_FILE', 'DEVICE_CA_CERT_FILE', 'DEVICE_CA_KEY_FILE', 'RELEASE_SIGNING_PRIVATE_KEY']
  const privateKeys = ['DEVICE_CA_KEY_FILE', 'RELEASE_SIGNING_PRIVATE_KEY']
  if (config.TRANSPORT_TLS_MODE === 'internal-ca') {
    requiredFiles.push('TRANSPORT_CA_KEY_FILE')
    privateKeys.push('TRANSPORT_CA_KEY_FILE')
  } else if (config.TRANSPORT_TLS_MODE === 'provided') {
    requiredFiles.push(
      'CMS_TLS_CERT_FILE', 'CMS_TLS_KEY_FILE', 'BACKEND_TLS_CERT_FILE', 'BACKEND_TLS_KEY_FILE',
      'MINIO_TLS_CERT_FILE', 'MINIO_TLS_KEY_FILE', 'POSTGRES_TLS_CERT_FILE', 'POSTGRES_TLS_KEY_FILE',
      'VALKEY_TLS_CERT_FILE', 'VALKEY_TLS_KEY_FILE'
    )
    privateKeys.push('CMS_TLS_KEY_FILE', 'BACKEND_TLS_KEY_FILE', 'MINIO_TLS_KEY_FILE', 'POSTGRES_TLS_KEY_FILE', 'VALKEY_TLS_KEY_FILE')
  }
  for (const name of requiredFiles) {
    if (!config[name]) {
      if (!parsed.invalidKeys.has(name)) addError(`${name} is required for TRANSPORT_TLS_MODE=${config.TRANSPORT_TLS_MODE}`)
      continue
    }
    requireReadableFile(name, config[name], addError)
  }
  for (const name of privateKeys) {
    if (config[name]) requirePrivateKeyPermissions(name, config[name], addError)
  }
  if (config.CAPACITY_EVIDENCE_FILE) {
    requireReadableFile('CAPACITY_EVIDENCE_FILE', config.CAPACITY_EVIDENCE_FILE, addError)
  }
  validateCapacityEvidence(config, addError)
  if (errors.length) throw createValidationError(errors)
  return { config, explicit: parsed.explicit, envFile: absoluteEnvFile, sourceText: text, secretFields: SECRET_FIELDS, outputs: OUTPUTS }
}

export function toAssemblerEnvironment(config) {
  return {
    ...config,
    CMS_PUBLIC_SCHEME: 'https', MINIO_USE_SSL: 'true',
    ONPREM_CERT_MODE: config.TRANSPORT_TLS_MODE === 'internal-ca' ? 'generate' : 'provided',
    OUTPUT_BASE: config.BUNDLE_OUTPUT_BASE,
    CA_CERT_PATH: '/app/certs/device-ca.crt', CA_KEY_PATH: '/app/certs/device-ca.key',
    TLS_CERT_PATH: '/app/certs/server.crt', TLS_KEY_PATH: '/app/certs/server.key', SERVER_TLS_ENABLED: 'true',
    AUTH_COOKIE_SECURE: 'true', SIGNHEX_DEPLOYMENT_ID: config.SITE_NAME,
    SIGNHEX_ENVIRONMENT_NAME: 'production', SIGNHEX_SERVER_ID: `backend-${config.SITE_NAME}`,
  }
}
