import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config/index.js';
export class WebpageUrlPolicyError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'WebpageUrlPolicyError';
    }
}
const csv = (value) => value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
export function webpageHostMatches(hostname, pattern) {
    if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(2);
        return hostname.length > suffix.length && hostname.endsWith(`.${suffix}`);
    }
    return hostname === pattern;
}
export function redactWebpageUrlForLogs(rawUrl) {
    try {
        const url = new URL(rawUrl);
        return `${url.protocol}//${url.host}/`;
    }
    catch {
        return '[invalid-url]';
    }
}
function ipv4ToBigInt(address) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
        return null;
    return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}
function ipv6ToBigInt(address) {
    let normalized = address.split('%')[0].toLowerCase();
    if (normalized.includes('.')) {
        const lastColon = normalized.lastIndexOf(':');
        const ipv4 = ipv4ToBigInt(normalized.slice(lastColon + 1));
        if (lastColon < 0 || ipv4 === null)
            return null;
        normalized = `${normalized.slice(0, lastColon)}:${(ipv4 >> 16n).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
    }
    const halves = normalized.split('::');
    if (halves.length > 2)
        return null;
    const parseHalf = (half) => half ? half.split(':').map((part) => Number.parseInt(part || '0', 16)) : [];
    const left = parseHalf(halves[0] ?? '');
    const right = parseHalf(halves[1] ?? '');
    const missing = 8 - left.length - right.length;
    if (missing < 0 || (halves.length === 1 && missing !== 0))
        return null;
    const parts = [...left, ...Array.from({ length: missing }, () => 0), ...right];
    if (parts.length !== 8 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff))
        return null;
    return parts.reduce((value, part) => (value << 16n) | BigInt(part), 0n);
}
function toIpValue(address) {
    const normalized = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
    const version = isIP(normalized);
    if (version === 4) {
        const value = ipv4ToBigInt(normalized);
        return value === null ? null : { bits: 32, value };
    }
    if (version === 6) {
        const value = ipv6ToBigInt(normalized);
        return value === null ? null : { bits: 128, value };
    }
    return null;
}
function mappedIpv4Address(address) {
    const value = toIpValue(address);
    if (!value || value.bits !== 128 || value.value >> 32n !== 0xffffn)
        return null;
    const ipv4 = value.value & 0xffffffffn;
    return [24n, 16n, 8n, 0n].map((shift) => Number((ipv4 >> shift) & 0xffn)).join('.');
}
export function ipMatchesCidr(address, cidr) {
    const [networkAddress, prefixText] = cidr.split('/');
    if (!networkAddress || prefixText === undefined)
        return false;
    const addressValue = toIpValue(address);
    const networkValue = toIpValue(networkAddress);
    const prefix = Number(prefixText);
    if (!addressValue || !networkValue || addressValue.bits !== networkValue.bits || !Number.isInteger(prefix) || prefix < 0 || prefix > addressValue.bits)
        return false;
    if (prefix === 0)
        return true;
    const shift = BigInt(addressValue.bits - prefix);
    return (addressValue.value >> shift) === (networkValue.value >> shift);
}
function isHardDeniedAddress(address) {
    const mapped = mappedIpv4Address(address);
    if (mapped)
        return isHardDeniedAddress(mapped);
    return [
        '0.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4',
        '::/128', '::1/128', 'fe80::/10', 'ff00::/8',
    ].some((cidr) => ipMatchesCidr(address, cidr));
}
function isPrivateAddress(address) {
    const mapped = mappedIpv4Address(address);
    if (mapped)
        return isPrivateAddress(mapped);
    return ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', 'fc00::/7']
        .some((cidr) => ipMatchesCidr(address, cidr));
}
export async function assertWebpageUrlAllowed(rawUrl, purpose, options = {}) {
    const policy = options.policy ?? config;
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        throw new WebpageUrlPolicyError('WEBPAGE_URL_INVALID', 'Webpage URL is invalid');
    }
    if (url.username || url.password)
        throw new WebpageUrlPolicyError('WEBPAGE_CREDENTIALS_BLOCKED', 'Credentials are not allowed in webpage URLs');
    const allowHttp = policy.WEBPAGE_ALLOW_HTTP === true && policy.NODE_ENV !== 'production';
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
        throw new WebpageUrlPolicyError('WEBPAGE_SCHEME_BLOCKED', 'Webpage URL scheme is not allowed');
    }
    const effectivePort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const allowedPorts = csv(policy.WEBPAGE_ALLOWED_PORTS).map(Number);
    if (!allowedPorts.includes(effectivePort))
        throw new WebpageUrlPolicyError('WEBPAGE_PORT_BLOCKED', 'Webpage URL port is not allowed');
    const navigationHosts = csv(policy.WEBPAGE_NAVIGATION_ALLOWLIST);
    const resourceHosts = csv(policy.WEBPAGE_RESOURCE_ALLOWLIST);
    const allowedHosts = purpose === 'resource' && resourceHosts.length ? resourceHosts : navigationHosts;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const hostAllowed = allowedHosts.some((pattern) => webpageHostMatches(hostname, pattern));
    const developmentPublicDefault = policy.NODE_ENV !== 'production' && allowedHosts.length === 0;
    if (!hostAllowed && !developmentPublicDefault) {
        throw new WebpageUrlPolicyError(purpose === 'resource' ? 'WEBPAGE_RESOURCE_BLOCKED' : 'WEBPAGE_HOST_NOT_ALLOWED', 'Webpage host is not on the configured allowlist');
    }
    let addresses;
    try {
        addresses = isIP(hostname)
            ? [hostname]
            : options.resolveAddresses
                ? await options.resolveAddresses(hostname)
                : (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
    }
    catch {
        throw new WebpageUrlPolicyError('WEBPAGE_DNS_POLICY_FAILED', 'Webpage host could not be resolved safely');
    }
    if (addresses.length === 0)
        throw new WebpageUrlPolicyError('WEBPAGE_DNS_POLICY_FAILED', 'Webpage host has no usable addresses');
    const cidrs = csv(policy.WEBPAGE_ALLOWED_CIDRS);
    for (const address of addresses) {
        if (isHardDeniedAddress(address))
            throw new WebpageUrlPolicyError('WEBPAGE_ADDRESS_BLOCKED', 'Webpage resolved to a prohibited address');
        if (isPrivateAddress(address) && !cidrs.some((cidr) => ipMatchesCidr(address, cidr))) {
            throw new WebpageUrlPolicyError('WEBPAGE_ADDRESS_BLOCKED', 'Private webpage address is not on the configured CIDR allowlist');
        }
    }
    return url;
}
