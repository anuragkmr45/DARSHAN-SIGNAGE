import * as tls from 'tls'
import * as net from 'net'
import { createHash, X509Certificate } from 'crypto'
import type { TransportTLSConfig } from '../../../common/types'
import { loadTransportCertificateAuthority } from './transport-tls'

export type LiveTlsProbe = (host: string, port: number, ca: Buffer, signal: AbortSignal) => Promise<string>
export const probeLiveTlsLeaf: LiveTlsProbe = (host, port, ca, signal) => new Promise((resolve, reject) => {
  let complete = false
  let timer: NodeJS.Timeout | undefined
  let socket: tls.TLSSocket | undefined
  const finish = (fingerprint?: string): void => {
    if (complete) return
    complete = true
    if (timer) clearTimeout(timer)
    signal.removeEventListener('abort', aborted)
    socket?.destroy()
    if (fingerprint) resolve(fingerprint)
    else reject(new Error('Live gateway TLS verification failed'))
  }
  const aborted = (): void => finish()
  if (signal.aborted) { finish(); return }
  signal.addEventListener('abort', aborted, { once: true })
  timer = setTimeout(aborted, 1500)
  // Leave certificate-chain, critical extension, validity, hostname/IP and
  // intermediate validation entirely to Node's standard TLS implementation.
  socket = tls.connect({ host, port, ca, rejectUnauthorized: true, minVersion: 'TLSv1.2',
    ...(net.isIP(host) ? {} : { servername: host }) }, () => {
    if (!socket?.authorized) { finish(); return }
    const raw = socket.getPeerCertificate().raw
    if (!raw?.length) { finish(); return }
    finish(createHash('sha256').update(raw).digest('hex'))
  })
  socket.once('error', aborted)
  socket.once('close', aborted)
})

/** This override is scoped to one ephemeral LIVE session and exact gateway.
 * It never changes global Chromium trust or accepts a different peer leaf. */
export function createLiveCertificateVerifier(
  gatewayOrigin: string,
  trust: TransportTLSConfig,
  signal: AbortSignal,
  probe: LiveTlsProbe = probeLiveTlsLeaf,
): (request: { hostname: string; verificationResult: string; certificate: { data: string } }, callback: (result: number) => void) => void {
  const gateway = new URL(gatewayOrigin)
  const hostname = gateway.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const port = gateway.port ? Number(gateway.port) : 443
  const ca = loadTransportCertificateAuthority(trust)
  let pending: Promise<string> | undefined
  return (request, callback) => {
    if (signal.aborted || request.hostname.toLowerCase() !== hostname || gateway.protocol !== 'wss:') { callback(-2); return }
    if (request.verificationResult === 'net::OK') { callback(-3); return }
    if (!ca) { callback(-3); return }
    let leaf: string
    try { leaf = createHash('sha256').update(new X509Certificate(request.certificate.data).raw).digest('hex') }
    catch { callback(-2); return }
    if (!pending) {
      const attempt = probe(hostname, port, ca, signal)
      pending = attempt
      void attempt.finally(() => { if (pending === attempt) pending = undefined }).catch(() => undefined)
    }
    void pending.then(verified => callback(!signal.aborted && verified === leaf ? 0 : -2), () => callback(-2))
  }
}
