import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';

export const D3_CMS_LIVE_CASES = ['LOGIN_PERMISSIONS', 'MEDIA_IMAGE_VIDEO', 'PDF_PAGE_2', 'LAYOUT_PRESENTATION', 'SCHEDULE_DEFAULT', 'EMERGENCY_TAKEOVER', 'CHAT_ATTACHMENT', 'PROOF_OF_PLAY', 'SCREENSHOT', 'OFFLINE_WEBPAGE'] as const;
export const D3_CMS_API_ROUTES = ['/api/v1/auth/me', '/api/v1/settings/backups', '/api/v1/settings/backups/history', '/api/v1/media', '/api/v1/presentations',
  '/api/v1/schedules', '/api/v1/settings/default-media', '/api/v1/emergency/status', '/api/v1/chat/conversations', '/api/v1/proof-of-play', '/api/v1/screens/overview'] as const;
export const D3_CMS_SELECTORS = ['#login-email', '#login-password', 'button[type="submit"]', 'role=tab[name="Backups"]', 'role=heading[name="Installation backups"]', 'text=Backup history'] as const;
export const D3_PLAYWRIGHT = Object.freeze({ packageManifest: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/node_modules/playwright/package.json',
  apiModule: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/node_modules/playwright/index.mjs', cli: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/node_modules/playwright/cli.js',
  browserCatalog: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/node_modules/playwright-core/browsers.json',
  executable: '/home/hexmon/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell', packageVersion: '1.58.2', browserVersion: '145.0.7632.6',
  browser: 'chromium-headless-shell', headless: true,
  baseUrl: 'https://127.0.0.1:18443', userDataDir: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/browser', firefoxUntouched: true });
export interface D3CmsBoundary { collisionFreeLoopbackPort(port: 18443): Promise<boolean>; playwrightIdentity(path: string): Promise<{ sha256: string; executable: boolean } | null>;
  runSerial(input: typeof D3_PLAYWRIGHT, cases: typeof D3_CMS_LIVE_CASES): Promise<{ passed: readonly string[]; evidenceSha256: string }> }
export async function runD3CmsLive(boundary: D3CmsBoundary, expectedPlaywrightSha256: string) { if (!await boundary.collisionFreeLoopbackPort(18443)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_LOOPBACK_PORT_COLLISION', 'Fixed CMS loopback port is occupied.');
  const identity = await boundary.playwrightIdentity(D3_PLAYWRIGHT.executable); if (!identity?.executable || identity.sha256 !== expectedPlaywrightSha256)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BROWSER_UNAVAILABLE', 'Exact Playwright Chromium launcher is unavailable.');
  const result = await boundary.runSerial(D3_PLAYWRIGHT, D3_CMS_LIVE_CASES); if (D3_CMS_LIVE_CASES.some((value) => !result.passed.includes(value)))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CMS_VALIDATION_FAILED', 'CMS live serial validation is incomplete.'); return { ...result, catalogSha256: digest(D3_CMS_LIVE_CASES) }; }
