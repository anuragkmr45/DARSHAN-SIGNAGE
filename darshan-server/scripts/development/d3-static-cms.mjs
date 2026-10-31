import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/dist';
const tlsRoot = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/tls';
const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.ico', 'image/x-icon'], ['.woff2', 'font/woff2'],
]);

export const D3_CMS_SPA_ROUTES = Object.freeze(new Set(['/', '/login', '/settings']));
export const D3_CMS_RUNTIME_CONFIG = Object.freeze({ cms: Object.freeze({
  api: Object.freeze({ baseUrl: 'https://127.0.0.1:18441' }),
  diagnostics: Object.freeze({ showEnvironmentIdentity: true }),
  environment: Object.freeze({ cmsId: 'cms-d3', deploymentId: 'tiny-d1-development', name: 'development-d3' }),
  realtime: Object.freeze({ socketBaseUrl: 'https://127.0.0.1:18441', socketTransports: Object.freeze(['websocket']) }),
}) });
export const D3_CMS_RUNTIME_CONFIG_BYTES = Buffer.from(`${JSON.stringify(D3_CMS_RUNTIME_CONFIG)}\n`, 'utf8');

function requestedPath(requestUrl) {
  const raw = (requestUrl ?? '/').split(/[?#]/u, 1)[0] ?? '/';
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return decoded;
}

/** Fixed handler seam used only by bounded static tests; installed execution injects the fixed dist reader below. */
export function createD3StaticCmsHandler(readAsset) {
  return async (request, response) => {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') { response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }).end(); return; }
    const requested = requestedPath(request.url);
    if (requested === null) { response.writeHead(404, { 'cache-control': 'no-store' }).end(); return; }
    if (requested === '/config/app-config.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': String(D3_CMS_RUNTIME_CONFIG_BYTES.byteLength) });
      response.end(method === 'HEAD' ? undefined : D3_CMS_RUNTIME_CONFIG_BYTES); return;
    }
    const relative = D3_CMS_SPA_ROUTES.has(requested) ? 'index.html' : requested.replace(/^\/+/, '');
    if (!relative || (extname(relative) === '' && relative !== 'index.html')) { response.writeHead(404, { 'cache-control': 'no-store' }).end(); return; }
    try {
      const body = await readAsset(relative);
      response.writeHead(200, { 'content-type': types.get(extname(relative)) ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-length': String(body.byteLength) });
      response.end(method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404, { 'cache-control': 'no-store' }).end(); }
  };
}

async function readFixedAsset(relative) {
  const path = resolve(root, relative); if (!path.startsWith(`${root}${sep}`)) throw new Error('D3 CMS asset path escaped its fixed root');
  return readFile(path);
}

async function startFixedServer() {
  const [key, cert] = await Promise.all([readFile(`${tlsRoot}/cms.key`), readFile(`${tlsRoot}/cms.crt`)]);
  https.createServer({ key, cert }, createD3StaticCmsHandler(readFixedAsset)).listen(18443, '127.0.0.1');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await startFixedServer();
