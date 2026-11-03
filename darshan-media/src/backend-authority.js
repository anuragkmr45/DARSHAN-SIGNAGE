import https from 'node:https';
import { MediaError } from './controller.js';
import { configurationError, pinAuthorityFile, validUuid } from './authority-file.js';
import { readTrustedCa } from './tls-config.js';

const fields = ['action', 'nonce', 'id', 'run_id', 'generation', 'node_instance_id', 'authority_epoch', 'operation_revision'];
export function createBackendAuthority({ url: inputUrl, authorityFile, caFile, nodeInstanceId, onInvalid = () => {}, timeoutMs = 1500 }) {
  let url;
  try { url = new URL(inputUrl); } catch { throw configurationError('BACKEND_AUTHORITY_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/api/v1/internal/live-authority' || !validUuid(nodeInstanceId)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1500) throw configurationError('BACKEND_AUTHORITY_CONFIGURATION_INVALID');
  const authority = pinAuthorityFile(authorityFile);
  const ca = readTrustedCa(caFile);
  let invalid = false;
  const assertCurrent = () => {
    if (invalid) throw new MediaError('BACKEND_AUTHORITY_CONFIGURATION_CHANGED', 503);
    try { authority.assertUnchanged(); }
    catch { invalid = true; try { onInvalid(); } catch {} throw new MediaError('BACKEND_AUTHORITY_CONFIGURATION_CHANGED', 503); }
  };
  const verifyAuthority = async input => {
    assertCurrent();
    if (!input || input.node_instance_id !== nodeInstanceId || input.authority_epoch !== authority.epochId
      || !validUuid(input.id) || !validUuid(input.run_id) || !Number.isSafeInteger(input.generation) || input.generation < 1
      || !Number.isSafeInteger(input.operation_revision) || input.operation_revision < 1
      || !['CREATE', 'RENEW', 'TICKET'].includes(input.action) || !/^[A-Za-z0-9_-]{43}$/.test(input.nonce ?? '')) {
      throw new MediaError('BACKEND_AUTHORITY_REQUEST_INVALID', 403);
    }
    const body = JSON.stringify(Object.fromEntries(fields.map(field => [field, input[field]])));
    return new Promise((resolve, reject) => {
      let request, timer, settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer); input.signal?.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve(value);
      };
      const fail = code => { finish(new MediaError(code, 503)); request?.destroy(); };
      const aborted = () => fail('BACKEND_AUTHORITY_ABORTED');
      timer = setTimeout(() => fail('BACKEND_AUTHORITY_TIMEOUT'), timeoutMs);
      if (input.signal?.aborted) { aborted(); return; }
      input.signal?.addEventListener('abort', aborted, { once: true });
      try {
        authority.withSecret(secret => {
          request = https.request(url, { method: 'POST', ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false,
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
              'cache-control': 'no-store', 'x-darshan-live-authority-secret': secret } }, response => {
            let count = 0; const chunks = [];
            if (response.statusCode !== 200 || !String(response.headers['content-type'] ?? '').toLowerCase().includes('application/json')
              || Number(response.headers['content-length'] ?? 0) > 8192) { fail('BACKEND_AUTHORITY_RESPONSE_INVALID'); response.destroy(); return; }
            response.on('error', () => fail('BACKEND_AUTHORITY_UNAVAILABLE'));
            response.on('aborted', () => fail('BACKEND_AUTHORITY_UNAVAILABLE'));
            response.on('data', chunk => { count += chunk.length; if (count > 8192) { fail('BACKEND_AUTHORITY_RESPONSE_INVALID'); response.destroy(); } else chunks.push(chunk); });
            response.on('end', () => {
              try {
                assertCurrent();
                const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (!result || Array.isArray(result) || (result.allowed !== true && result.allowed !== false)
                  || fields.filter(field => field !== 'action').some(field => result[field] !== input[field])
                  || (result.action !== undefined && result.action !== input.action)) throw new MediaError('BACKEND_AUTHORITY_RESPONSE_INVALID', 503);
                finish(null, result);
              } catch (error) { finish(error instanceof MediaError ? error : new MediaError('BACKEND_AUTHORITY_RESPONSE_INVALID', 503)); }
            });
          });
        });
        request.on('error', () => fail('BACKEND_AUTHORITY_UNAVAILABLE'));
        request.end(body);
      } catch {
        try { assertCurrent(); } catch (error) { finish(error); request?.destroy(); return; }
        fail('BACKEND_AUTHORITY_UNAVAILABLE');
      }
    });
  };
  return Object.freeze({ epochId: authority.epochId, verifyAuthority, assertCurrent,
    usesSecret: candidate => authority.withSecret(secret => candidate === secret) });
}
