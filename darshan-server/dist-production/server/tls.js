import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
export function loadServerTlsOptions(config) {
    if (!config.enabled)
        return undefined;
    let cert;
    let key;
    try {
        cert = readFileSync(config.certificatePath);
        key = readFileSync(config.privateKeyPath);
        createSecureContext({ cert, key, minVersion: 'TLSv1.2' });
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`SERVER_TLS_ENABLED=true but backend TLS material is invalid: ${reason}`);
    }
    return { cert, key, minVersion: 'TLSv1.2' };
}
