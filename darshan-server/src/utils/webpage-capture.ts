import type { Browser, CDPSession, Response } from 'playwright';
import { getResolvedChromiumExecutable } from '@/utils/runtime-dependencies';
import { assertWebpageUrlAllowed, WebpageUrlPolicyError } from '@/utils/webpage-url-policy';

const MAX_MAIN_DOCUMENT_BYTES = 10 * 1024 * 1024;
const CAPTURE_TOTAL_DEADLINE_MS = 25_000;

type CapturedWebpage = {
  finalUrl: string;
  contentType?: string;
  title: string | null;
  screenshot: Buffer;
};

let browserPromise: Promise<Browser> | null = null;

function isHtmlContentType(contentType?: string | null) {
  if (!contentType) return true;
  const normalized = contentType.toLowerCase();
  return normalized.includes('text/html') || normalized.includes('application/xhtml+xml');
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = import('playwright')
      .then(async ({ chromium }) => {
        const executablePath = await getResolvedChromiumExecutable();

        const browser = await chromium.launch({
          headless: true,
          executablePath,
          args: ['--disable-dev-shm-usage'],
        });

        browser.on('disconnected', () => {
          browserPromise = null;
        });

        return browser;
      })
      .catch((error) => {
        browserPromise = null;
        throw new Error(
          `Playwright Chromium is not available. Install the browser runtime on this host or set DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH. ${error instanceof Error ? error.message : String(error)}`
        );
      });
  }

  return browserPromise;
}

export async function captureWebpagePreview(sourceUrl: string): Promise<CapturedWebpage> {
  await assertWebpageUrlAllowed(sourceUrl, 'navigation');
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    javaScriptEnabled: true,
    userAgent: 'DARSHAN/1.0 (+webpage-capture)',
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  let mainNavigationPolicyError: WebpageUrlPolicyError | null = null;
  let deadlineExceeded = false;
  let responseSizeExceeded = false;
  let cdp: CDPSession | null = null;
  const documentBytes = new Map<string, number>();
  const deadlineTimer = setTimeout(() => {
    deadlineExceeded = true;
    void page.close().catch(() => {});
  }, CAPTURE_TOTAL_DEADLINE_MS);
  deadlineTimer.unref?.();

  try {
    cdp = await context.newCDPSession(page);
    cdp.on('Network.requestWillBeSent', (event: { requestId: string; type?: string }) => {
      if (event.type === 'Document') documentBytes.set(event.requestId, 0);
    });
    cdp.on('Network.dataReceived', (event: { requestId: string; dataLength?: number }) => {
      const current = documentBytes.get(event.requestId);
      if (current === undefined || responseSizeExceeded) return;
      const total = current + Math.max(0, Number(event.dataLength) || 0);
      documentBytes.set(event.requestId, total);
      if (total > MAX_MAIN_DOCUMENT_BYTES) {
        responseSizeExceeded = true;
        void page.close().catch(() => {});
      }
    });
    await cdp.send('Network.enable');

    await page.route('**/*', async (route) => {
      const request = route.request();
      const isMainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
      try {
        await assertWebpageUrlAllowed(request.url(), isMainNavigation ? 'navigation' : 'resource');
      } catch (error) {
        if (isMainNavigation && error instanceof WebpageUrlPolicyError) {
          mainNavigationPolicyError = request.redirectedFrom()
            ? new WebpageUrlPolicyError('WEBPAGE_REDIRECT_BLOCKED', 'Webpage redirect destination is not allowed')
            : error;
        }
        await route.abort('blockedbyclient').catch(() => {});
        return;
      }
      await route.continue().catch(() => {});
    });
    let response: Response | null;
    try {
      response = await page.goto(sourceUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
    } catch (error) {
      if (mainNavigationPolicyError) throw mainNavigationPolicyError;
      throw error;
    }

    if (!response) {
      throw new Error('Webpage request failed with status 0');
    }

    if (!response.ok()) {
      throw new Error(`Webpage request failed with status ${response.status()}`);
    }

    const contentType = response.headers()['content-type'];
    if (!isHtmlContentType(contentType)) {
      throw new Error(`Webpage URL did not return HTML content (${contentType})`);
    }
    const contentLength = Number(response.headers()['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_MAIN_DOCUMENT_BYTES) {
      throw new Error(`Webpage response exceeded ${MAX_MAIN_DOCUMENT_BYTES} bytes`);
    }

    await page.waitForTimeout(750);
    await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});

    const finalUrl = page.url() || response.url() || sourceUrl;
    await assertWebpageUrlAllowed(finalUrl, 'navigation');
    const title = ((await page.title()) || '').trim() || null;
    const screenshot = (await page.screenshot({
      type: 'png',
      fullPage: false,
    })) as Buffer;

    if (responseSizeExceeded) throw new Error(`Webpage response exceeded ${MAX_MAIN_DOCUMENT_BYTES} bytes`);
    if (deadlineExceeded) throw new Error('Webpage capture exceeded the 25 second total deadline');
    return {
      finalUrl,
      contentType,
      title,
      screenshot,
    };
  } catch (error) {
    if (responseSizeExceeded) throw new Error(`Webpage response exceeded ${MAX_MAIN_DOCUMENT_BYTES} bytes`);
    if (deadlineExceeded) throw new Error('Webpage capture exceeded the 25 second total deadline');
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    await cdp?.detach().catch(() => {});
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}
