import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { SecurityConfig } from '../../common/types'

type Purpose = 'navigation' | 'resource'

export class WebpageNetworkPolicyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'WebpageNetworkPolicyError'
  }
}

function ipv4Value(address: string): bigint | null {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n)
}

function ipv6Value(address: string): bigint | null {
  let normalized = address.split('%')[0]!.toLowerCase()
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':')
    const ipv4 = ipv4Value(normalized.slice(lastColon + 1))
    if (lastColon < 0 || ipv4 === null) return null
    normalized = `${normalized.slice(0, lastColon)}:${(ipv4 >> 16n).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`
  }
  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const parse = (half: string) => half ? half.split(':').map((part) => Number.parseInt(part, 16)) : []
  const left = parse(halves[0] ?? '')
  const right = parse(halves[1] ?? '')
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const parts = [...left, ...Array.from({ length: missing }, () => 0), ...right]
  if (parts.length !== 8 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return null
  return parts.reduce((value, part) => (value << 16n) | BigInt(part), 0n)
}

function ipValue(address: string): { bits: number; value: bigint } | null {
  const normalized = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
  const version = isIP(normalized)
  const value = version === 4 ? ipv4Value(normalized) : version === 6 ? ipv6Value(normalized) : null
  return value === null ? null : { bits: version === 4 ? 32 : 128, value }
}

function mappedIpv4Address(address: string): string | null {
  const resolved = ipValue(address)
  if (!resolved || resolved.bits !== 128 || resolved.value >> 32n !== 0xffffn) return null
  const ipv4 = resolved.value & 0xffffffffn
  return [24n, 16n, 8n, 0n].map((shift) => Number((ipv4 >> shift) & 0xffn)).join('.')
}

export function ipMatchesCidr(address: string, cidr: string): boolean {
  const [networkAddress, prefixText] = cidr.trim().split('/')
  if (!networkAddress || prefixText === undefined) return false
  const addressValue = ipValue(address)
  const networkValue = ipValue(networkAddress)
  const prefix = Number(prefixText)
  if (!addressValue || !networkValue || addressValue.bits !== networkValue.bits || !Number.isInteger(prefix) || prefix < 0 || prefix > addressValue.bits) return false
  if (prefix === 0) return true
  const shift = BigInt(addressValue.bits - prefix)
  return addressValue.value >> shift === networkValue.value >> shift
}

const hardDenied = (address: string): boolean => {
  const mapped = mappedIpv4Address(address)
  if (mapped) return hardDenied(mapped)
  return [
    '0.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4',
    '::/128', '::1/128', 'fe80::/10', 'ff00::/8',
  ].some((cidr) => ipMatchesCidr(address, cidr))
}

const privateAddress = (address: string): boolean => {
  const mapped = mappedIpv4Address(address)
  if (mapped) return privateAddress(mapped)
  return [
    '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', 'fc00::/7',
  ].some((cidr) => ipMatchesCidr(address, cidr))
}

export function hostMatches(hostname: string, rawPattern: string): boolean {
  const pattern = rawPattern.trim().toLowerCase()
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return hostname.length > suffix.length && hostname.endsWith(`.${suffix}`)
  }
  return hostname === pattern
}

export async function assertPlayerWebpageUrlAllowed(
  rawUrl: string,
  purpose: Purpose,
  security: SecurityConfig,
  resolveAddresses?: (hostname: string) => Promise<string[]>,
): Promise<URL> {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new WebpageNetworkPolicyError('WEBPAGE_URL_INVALID', 'Invalid webpage URL') }
  if (purpose === 'resource' && (url.protocol === 'data:' || url.protocol === 'blob:')) return url
  if (url.username || url.password) throw new WebpageNetworkPolicyError('WEBPAGE_CREDENTIALS_BLOCKED', 'URL credentials are prohibited')
  const allowHttp = security.webpageAllowHttp === true && process.env['NODE_ENV'] !== 'production'
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new WebpageNetworkPolicyError('WEBPAGE_SCHEME_BLOCKED', 'URL scheme is prohibited')
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  const ports = security.webpageAllowedPorts?.length ? security.webpageAllowedPorts : [443]
  if (!ports.includes(port)) throw new WebpageNetworkPolicyError('WEBPAGE_PORT_BLOCKED', 'URL port is prohibited')

  const navigationHosts = security.allowedDomains.map((value) => value.trim().toLowerCase()).filter(Boolean)
  const resourceHosts = security.webpageResourceDomains?.length
    ? security.webpageResourceDomains.map((value) => value.trim().toLowerCase()).filter(Boolean)
    : navigationHosts
  const allowedHosts = purpose === 'resource' ? resourceHosts : navigationHosts
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const developmentPublicDefault = process.env['NODE_ENV'] !== 'production' && allowedHosts.length === 0
  if (!developmentPublicDefault && !allowedHosts.some((pattern) => hostMatches(hostname, pattern))) {
    throw new WebpageNetworkPolicyError(
      purpose === 'resource' ? 'WEBPAGE_RESOURCE_BLOCKED' : 'WEBPAGE_HOST_NOT_ALLOWED',
      'Webpage host is not allowlisted',
    )
  }

  let addresses: string[]
  try {
    addresses = isIP(hostname)
      ? [hostname]
      : resolveAddresses
        ? await resolveAddresses(hostname)
        : (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address)
  } catch {
    throw new WebpageNetworkPolicyError('WEBPAGE_DNS_POLICY_FAILED', 'Webpage hostname did not resolve safely')
  }
  if (addresses.length === 0) throw new WebpageNetworkPolicyError('WEBPAGE_DNS_POLICY_FAILED', 'Webpage hostname has no usable address')
  const cidrs = security.webpageAllowedCidrs ?? []
  for (const address of addresses) {
    if (hardDenied(address)) throw new WebpageNetworkPolicyError('WEBPAGE_ADDRESS_BLOCKED', 'Webpage resolved to a prohibited address')
    if (privateAddress(address) && !cidrs.some((cidr) => ipMatchesCidr(address, cidr))) {
      throw new WebpageNetworkPolicyError('WEBPAGE_ADDRESS_BLOCKED', 'Private webpage address is not allowlisted')
    }
  }
  return url
}
