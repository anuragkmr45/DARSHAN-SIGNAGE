import * as fs from 'fs'
import * as https from 'https'
import type { TransportTLSConfig } from '../../../common/types'

export function loadTransportCertificateAuthority(config: TransportTLSConfig): Buffer | undefined {
  if (!config.enabled) return undefined
  if (!config.caPath) throw new Error('Transport TLS CA path is required when transport trust is enabled')

  try {
    return fs.readFileSync(config.caPath)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read transport TLS CA at ${config.caPath}: ${reason}`)
  }
}

export function createTransportHttpsAgent(config: TransportTLSConfig): https.Agent | undefined {
  const ca = loadTransportCertificateAuthority(config)
  if (!ca) return undefined
  return new https.Agent({
    ca,
    rejectUnauthorized: config.strictCertificateValidation,
    minVersion: 'TLSv1.2',
  })
}
