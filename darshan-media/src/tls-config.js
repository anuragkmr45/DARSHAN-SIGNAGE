import { X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { isIP } from 'node:net';
import { configurationError, readProtectedFile } from './authority-file.js';

export function readTrustedCa(filename) {
  if (!filename) return undefined; // Node's normal verified system trust remains enabled.
  const data = readProtectedFile(filename, { maxBytes: 262_144 }).data;
  try {
    const text = data.toString('utf8'), certificates = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    if (!certificates.length || certificates.reduce((rest, pem) => rest.replace(pem, ''), text).trim()) throw new Error();
    for (const pem of certificates) new X509Certificate(pem);
    return data;
  } catch { throw configurationError('TLS_CA_INVALID'); }
}

export function readServerTls({ certFile, keyFile, signalUrl }) {
  try {
    const cert = readProtectedFile(certFile, { maxBytes: 262_144 }).data;
    const key = readProtectedFile(keyFile, { privateFile: true, maxBytes: 65_536 }).data;
    createSecureContext({ cert, key, minVersion: 'TLSv1.2' });
    const certificate = new X509Certificate(cert);
    if (Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error();
    const url = new URL(signalUrl), hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || ['0.0.0.0', '::'].includes(hostname)
      || !(isIP(hostname) ? certificate.checkIP(hostname) : certificate.checkHost(hostname))) throw new Error();
    return { cert, key, minVersion: 'TLSv1.2' };
  } catch { throw configurationError('TLS_SERVER_CONFIGURATION_INVALID'); }
}
