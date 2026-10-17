import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../../darshan-server/node_modules/playwright');

const baseUrl = process.env.RUNTIME_API_BASE_URL ?? 'http://127.0.0.1:13000';
const superAdminEmail = process.env.RUNTIME_SUPER_ADMIN_EMAIL;
const superAdminPassword = process.env.RUNTIME_SUPER_ADMIN_PASSWORD;
const expectedRefreshSuffix = process.env.RUNTIME_WEBPAGE_RUN_SUFFIX;

if (!superAdminEmail || !superAdminPassword || !expectedRefreshSuffix) {
  throw new Error('RUNTIME_SUPER_ADMIN_EMAIL, RUNTIME_SUPER_ADMIN_PASSWORD and RUNTIME_WEBPAGE_RUN_SUFFIX are required');
}

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: JSON.stringify({ email: superAdminEmail, password: superAdminPassword }),
  });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}

async function getLatestRetainedPreview(cookie) {
  const response = await fetch(`${baseUrl}/api/v1/media?limit=100&type=WEBPAGE&status=READY`, {
    headers: { cookie, 'x-requested-with': 'XMLHttpRequest' },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const media = body.items.find((item) =>
    item.name === `Runtime HTTP ${expectedRefreshSuffix}` &&
    item.webpage_preview_refresh_status === 'FAILED' &&
    item.fallback_media_revision &&
    item.fallback_media_url
  );
  assert.ok(media, `Latest retained webpage preview was not found: ${JSON.stringify(body.items.map((item) => ({ name: item.name, status: item.status, refresh: item.webpage_preview_refresh_status })))}`);
  return {
    source: 'GLOBAL',
    aspect_ratio: '16:9',
    media_id: media.id,
    media,
  };
}

const rendererUrl = pathToFileURL(
  path.resolve(process.cwd(), 'darshan-player/dist/renderer/index.html')
).toString();

async function installPlayerBridge(page, defaultMedia, mode) {
  await page.addInitScript(({ payload, playerMode }) => {
    const presentationListeners = [];
    const webpageStatusListeners = [];
    const noOp = () => undefined;
    const initialStatus = { state: 'PAIRED_RUNTIME', mode: playerMode, online: true };
    window.darshan = {
      onPlayerPresentation(listener) {
        presentationListeners.push(listener);
        return () => {
          const index = presentationListeners.indexOf(listener);
          if (index >= 0) presentationListeners.splice(index, 1);
        };
      },
      getPlayerPresentation: async () => ({ revision: 1, status: initialStatus }),
      onPlaybackUpdate: noOp,
      onMediaChange: noOp,
      onEmergencyOverride: noOp,
      onPlayerStatus: noOp,
      getDefaultMedia: async () => payload,
      onDefaultMediaChanged: () => () => undefined,
      getConfig: async () => ({ log: { level: 'info' } }),
      getDeviceInfo: async () => ({ hostname: 'runtime-renderer', platform: 'linux', arch: 'x64' }),
      getDiagnostics: async () => ({ hostname: 'runtime-renderer', ipAddresses: ['127.0.0.1'], dnsResolution: true, apiReachable: true, latency: 1 }),
      playerAction: async () => undefined,
      completePairing: async () => null,
      log: noOp,
      reportActivePlayback: noOp,
      reportPlaybackProgress: noOp,
      getPlaybackResumeState: async () => null,
      readPdfData: async () => new ArrayBuffer(0),
      mountWebpageView: async (request) => {
        window.__runtimeMountedWebpage = request;
        queueMicrotask(() => {
          webpageStatusListeners.forEach((listener) => listener({
            id: request.id,
            generation: request.generation,
            state: 'fallback',
            reason: 'navigation-failed',
          }));
        });
        return { accepted: true };
      },
      updateWebpageView: async () => ({ accepted: true }),
      destroyWebpageView: noOp,
      onWebpageViewStatus(listener) {
        webpageStatusListeners.push(listener);
        return () => {
          const index = webpageStatusListeners.indexOf(listener);
          if (index >= 0) webpageStatusListeners.splice(index, 1);
        };
      },
    };
  }, { payload: defaultMedia, playerMode: mode });
}

const cookie = await login();
const retainedPreview = await getLatestRetainedPreview(cookie);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });

let webpageResult;
let emptyResult;
try {
  const webpagePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await installPlayerBridge(webpagePage, retainedPreview, 'default');
  await webpagePage.goto(rendererUrl);
  await webpagePage.waitForFunction(() => {
    const container = document.getElementById('default-media-container');
    const image = container?.querySelector('img');
    return container && !container.classList.contains('hidden') && image?.complete && image.naturalWidth > 0;
  }, undefined, { timeout: 15_000 });
  webpageResult = await webpagePage.evaluate(() => {
    const container = document.getElementById('default-media-container');
    const image = container?.querySelector('img');
    return {
      default_surface_visible: Boolean(container && !container.classList.contains('hidden')),
      fallback_image_loaded: Boolean(image?.complete && image.naturalWidth > 0),
      fallback_image_path: image?.src ? new URL(image.src).pathname : null,
      live_view_mount_requested: Boolean(window.__runtimeMountedWebpage),
      status_text: container?.textContent?.trim() ?? '',
    };
  });
  assert.equal(webpageResult.default_surface_visible, true);
  assert.equal(webpageResult.fallback_image_loaded, true);
  assert.equal(webpageResult.live_view_mount_requested, true);
  assert.ok(webpageResult.fallback_image_path);
  await webpagePage.close();

  const emptyPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await installPlayerBridge(emptyPage, { source: 'NONE', aspect_ratio: '16:9', media_id: null, media: null }, 'empty');
  await emptyPage.goto(rendererUrl);
  await emptyPage.waitForFunction(() => {
    const container = document.getElementById('default-media-container');
    return container && !container.classList.contains('hidden') && container.textContent?.includes('No content assigned yet.');
  }, undefined, { timeout: 15_000 });
  emptyResult = await emptyPage.evaluate(() => {
    const container = document.getElementById('default-media-container');
    return {
      default_surface_visible: Boolean(container && !container.classList.contains('hidden')),
      image_count: container?.querySelectorAll('img').length ?? 0,
      text: container?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  });
  await emptyPage.close();
} finally {
  await browser.close();
}

const results = [
  {
    id: 16,
    name: 'Player renders the retained latest webpage preview during live-page failure',
    status: 'PASS',
    evidence: {
      media_id: retainedPreview.media_id,
      fallback_revision: retainedPreview.media.fallback_media_revision,
      fallback_sha256: retainedPreview.media.fallback_media_sha256,
      refresh_status: retainedPreview.media.webpage_preview_refresh_status,
      refresh_error: retainedPreview.media.webpage_preview_last_error,
      ...webpageResult,
    },
  },
  {
    id: 18,
    name: 'No schedule/default renders a standard company fallback image',
    status: emptyResult.image_count > 0 ? 'PASS' : 'FAIL',
    evidence: {
      expected: 'standard company fallback image',
      ...emptyResult,
    },
  },
];

process.stdout.write(`${JSON.stringify({
  run: {
    timestamp: new Date().toISOString(),
    mode: 'real-player-renderer-in-headless-chromium',
    renderer_url: rendererUrl,
    webpage_run_suffix: expectedRefreshSuffix,
  },
  summary: {
    pass: results.filter((result) => result.status === 'PASS').length,
    fail: results.filter((result) => result.status === 'FAIL').length,
  },
  results,
}, null, 2)}\n`);
