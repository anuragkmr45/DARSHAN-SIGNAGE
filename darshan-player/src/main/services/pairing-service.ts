import * as os from 'os'
import { randomUUID } from 'crypto'
import { getLogger } from '../../common/logger'
import { getConfigManager } from '../../common/config'
import { redactUrlForDiagnostics } from '../../common/redaction'
import { getElectronApp, getElectronScreen } from '../../common/platform-paths'
import {
  BackendPairingStatusResponse,
  BackendPairingValidationStatus,
  DeviceInfo,
  PairingCodeRequest,
  PairingCodeResponse,
  PairingRequest,
  PairingResponse,
  PairingStatusResponse,
  PlayerState,
  ScreenshotPolicyResponse,
  isDeviceApiError,
} from '../../common/types'
import { getCertificateManager } from './cert-manager'
import { getHttpClient } from './network/http-client'
import { getDeviceStateStore } from './device-state-store'

const logger = getLogger('pairing-service')
const runtimeSessionId = randomUUID()

const BACKEND_PAIRING_STATUS_VALUES = new Set<BackendPairingValidationStatus>([
  'VALID',
  'VALID_NO_CONTENT',
  'UNPAIRED',
  'INVALID_TOKEN',
  'SCREEN_NOT_FOUND',
  'SCREEN_DELETED',
  'PAIRING_REVOKED',
  'ORPHANED_CREDENTIAL',
  'ENVIRONMENT_MISMATCH',
  'RECLAIM_REQUIRED',
  'BACKEND_REPAIR_REQUIRED',
])

export interface NetworkDiagnostics {
  hostname: string
  ipAddresses: string[]
  dnsResolution: boolean
  apiReachable: boolean
  apiBase?: string
  apiHost?: string
  apiIsLoopback?: boolean
  apiIsPrivate?: boolean
  apiEndpoint?: string
  apiStatus?: number
  apiError?: string
  wsReachable: boolean
  latency?: number
}

export class PairingService {
  isPairedDevice(): boolean {
    const certManager = getCertificateManager()
    const state = getDeviceStateStore().getState()
    return Boolean(this.getDeviceId() && (state.fingerprint || certManager.getCertificateMetadata()?.fingerprint) && certManager.areCertificatesPresent())
  }

  getDeviceId(): string | undefined {
    return getDeviceStateStore().getState().deviceId || getConfigManager().getConfig().deviceId || undefined
  }

  hasTrustworthyDeviceId(): boolean {
    const deviceId = this.getDeviceId()
    return typeof deviceId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)
  }

  getFingerprint(): string | undefined {
    return getDeviceStateStore().getState().fingerprint
  }

  getLastPairingCode(): string | undefined {
    return getDeviceStateStore().getState().pairingCode
  }

  getPairingExpiry(): string | undefined {
    return getDeviceStateStore().getState().pairingExpiresAt
  }

  getLifecycleState(): PlayerState | undefined {
    return getDeviceStateStore().getState().lifecycleState
  }

  getDeviceInfo(): DeviceInfo {
    return {
      deviceId: this.getDeviceId() || '',
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      appVersion: typeof getElectronApp()?.getVersion === 'function' ? getElectronApp()!.getVersion() : 'unknown',
      electronVersion: process.versions.electron || 'unknown',
      nodeVersion: process.versions.node,
    }
  }

  getDeviceAuthHeaderValue(): string | undefined {
    const state = getDeviceStateStore().getState()
    if (state.fingerprint) {
      return state.fingerprint
    }

    const metadata = getCertificateManager().getCertificateMetadata()
    return metadata?.serialNumber || metadata?.fingerprint
  }

  async getInstallInstanceId(): Promise<string> {
    return await getDeviceStateStore().ensureInstallInstanceId()
  }

  getRuntimeSessionId(): string {
    return runtimeSessionId
  }

  getStoredIdentityHealth(): { health: 'missing' | 'partial' | 'complete'; issues: string[] } {
    const certManager = getCertificateManager()
    const store = getDeviceStateStore()
    const paths = certManager.getCertificatePaths()
    return store.classifyIdentity(store.getIdentitySnapshot(paths))
  }

  async requestPairingCode(overrides: Partial<PairingCodeRequest> = {}): Promise<PairingCodeResponse> {
    const payload = this.buildPairingCodeRequest(overrides)
    const httpClient = getHttpClient()

    try {
      const response = await httpClient.post<PairingCodeResponse>('/api/v1/device-pairing/request', payload, {
        mtls: false,
        retry: false,
      })

      await getDeviceStateStore().update({
        lifecycleState: 'PAIRING_PENDING',
        deviceId: response.device_id,
        pairingCode: response.pairing_code,
        pairingExpiresAt: response.expires_at,
        activePairingMode: 'PAIRING',
        pairingRequestInDoubtAt: undefined,
        recoveryReason: undefined,
        lastPairingValidationStatus: undefined,
        lastPairingValidatedAt: undefined,
        lastValidatedDeviceId: undefined,
        lastValidatedServerIdentity: undefined,
        duplicateIdentity: undefined,
      })

      getConfigManager().updateConfig({
        deviceId: response.device_id,
      })

      return response
    } catch (error) {
      logger.error({ error }, 'Failed to request pairing code')
      throw error
    }
  }

  async fetchPairingStatus(deviceIdOverride?: string): Promise<PairingStatusResponse> {
    const deviceId = deviceIdOverride || this.getDeviceId()

    if (!deviceId) {
      return {
        device_id: '',
        paired: false,
        confirmed: false,
        screen: null,
        active_pairing: null,
      }
    }

    const httpClient = getHttpClient()
    return await httpClient.get<PairingStatusResponse>(
      `/api/v1/device-pairing/status?device_id=${encodeURIComponent(deviceId)}`,
      { mtls: false }
    )
  }

  async fetchBackendPairingStatus(deviceIdOverride?: string): Promise<BackendPairingStatusResponse> {
    const deviceId = deviceIdOverride || this.getDeviceId()
    if (!deviceId) {
      return {
        status: 'UNPAIRED',
        code: 'UNPAIRED',
        message: 'No local device identity is available.',
        deviceId: '',
        screenVisible: false,
        requiresReclaim: false,
        serverTime: new Date().toISOString(),
      }
    }

    const httpClient = getHttpClient()
    const installInstanceId = await this.getInstallInstanceId()
    const config = getConfigManager().getConfig()
    const environmentHeaders: Record<string, string> = {}
    if (config.environment?.name) {
      environmentHeaders['x-signhex-environment-name'] = config.environment.name
    }
    if (config.environment?.deploymentId) {
      environmentHeaders['x-signhex-deployment-id'] = config.environment.deploymentId
    }
    const response = await httpClient.get<BackendPairingStatusResponse>(
      `/api/v1/device/${encodeURIComponent(deviceId)}/pairing-status`,
      {
        retry: false,
        headers: {
          'x-signhex-install-instance-id': installInstanceId,
          'x-signhex-runtime-session-id': this.getRuntimeSessionId(),
          'x-signhex-player-version': this.getDeviceInfo().appVersion,
          ...environmentHeaders,
        },
      }
    )

    if (!response || !BACKEND_PAIRING_STATUS_VALUES.has(response.status)) {
      throw new Error('Backend pairing status response is invalid')
    }

    return response
  }

  async markPairingValidation(response: BackendPairingStatusResponse): Promise<void> {
    await getDeviceStateStore().update({
      lastPairingValidationStatus: response.status,
      lastPairingValidatedAt: new Date().toISOString(),
      lastValidatedDeviceId: response.deviceId || this.getDeviceId(),
      lastValidatedServerIdentity: response.serverIdentity,
      duplicateIdentity: response.duplicateIdentity,
    })
  }

  async fetchScreenshotPolicy(deviceIdOverride?: string): Promise<ScreenshotPolicyResponse | null> {
    const deviceId = deviceIdOverride || this.getDeviceId()
    if (!deviceId) {
      return null
    }

    try {
      const httpClient = getHttpClient()
      return await httpClient.get<ScreenshotPolicyResponse>(`/api/v1/device/${encodeURIComponent(deviceId)}/screenshot-policy`, {
        retry: false,
      })
    } catch (error) {
      if (isDeviceApiError(error)) {
        logger.warn(
          { deviceId, code: error.code, message: error.message },
          'Screenshot policy unavailable during bootstrap; keeping capture disabled'
        )
        return null
      }

      logger.warn({ deviceId, error }, 'Unexpected screenshot policy fetch failure; keeping capture disabled')
      return null
    }
  }

  async submitPairing(pairingCode: string): Promise<PairingResponse> {
    if (!/^[A-Z0-9]{6}$/.test(pairingCode)) {
      throw new Error('Invalid pairing code format. Must be 6 alphanumeric characters.')
    }

    const deviceInfo = this.getDeviceInfo()
    const certManager = getCertificateManager()
    const csr = await certManager.generateCSR(deviceInfo, {
      commonName: this.getDeviceId() || deviceInfo.hostname,
    })

    const request: PairingRequest = {
      pairing_code: pairingCode,
      csr,
    }

    const httpClient = getHttpClient()
    const response = await httpClient.post<PairingResponse>('/api/v1/device-pairing/complete', request, {
      mtls: false,
      retry: false,
    })

    if (response.success === false) {
      throw new Error('Pairing request was rejected by the server')
    }

    await this.completePairing(response)
    return response
  }

  async completePairing(response: PairingResponse): Promise<void> {
    if (!response.device_id) {
      throw new Error('Pairing response missing device_id')
    }
    if (!response.certificate || !response.ca_certificate) {
      throw new Error('Pairing response missing certificate material')
    }
    if (!response.fingerprint) {
      throw new Error('Pairing response missing fingerprint')
    }

    const certManager = getCertificateManager()
    await certManager.storeCertificate(response.certificate, response.ca_certificate)

    await getDeviceStateStore().update({
      lifecycleState: 'BOOTSTRAP_AUTH',
      deviceId: response.device_id,
      fingerprint: response.fingerprint,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      activePairingMode: undefined,
      pairingRequestInDoubtAt: undefined,
      recoveryReason: undefined,
      hardRecoveryDeadlineAt: undefined,
      lastSuccessfulPairingAt: new Date().toISOString(),
      lastPairingValidationStatus: undefined,
      lastPairingValidatedAt: undefined,
      lastValidatedDeviceId: undefined,
      lastValidatedServerIdentity: undefined,
      duplicateIdentity: undefined,
    })

    getConfigManager().updateConfig({
      deviceId: response.device_id,
      mtls: {
        ...getConfigManager().getConfig().mtls,
        enabled: false,
      },
    })
  }

  async markPairingRequestInDoubt(reason: string): Promise<void> {
    logger.warn({ reason }, 'Pairing request outcome is ambiguous')
    await getDeviceStateStore().update({
      pairingRequestInDoubtAt: new Date().toISOString(),
      recoveryReason: reason,
    })
  }

  async clearPairingMetadata(): Promise<void> {
    await getDeviceStateStore().clearPairingMetadata()
  }

  async markLastHeartbeat(timestamp: string): Promise<void> {
    await getDeviceStateStore().update({
      lastHeartbeatAt: timestamp,
    })
  }

  async resetStoredIdentity(reason?: string): Promise<void> {
    await getCertificateManager().deleteCertificates()
    await getDeviceStateStore().clearIdentity(reason)
    getConfigManager().updateConfig({
      deviceId: '',
      mtls: {
        ...getConfigManager().getConfig().mtls,
        enabled: false,
      },
    })
  }

  async markRecoveryState(state: Extract<PlayerState, 'RECOVERY_REQUIRED' | 'HARD_RECOVERY'>, reason: string): Promise<void> {
    await getDeviceStateStore().update({
      lifecycleState: state,
      recoveryReason: reason,
    })
  }

  async checkCertificateRenewal(): Promise<void> {
    const identityHealth = this.getStoredIdentityHealth()
    if (identityHealth.health !== 'complete') {
      return
    }

    const config = getConfigManager().getConfig()
    if (!config.mtls.autoRenew) {
      return
    }

    const certManager = getCertificateManager()
    const needsRenewal = await certManager.needsRenewal()
    if (needsRenewal) {
      logger.warn('Certificate is nearing expiry; backend runtime auth does not currently enforce expiry automatically')
    }
  }

  async runDiagnostics(): Promise<NetworkDiagnostics> {
    logger.info('Running network diagnostics')

    const diagnostics: NetworkDiagnostics = {
      hostname: os.hostname(),
      ipAddresses: this.getIPAddresses(),
      dnsResolution: false,
      apiReachable: false,
      wsReachable: false,
    }

    try {
      const config = getConfigManager().getConfig()
      const apiUrl = new URL(config.apiBase)
      diagnostics.apiBase = redactUrlForDiagnostics(config.apiBase)
      diagnostics.apiHost = apiUrl.hostname
      diagnostics.apiIsLoopback = this.isLoopbackHost(apiUrl.hostname)
      diagnostics.apiIsPrivate = this.isPrivateIpv4(apiUrl.hostname)

      if (diagnostics.apiIsLoopback) {
        diagnostics.dnsResolution = true
      } else {
      const dns = await import('dns')
        await new Promise<void>((resolve, reject) => {
          dns.lookup(apiUrl.hostname, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      diagnostics.dnsResolution = true
      }
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'DNS resolution failed')
    }

    try {
      const httpClient = getHttpClient()
      const startTime = Date.now()
      const result = await httpClient.checkConnectivityDetailed()
      diagnostics.apiReachable = result.ok
      diagnostics.apiBase = redactUrlForDiagnostics(result.baseURL)
      diagnostics.apiEndpoint = result.endpoint
      diagnostics.apiStatus = result.status
      diagnostics.apiError = result.error
      diagnostics.latency = Date.now() - startTime
    } catch (error) {
      logger.warn({ error }, 'API reachability test failed')
    }

    diagnostics.wsReachable = false
    return diagnostics
  }

  isRetryablePairingRequestError(error: unknown): boolean {
    if (isDeviceApiError(error)) {
      return error.transient
    }
    return false
  }

  shouldRetryPairingComplete(error: unknown): boolean {
    if (!isDeviceApiError(error)) {
      return false
    }
    if (error.code === 'CONFLICT' && error.message.includes('Pairing not confirmed')) {
      return true
    }
    return error.transient
  }

  isExpiredPairingCodeError(error: unknown): boolean {
    return isDeviceApiError(error) && error.code === 'NOT_FOUND'
  }

  isPairingNotConfirmedError(error: unknown): boolean {
    return isDeviceApiError(error) && error.code === 'CONFLICT' && error.message.includes('Pairing not confirmed')
  }

  isDeviceNotRegisteredError(error: unknown): boolean {
    return isDeviceApiError(error) && error.code === 'NOT_FOUND' && error.message.includes('Device not registered')
  }

  isInvalidCredentialError(error: unknown): boolean {
    return isDeviceApiError(error) && (error.code === 'FORBIDDEN' || error.code === 'UNAUTHORIZED')
  }

  isTransientRuntimeError(error: unknown): boolean {
    return isDeviceApiError(error) ? error.transient : false
  }

  getBackendPairingStatusFromError(error: unknown): BackendPairingValidationStatus | null {
    if (!isDeviceApiError(error)) {
      return null
    }

    if (BACKEND_PAIRING_STATUS_VALUES.has(error.code as BackendPairingValidationStatus)) {
      return error.code as BackendPairingValidationStatus
    }

    const detailStatus =
      error.detailsPayload && typeof error.detailsPayload === 'object'
        ? (error.detailsPayload as Record<string, unknown>)['status'] ||
          (error.detailsPayload as Record<string, unknown>)['reason']
        : null

    if (typeof detailStatus === 'string' && BACKEND_PAIRING_STATUS_VALUES.has(detailStatus as BackendPairingValidationStatus)) {
      return detailStatus as BackendPairingValidationStatus
    }

    if (error.code === 'NOT_FOUND' && error.message.includes('Device not registered')) {
      return 'SCREEN_NOT_FOUND'
    }
    if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') {
      return error.message.toLowerCase().includes('revoked') ? 'PAIRING_REVOKED' : 'INVALID_TOKEN'
    }

    return null
  }

  private buildPairingCodeRequest(overrides: Partial<PairingCodeRequest> = {}): PairingCodeRequest {
    const electronScreen = getElectronScreen()
    const display = typeof electronScreen?.getPrimaryDisplay === 'function' ? electronScreen.getPrimaryDisplay() : undefined
    const width = display?.workAreaSize.width ?? 0
    const height = display?.workAreaSize.height ?? 0
    const hasValidDimensions = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    const orientation = hasValidDimensions && width >= height ? 'landscape' : 'portrait'

    const base: PairingCodeRequest = {
      device_label: os.hostname() || 'DARSHAN Screen',
      model: process.env['DARSHAN_DEVICE_MODEL'] || process.env['HEXMON_DEVICE_MODEL'] || os.type(),
      codecs: this.getSupportedCodecs(),
      device_info: {
        os: `${os.platform()} ${os.release()}`,
      },
    }

    if (hasValidDimensions) {
      base.width = width
      base.height = height
      base.aspect_ratio = this.getAspectRatio(width, height)
      base.orientation = orientation
    } else {
      logger.warn({ width, height }, 'Invalid display dimensions, omitting size fields from pairing request')
    }

    return {
      ...base,
      ...overrides,
      device_info: {
        ...base.device_info,
        ...overrides.device_info,
      },
    }
  }

  private getSupportedCodecs(): string[] {
    const value = process.env['DARSHAN_DEVICE_CODECS'] || process.env['HEXMON_DEVICE_CODECS']
    if (!value) {
      return ['h264']
    }

    return value
      .split(',')
      .map((codec) => codec.trim())
      .filter((codec) => codec.length > 0)
  }

  private getAspectRatio(width: number, height: number): string {
    const divisor = this.getGreatestCommonDivisor(width, height)
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
  }

  private getGreatestCommonDivisor(a: number, b: number): number {
    let x = Math.abs(a)
    let y = Math.abs(b)

    while (y !== 0) {
      const temp = y
      y = x % y
      x = temp
    }

    return x || 1
  }

  private getIPAddresses(): string[] {
    const interfaces = os.networkInterfaces()
    const addresses: string[] = []

    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name]
      if (!iface) continue

      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) {
          addresses.push(addr.address)
        }
      }
    }

    return addresses
  }

  private isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  }

  private isPrivateIpv4(hostname: string): boolean {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      return false
    }

    const parts = hostname.split('.')
    if (parts.length !== 4) {
      return false
    }

    const a = Number.parseInt(parts[0] || '', 10)
    const b = Number.parseInt(parts[1] || '', 10)

    if (Number.isNaN(a) || Number.isNaN(b)) {
      return false
    }

    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
}

let pairingService: PairingService | null = null

export function getPairingService(): PairingService {
  if (!pairingService) {
    pairingService = new PairingService()
  }
  return pairingService
}
