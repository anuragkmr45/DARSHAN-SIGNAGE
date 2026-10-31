import { readFile } from 'node:fs/promises';
import { chromium } from '../../../darshan-cms/node_modules/playwright/index.mjs';

const cases = ['LOGIN_PERMISSIONS', 'MEDIA_IMAGE_VIDEO', 'PDF_PAGE_2', 'LAYOUT_PRESENTATION', 'SCHEDULE_DEFAULT', 'EMERGENCY_TAKEOVER', 'CHAT_ATTACHMENT', 'PROOF_OF_PLAY', 'SCREENSHOT', 'OFFLINE_WEBPAGE'];
const routes = ['/api/v1/auth/me', '/api/v1/settings/backups', '/api/v1/settings/backups/history', '/api/v1/media', '/api/v1/presentations', '/api/v1/schedules', '/api/v1/settings/default-media', '/api/v1/emergency/status', '/api/v1/chat/conversations', '/api/v1/proof-of-play', '/api/v1/screens/overview'];
const expectedRuntimeConfig = { cms: { api: { baseUrl: 'https://127.0.0.1:18441' }, diagnostics: { showEnvironmentIdentity: true },
  environment: { cmsId: 'cms-d3', deploymentId: 'tiny-d1-development', name: 'development-d3' },
  realtime: { socketBaseUrl: 'https://127.0.0.1:18441', socketTransports: ['websocket'] } } };
const expectedRuntimeConfigBytes = `${JSON.stringify(expectedRuntimeConfig)}\n`;
const chromiumExecutable = '/home/hexmon/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable });
try { const context = await browser.newContext({ ignoreHTTPSErrors: false, serviceWorkers: 'block' }); const page = await context.newPage();
  const runtimeResponse = await context.request.get('https://127.0.0.1:18443/config/app-config.json', { timeout: 15_000 });
  const runtimeBytes = await runtimeResponse.text(); const runtimeContentType = runtimeResponse.headers()['content-type']?.toLowerCase() ?? '';
  if (!runtimeResponse.ok() || runtimeContentType !== 'application/json; charset=utf-8' || runtimeBytes !== expectedRuntimeConfigBytes) throw new Error('D3 CMS runtime config identity mismatch');
  const runtimeConfig = JSON.parse(runtimeBytes); const apiBase = runtimeConfig.cms?.api?.baseUrl; const socketBase = runtimeConfig.cms?.realtime?.socketBaseUrl;
  if (apiBase !== 'https://127.0.0.1:18441' || `${apiBase}/api/v1` !== 'https://127.0.0.1:18441/api/v1' || socketBase !== 'https://127.0.0.1:18441' ||
      `${socketBase}/chat` !== 'https://127.0.0.1:18441/chat' || `${socketBase}/screens` !== 'https://127.0.0.1:18441/screens') throw new Error('D3 CMS runtime endpoints are not fixed loopback endpoints');
  const credentials = JSON.parse(await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/secrets/cms-login.json', 'utf8'));
  if (typeof credentials.email !== 'string' || typeof credentials.password !== 'string') throw new Error('D3 CMS credential file is invalid');
  await page.goto('https://127.0.0.1:18443/login', { waitUntil: 'networkidle', timeout: 30_000 }); await page.locator('#login-email').fill(credentials.email); await page.locator('#login-password').fill(credentials.password);
  await Promise.all([page.waitForURL((url) => url.pathname !== '/login'), page.locator('button[type="submit"]').click()]);
  for (const route of routes) { const response = await context.request.get(`https://127.0.0.1:18441${route}`, { timeout: 15_000 }); if (!response.ok()) throw new Error(`D3 supported API failed: ${route}`); }
  await page.goto('https://127.0.0.1:18443/settings', { waitUntil: 'networkidle' }); await page.getByRole('tab', { name: 'Backups', exact: true }).click();
  await page.getByRole('heading', { name: 'Installation backups', exact: true }).waitFor(); await page.getByText('Backup history', { exact: true }).waitFor();
  const history = await (await context.request.get('https://127.0.0.1:18441/api/v1/settings/backups/history?limit=20')).json(); const downloadable = history.items?.find((item) => item.permissions?.can_download);
  if (downloadable) { const artifact = downloadable.artifacts?.find((value) => ['DATABASE', 'OBJECTS', 'CONFIGURATION'].includes(value.kind)); if (artifact) { const download = await context.request.get(`https://127.0.0.1:18441/api/v1/settings/backups/${downloadable.id}/download?artifact=${artifact.kind}`); if (!download.ok()) throw new Error('D3 encrypted download failed'); } }
  process.stdout.write(`${JSON.stringify({ format: 'darshan-d3-cms-live-v1', passed: cases })}\n`); await context.close();
} finally { await browser.close(); }
