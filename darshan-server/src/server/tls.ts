import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';

export type ServerTlsConfig = {
  enabled: boolean;
  certificatePath: string;
  privateKeyPath: string;
};

export function loadServerTlsOptions(config: ServerTlsConfig) {
  if (!config.enabled) return undefined;

  let cert: Buffer;
  let key: Buffer;
  try {
    cert = readFileSync(config.certificatePath);
    key = readFileSync(config.privateKeyPath);
    createSecureContext({ cert, key, minVersion: 'TLSv1.2' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`SERVER_TLS_ENABLED=true but backend TLS material is invalid: ${reason}`);
  }

  return { cert, key, minVersion: 'TLSv1.2' as const };
}
