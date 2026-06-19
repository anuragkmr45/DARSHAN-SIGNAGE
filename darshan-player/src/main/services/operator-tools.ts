import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getConfigManager } from '../../common/config'
import { redactUrlForDiagnostics, sanitizeLogPayloadForDiagnostics } from '../../common/redaction'
import type { AppConfig } from '../../common/types'
import { ensureDir, findExecutable, formatBytes, generateId, getDirectorySize } from '../../common/utils'
import { getLogger } from '../../common/logger'
import { getElectronApp } from '../../common/platform-paths'
import { getCertificateManager, type CertificateMetadata } from './cert-manager'
import { getPairingService } from './pairing-service'
import { getPowerManager } from './power-manager'
import { getAutostartStatus } from './autostart'
import { getDeviceStateStore } from './device-state-store'
import { getSnapshotManager } from './snapshot-manager'
import { getDefaultMediaService } from './settings/default-media-service'
import { getPlaybackProgressPath, getPlaybackProgressStore } from './playback-progress-store'
import type { NetworkDiagnostics } from './pairing-service'

const logger = getLogger('operator-tools')
const DEFAULT_PAIRING_VALIDATION_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

export interface ResetPairingCliOptions {
  reason?: string
  dryRun?: boolean
  clearCache?: boolean
}

type ResetTargetType = 'file' | 'directory' | 'config-field' | 'state-field'

interface ResetTarget {
  type: ResetTargetType
  path?: string
  name?: string
  exists?: boolean
  action: string
}

function getAppMetadata() {
  const electronApp = getElectronApp()
  return {
    version: typeof electronApp?.getVersion === 'function' ? electronApp.getVersion() : process.env['npm_package_version'] || 'unknown',
    packaged: Boolean(electronApp?.isPackaged),
    execPath: process.execPath,
  }
}

function redactConfigForSupport(config: AppConfig) {
  return {
    ...config,
    apiBase: '[REDACTED]',
    wsUrl: '[REDACTED]',
    deviceId: config.deviceId ? '[REDACTED]' : '',
    mtls: {
      ...config.mtls,
      certPath: '[REDACTED]',
      keyPath: '[REDACTED]',
      caPath: '[REDACTED]',
    },
  }
}

function getOfflineValidationGraceMs(config: AppConfig): number {
  return config.pairing?.offlineValidationGraceMs ?? DEFAULT_PAIRING_VALIDATION_OFFLINE_GRACE_MS
}

function redactIdentifier(value?: string | null, suffixLength = 8): string | null {
  if (!value) {
    return null
  }

  const suffix = value.slice(-suffixLength)
  return suffix ? `...${suffix}` : '[REDACTED]'
}

function redactCertificateMetadata(metadata: CertificateMetadata | null) {
  if (!metadata) {
    return null
  }

  return {
    validFrom: metadata.validFrom,
    validTo: metadata.validTo,
    subject: metadata.subject ? '[REDACTED]' : '',
    issuer: metadata.issuer ? '[REDACTED]' : '',
    serialSuffix: redactIdentifier(metadata.serialNumber, 6),
    fingerprintSuffix: redactIdentifier(metadata.fingerprint, 12),
    verificationMode: metadata.verificationMode,
  }
}

function redactNetworkDiagnostics(diagnostics: NetworkDiagnostics): NetworkDiagnostics {
  return {
    ...diagnostics,
    apiBase: redactUrlForDiagnostics(diagnostics.apiBase),
  }
}

function pathExists(targetPath: string) {
  try {
    fs.accessSync(targetPath)
    return true
  } catch {
    return false
  }
}

function writeJsonFile(targetPath: string, payload: unknown) {
  ensureDir(path.dirname(targetPath))
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf-8')
}

function sanitizeTextForSupport(content: string): string {
  const sanitized = sanitizeLogPayloadForDiagnostics(content)
  return typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized)
}

function copySanitizedLogDirectory(sourceDir: string, targetDir: string) {
  ensureDir(targetDir)

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)

    if (entry.isDirectory()) {
      copySanitizedLogDirectory(sourcePath, targetPath)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    if (entry.name.endsWith('.gz')) {
      fs.writeFileSync(
        `${targetPath}.omitted.txt`,
        'Compressed historical log omitted from support bundle because it cannot be redacted safely in CONFIG-2.3.\n',
        'utf-8'
      )
      continue
    }

    const content = fs.readFileSync(sourcePath, 'utf-8')
    fs.writeFileSync(targetPath, sanitizeTextForSupport(content), 'utf-8')
  }
}

function getDeviceStatePath(configPath: string) {
  return path.join(path.dirname(configPath), 'device-state.json')
}

function getIdentityBoundPaths() {
  const configManager = getConfigManager()
  const config = configManager.getConfig()
  const runtimePaths = configManager.getRuntimePaths()
  const certDir = path.dirname(config.mtls.keyPath)

  return {
    runtimePaths,
    config,
    configPath: configManager.getConfigPath(),
    deviceStatePath: getDeviceStatePath(configManager.getConfigPath()),
    certificateFiles: [
      config.mtls.certPath,
      config.mtls.keyPath,
      config.mtls.caPath,
      path.join(certDir, 'client.csr'),
      path.join(certDir, 'cert-meta.json'),
    ],
    snapshotMetadataPath: path.join(config.cache.path, 'last-snapshot.json'),
    defaultMediaMetadataPath: path.join(config.cache.path, 'default-media.json'),
    playbackProgressPath: getPlaybackProgressPath(config.cache.path),
    cacheTargets: [
      path.join(config.cache.path, 'media'),
      path.join(config.cache.path, 'objects'),
      path.join(config.cache.path, 'quarantine'),
      path.join(config.cache.path, 'cache-index.db'),
    ],
    preservedTargets: [
      path.join(config.cache.path, 'logs'),
      path.join(config.cache.path, 'pop-spool'),
      path.join(config.cache.path, 'request-queue.json'),
      path.join(config.cache.path, 'request-queue.state.json'),
      path.join(config.cache.path, 'screenshots'),
    ],
  }
}

function buildResetPlan(options: ResetPairingCliOptions) {
  const paths = getIdentityBoundPaths()
  const certificateTargets = paths.certificateFiles.map((file) => ({
    type: 'file' as const,
    path: file,
    exists: pathExists(file),
    action: 'delete identity certificate artifact',
  }))
  const cacheTargets = options.clearCache
    ? paths.cacheTargets.map((targetPath) => ({
        type:
          fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
            ? ('directory' as const)
            : ('file' as const),
        path: targetPath,
        exists: pathExists(targetPath),
        action: 'delete media cache target',
      }))
    : []

  return {
    dryRun: options.dryRun === true,
    clearCache: options.clearCache === true,
    reason: options.reason || 'Operator reset pairing',
    paths: {
      runtimeRoot: paths.runtimePaths.runtimeRoot,
      configPath: paths.configPath,
      cachePath: paths.config.cache.path,
      certDir: paths.runtimePaths.certDir,
      deviceStatePath: paths.deviceStatePath,
      legacyLinux: paths.runtimePaths.legacyLinux,
    },
    targets: [
      {
        type: 'config-field' as const,
        name: 'config.deviceId',
        exists: Boolean(paths.config.deviceId),
        action: 'clear configured device id',
      },
      {
        type: 'config-field' as const,
        name: 'config.mtls.enabled',
        exists: paths.config.mtls.enabled === true,
        action: 'disable mTLS until next pairing',
      },
      {
        type: 'state-field' as const,
        name: 'device-state identity and validation metadata',
        exists: pathExists(paths.deviceStatePath),
        action: 'clear local pairing state',
      },
      ...certificateTargets,
      {
        type: 'file' as const,
        path: paths.snapshotMetadataPath,
        exists: pathExists(paths.snapshotMetadataPath),
        action: 'delete cached snapshot metadata',
      },
      {
        type: 'file' as const,
        path: paths.defaultMediaMetadataPath,
        exists: pathExists(paths.defaultMediaMetadataPath),
        action: 'delete cached default-media metadata',
      },
      {
        type: 'file' as const,
        path: paths.playbackProgressPath,
        exists: pathExists(paths.playbackProgressPath),
        action: 'delete cached playback resume metadata',
      },
      ...cacheTargets,
    ] satisfies ResetTarget[],
    preserved: paths.preservedTargets.map((targetPath) => ({
      path: targetPath,
      exists: pathExists(targetPath),
      reason:
        targetPath.endsWith('request-queue.json') || targetPath.endsWith('request-queue.state.json')
          ? 'preserve pending offline requests/proof events'
          : 'not identity-bound; preserved by reset-pairing',
    })),
  }
}

function clearMediaCacheTargets(cacheRoot: string) {
  const targets = ['media', 'objects', 'quarantine']
  const removed: string[] = []

  for (const name of targets) {
    const targetPath = path.join(cacheRoot, name)
    if (!pathExists(targetPath)) {
      continue
    }

    fs.rmSync(targetPath, { recursive: true, force: true })
    ensureDir(targetPath)
    removed.push(targetPath)
  }

  const legacyIndex = path.join(cacheRoot, 'cache-index.db')
  if (pathExists(legacyIndex)) {
    fs.rmSync(legacyIndex, { force: true })
    removed.push(legacyIndex)
  }

  return removed
}

async function getCacheStats(cachePath: string) {
  const mediaPath = path.join(cachePath, 'media')
  const logsPath = path.join(cachePath, 'logs')
  const popPath = path.join(cachePath, 'pop-spool')
  const screenshotPath = path.join(cachePath, 'screenshots')

  return {
    root: cachePath,
    rootExists: pathExists(cachePath),
    media: {
      path: mediaPath,
      exists: pathExists(mediaPath),
      bytes: await getDirectorySize(mediaPath),
    },
    logs: {
      path: logsPath,
      exists: pathExists(logsPath),
      bytes: await getDirectorySize(logsPath),
    },
    proofOfPlay: {
      path: popPath,
      exists: pathExists(popPath),
      bytes: await getDirectorySize(popPath),
    },
    screenshots: {
      path: screenshotPath,
      exists: pathExists(screenshotPath),
      bytes: await getDirectorySize(screenshotPath),
    },
  }
}

export async function runDoctor() {
  const configManager = getConfigManager()
  const config = configManager.getConfig()
  const runtimePaths = configManager.getRuntimePaths()
  const pairingService = getPairingService()
  const certManager = getCertificateManager()
  const powerManager = getPowerManager()
  const diagnostics = redactNetworkDiagnostics(await pairingService.runDiagnostics())
  const displays = await powerManager.getDisplayInfo()
  const cacheStats = await getCacheStats(config.cache.path)
  const certificateMetadata = certManager.getCertificateMetadata()
  const certificatePaths = certManager.getCertificatePaths()
  const appMetadata = getAppMetadata()

  const report = {
    timestamp: new Date().toISOString(),
    app: {
      ...appMetadata,
      runtimeMode: config.runtime.mode,
    },
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
    },
    paths: {
      configPath: configManager.getConfigPath(),
      runtimeRoot: runtimePaths.runtimeRoot,
      cachePath: config.cache.path,
      certDir: runtimePaths.certDir,
      configExists: pathExists(configManager.getConfigPath()),
      cacheExists: pathExists(config.cache.path),
      certPaths: certificatePaths,
    },
    config: configManager.getRedactedRuntimeConfigSummary(),
    pairing: {
      deviceIdPresent: Boolean(pairingService.getDeviceId()),
      deviceIdSuffix: redactIdentifier(pairingService.getDeviceId()),
      installInstanceSuffix: redactIdentifier(getDeviceStateStore().getState().installInstanceId),
      runtimeSessionSuffix: redactIdentifier(pairingService.getRuntimeSessionId()),
      paired: pairingService.isPairedDevice(),
      identityHealth: pairingService.getStoredIdentityHealth(),
      certificateMetadata: redactCertificateMetadata(certificateMetadata),
    },
    network: diagnostics,
    autostart: getAutostartStatus(),
    display: {
      capabilities: powerManager.getCapabilities(),
      displays,
    },
    dependencies: {
      xset: findExecutable('xset'),
      xrandr: findExecutable('xrandr'),
    },
    cache: {
      ...cacheStats,
      humanReadable: {
        media: formatBytes(cacheStats.media.bytes),
        logs: formatBytes(cacheStats.logs.bytes),
        proofOfPlay: formatBytes(cacheStats.proofOfPlay.bytes),
        screenshots: formatBytes(cacheStats.screenshots.bytes),
      },
    },
  }

  console.log(JSON.stringify(report, null, 2))
  return 0
}

export async function clearCache() {
  const cacheRoot = getConfigManager().getConfig().cache.path
  const removed = clearMediaCacheTargets(cacheRoot)

  logger.info({ removed }, 'Cleared media cache')
  console.log(JSON.stringify({ success: true, cacheRoot, removed }, null, 2))
  return 0
}

export async function pairingStatusForCli(): Promise<number> {
  const configManager = getConfigManager()
  const config = configManager.getConfig()
  const pairingService = getPairingService()
  const certManager = getCertificateManager()
  const certificatePaths = certManager.getCertificatePaths()
  const certificateMetadata = certManager.getCertificateMetadata()
  const state = getPairingService().getStoredIdentityHealth()
  const deviceState = getDeviceStateStore().getState()
  const lastValidatedAt = deviceState.lastPairingValidatedAt ? Date.parse(deviceState.lastPairingValidatedAt) : NaN
  const offlineGraceExpiresAt = Number.isFinite(lastValidatedAt)
    ? new Date(lastValidatedAt + getOfflineValidationGraceMs(config)).toISOString()
    : null
  const identityPaths = getIdentityBoundPaths()

  console.log(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        pairedLocal: pairingService.isPairedDevice(),
        deviceIdPresent: Boolean(pairingService.getDeviceId()),
        deviceIdSuffix: redactIdentifier(pairingService.getDeviceId()),
        identityHealth: state,
        validation: {
          lastStatus: deviceState.lastPairingValidationStatus || null,
          lastValidatedAt: deviceState.lastPairingValidatedAt || null,
          lastValidatedDeviceIdMatchesCurrent:
            Boolean(deviceState.lastValidatedDeviceId) &&
            deviceState.lastValidatedDeviceId === pairingService.getDeviceId(),
          offlineGraceExpiresAt,
          serverIdentity: deviceState.lastValidatedServerIdentity || null,
          offlineGraceMs: getOfflineValidationGraceMs(config),
        },
        config: configManager.getRedactedRuntimeConfigSummary(),
        duplicateIdentity: deviceState.duplicateIdentity
          ? {
              ...deviceState.duplicateIdentity,
              sessions: deviceState.duplicateIdentity.sessions.map((session) => ({
                ...session,
                installInstanceSuffix: session.installInstanceSuffix,
                runtimeSessionSuffix: session.runtimeSessionSuffix,
              })),
            }
          : null,
        session: {
          installInstancePresent: Boolean(deviceState.installInstanceId),
          installInstanceSuffix: redactIdentifier(deviceState.installInstanceId),
          runtimeSessionSuffix: redactIdentifier(pairingService.getRuntimeSessionId()),
        },
        paths: {
          runtimeRoot: identityPaths.runtimePaths.runtimeRoot,
          configPath: configManager.getConfigPath(),
          cachePath: config.cache.path,
          certDir: identityPaths.runtimePaths.certDir,
          deviceStatePath: identityPaths.deviceStatePath,
        },
        certificates: {
          present: certManager.areCertificatesPresent(),
          privateKeyPresent: certManager.hasPrivateKey(),
          paths: {
            cert: certificatePaths.cert,
            key: certificatePaths.key,
            ca: certificatePaths.ca,
          },
          metadata: redactCertificateMetadata(certificateMetadata),
        },
        cache: {
          snapshotMetadataPath: identityPaths.snapshotMetadataPath,
          defaultMediaMetadataPath: identityPaths.defaultMediaMetadataPath,
          playbackProgressPath: identityPaths.playbackProgressPath,
          mediaPath: path.join(config.cache.path, 'media'),
          requestQueuePath: path.join(config.cache.path, 'request-queue.json'),
          requestQueueStatePath: path.join(config.cache.path, 'request-queue.state.json'),
          proofOfPlayPath: path.join(config.cache.path, 'pop-spool'),
        },
      },
      null,
      2
    )
  )
  return 0
}

export async function resetPairingForCli(options: ResetPairingCliOptions | string = {}): Promise<number> {
  const normalizedOptions =
    typeof options === 'string'
      ? { reason: options }
      : {
          ...options,
        }
  const reason = normalizedOptions.reason || 'Operator reset pairing'
  const plan = buildResetPlan({ ...normalizedOptions, reason })

  if (normalizedOptions.dryRun) {
    console.log(JSON.stringify({ success: true, dryRun: true, plan }, null, 2))
    return 0
  }

  getSnapshotManager().clearIdentityBoundState()
  getDefaultMediaService().clearIdentityBoundState()
  getPlaybackProgressStore().clear()
  await getPairingService().resetStoredIdentity(reason)
  const cacheRemoved = normalizedOptions.clearCache
    ? clearMediaCacheTargets(getConfigManager().getConfig().cache.path)
    : []

  console.log(
    JSON.stringify(
      {
        success: true,
        reason,
        clearCache: normalizedOptions.clearCache === true,
        cacheRemoved,
        preserved: plan.preserved,
      },
      null,
      2
    )
  )
  return 0
}

export async function collectLogs() {
  const configManager = getConfigManager()
  const config = configManager.getConfig()
  const bundleDir = path.join(os.tmpdir(), `darshan-support-${Date.now()}-${generateId(6)}`)
  const cacheRoot = config.cache.path
  const logDir = path.join(cacheRoot, 'logs')
  const screenshotDir = path.join(cacheRoot, 'screenshots')
  const popDir = path.join(cacheRoot, 'pop-spool')
  const diagnostics = redactNetworkDiagnostics(await getPairingService().runDiagnostics())
  const displays = await getPowerManager().getDisplayInfo()
  const cacheStats = await getCacheStats(cacheRoot)

  ensureDir(bundleDir)

  if (pathExists(logDir)) {
    copySanitizedLogDirectory(logDir, path.join(bundleDir, 'logs'))
  }

  if (pathExists(screenshotDir)) {
    fs.cpSync(screenshotDir, path.join(bundleDir, 'screenshots'), { recursive: true })
  }

  if (pathExists(popDir)) {
    fs.cpSync(popDir, path.join(bundleDir, 'proof-of-play-spool'), { recursive: true })
  }

  writeJsonFile(path.join(bundleDir, 'config.redacted.json'), redactConfigForSupport(config))
  writeJsonFile(path.join(bundleDir, 'diagnostics.json'), diagnostics)
  writeJsonFile(path.join(bundleDir, 'displays.json'), displays)
  writeJsonFile(path.join(bundleDir, 'autostart.json'), getAutostartStatus())
  writeJsonFile(path.join(bundleDir, 'cache-stats.json'), cacheStats)
  writeJsonFile(path.join(bundleDir, 'certificate-metadata.redacted.json'), redactCertificateMetadata(getCertificateManager().getCertificateMetadata()))
  writeJsonFile(path.join(bundleDir, 'system-info.json'), {
    timestamp: new Date().toISOString(),
    appVersion: getAppMetadata().version,
    execPath: getAppMetadata().execPath,
    packaged: getAppMetadata().packaged,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    runtimePaths: configManager.getRuntimePaths(),
  })

  console.log(JSON.stringify({ success: true, bundleDir }, null, 2))
  return 0
}

export async function requestPairingCodeForCli() {
  const response = await getPairingService().requestPairingCode()
  console.log(JSON.stringify(response, null, 2))
  return 0
}

export async function submitPairingCodeForCli(pairingCode: string) {
  const response = await getPairingService().submitPairing(pairingCode)
  console.log(
    JSON.stringify(
      {
        success: true,
        device_id: response.device_id,
        fingerprint: response.fingerprint,
      },
      null,
      2
    )
  )
  return 0
}
