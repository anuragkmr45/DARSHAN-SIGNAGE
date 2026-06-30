type PdfJsModule = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (options: { url?: string; data?: Uint8Array; disableWorker?: boolean }) => {
    promise: Promise<{
      getPage: (pageNumber: number) => Promise<{
        getViewport: (options: { scale: number }) => { width: number; height: number };
        render: (options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
          promise: Promise<void>;
        };
      }>;
      destroy?: () => Promise<void>;
    }>;
    destroy?: () => Promise<void>;
  };
};

export const PDF_WORKER_SOURCE = './pdf.worker.mjs';

export function buildPdfPlaybackSource(source: string | undefined): string {
  return source || '';
}

function createStatusElement(message: string): HTMLDivElement {
  const status = document.createElement('div');
  status.textContent = message;
  status.style.position = 'absolute';
  status.style.inset = '0';
  status.style.display = 'flex';
  status.style.alignItems = 'center';
  status.style.justifyContent = 'center';
  status.style.padding = '16px';
  status.style.background = '#111827';
  status.style.color = '#f8fafc';
  status.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  status.style.fontSize = '14px';
  status.style.textAlign = 'center';
  return status;
}

async function loadPdfJs(): Promise<PdfJsModule> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule;
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SOURCE;
  }
  return pdfjs;
}

function isLocalPdfSource(source: string): boolean {
  try {
    const parsed = new URL(source);
    return parsed.protocol === 'file:' && parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

async function buildPdfDocumentOptions(source: string): Promise<{ url?: string; data?: Uint8Array }> {
  if (isLocalPdfSource(source) && window.darshan?.readPdfData) {
    const bytes = await window.darshan.readPdfData(source);
    return { data: new Uint8Array(bytes) };
  }

  return { url: source };
}

async function renderFirstPage(container: HTMLDivElement, source: string, canvas: HTMLCanvasElement): Promise<void> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument(await buildPdfDocumentOptions(source));
  const documentProxy = await loadingTask.promise;
  const page = await documentProxy.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(1, container.clientWidth || container.getBoundingClientRect().width || viewport.width);
  const availableHeight = Math.max(1, container.clientHeight || container.getBoundingClientRect().height || viewport.height);
  const fitScale = Math.max(0.1, Math.min(availableWidth / viewport.width, availableHeight / viewport.height));
  const scaledViewport = page.getViewport({ scale: fitScale });
  const outputScale = Math.max(1, window.devicePixelRatio || 1);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas rendering context unavailable');
  }

  canvas.width = Math.floor(scaledViewport.width * outputScale);
  canvas.height = Math.floor(scaledViewport.height * outputScale);
  canvas.style.width = `${Math.floor(scaledViewport.width)}px`;
  canvas.style.height = `${Math.floor(scaledViewport.height)}px`;
  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

  await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
  await documentProxy.destroy?.();
  await loadingTask.destroy?.();
}

export function createPdfPlaybackElement(source: string | undefined): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('title', 'PDF playback');
  container.style.position = 'absolute';
  container.style.inset = '0';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.background = '#000';

  const resolvedSource = buildPdfPlaybackSource(source);
  if (!resolvedSource) {
    container.appendChild(createStatusElement('PDF source unavailable'));
    return container;
  }

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.maxWidth = '100%';
  canvas.style.maxHeight = '100%';
  canvas.style.background = '#fff';
  container.appendChild(canvas);

  window.requestAnimationFrame(() => {
    renderFirstPage(container, resolvedSource, canvas)
      .then(() => {
        container.setAttribute('data-pdf-rendered', 'true');
      })
      .catch((error) => {
        window.darshan?.log?.('warn', 'PDF preview render failed', {
          reason: error instanceof Error ? error.message : String(error),
        });
        canvas.remove();
        container.appendChild(createStatusElement('PDF preview unavailable'));
        container.setAttribute('data-pdf-rendered', 'false');
      });
  });

  return container;
}
