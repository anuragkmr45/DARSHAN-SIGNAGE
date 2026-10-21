type PdfRenderTask = { promise: Promise<void>; cancel?: () => void }
type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number }
  render: (options: {
    canvasContext: CanvasRenderingContext2D
    viewport: { width: number; height: number }
  }) => PdfRenderTask
  cleanup?: () => void
}
type PdfDocument = {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPage>
  destroy?: () => Promise<void>
}
type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (options: { url?: string; data?: Uint8Array; disableWorker?: boolean }) => {
    promise: Promise<PdfDocument>
    destroy?: () => Promise<void>
  }
}

export type PdfPlaybackErrorCode = 'INVALID_DOCUMENT_PAGE' | 'DOCUMENT_PAGE_OUT_OF_RANGE' | 'PDF_RENDER_FAILED'

export interface PdfPlaybackErrorDetail {
  code: PdfPlaybackErrorCode
  message: string
  requestedPage: number
  actualPageCount: number | null
  itemId?: string
  mediaId?: string
  snapshotId?: string
}

export interface PdfPlaybackContext {
  itemId?: string
  mediaId?: string
  snapshotId?: string
}

export class PdfPlaybackError extends Error {
  constructor(public readonly detail: PdfPlaybackErrorDetail) {
    super(detail.message)
    this.name = 'PdfPlaybackError'
  }
}

export const PDF_WORKER_SOURCE = './pdf.worker.mjs'
// Each rendered page has a front and a back canvas. The process-wide budget
// bounds aggregate raster memory when a multi-slot layout contains PDFs.
export const PDF_MAX_RASTER_PIXELS = 32 * 1024 * 1024
let reservedPdfRasterPixels = 0

export function buildPdfPlaybackSource(source: string | undefined): string {
  return source || ''
}

export function validatePdfPageSelection(pageNumber: number, pageCount: number): void {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw new PdfPlaybackError({
      code: 'INVALID_DOCUMENT_PAGE',
      message: `Selected document page ${pageNumber} is invalid.`,
      requestedPage: pageNumber,
      actualPageCount: Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : null,
    })
  }
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageNumber > pageCount) {
    throw new PdfPlaybackError({
      code: 'DOCUMENT_PAGE_OUT_OF_RANGE',
      message: `Selected document page ${pageNumber} does not exist. This document contains ${pageCount} pages.`,
      requestedPage: pageNumber,
      actualPageCount: Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : null,
    })
  }
}

function createStatusElement(message: string): HTMLDivElement {
  const status = document.createElement('div')
  status.textContent = message
  status.style.position = 'absolute'
  status.style.inset = '0'
  status.style.display = 'flex'
  status.style.alignItems = 'center'
  status.style.justifyContent = 'center'
  status.style.padding = '16px'
  status.style.background = '#111827'
  status.style.color = '#f8fafc'
  status.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  status.style.fontSize = '14px'
  status.style.textAlign = 'center'
  status.style.whiteSpace = 'pre-line'
  return status
}

async function loadPdfJs(): Promise<PdfJsModule> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SOURCE
  return pdfjs
}

function isLocalPdfSource(source: string): boolean {
  try {
    const parsed = new URL(source)
    return parsed.protocol === 'file:' && parsed.pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

async function buildPdfDocumentOptions(source: string): Promise<{ url?: string; data?: Uint8Array }> {
  if (isLocalPdfSource(source) && window.darshan?.readPdfData) {
    return { data: new Uint8Array(await window.darshan.readPdfData(source)) }
  }
  return { url: source }
}

type ManagedPdfElement = HTMLDivElement & { __darshanCleanup?: () => void }

/** Keeps one PDF document alive while its slot changes size. */
class PdfPlaybackController {
  private disposed = false
  private renderTask?: PdfRenderTask
  private loadingTask?: ReturnType<PdfJsModule['getDocument']>
  private documentProxy?: PdfDocument
  private resizeObserver?: ResizeObserver
  private renderFrame?: number
  private lastSize = ''
  private backBuffer?: HTMLCanvasElement
  private reservedPixels = 0
  private renderGeneration = 0

  constructor(
    private readonly container: ManagedPdfElement,
    private readonly source: string,
    private readonly canvas: HTMLCanvasElement,
    private readonly pageNumber: number,
    private readonly context: PdfPlaybackContext
  ) {}

  start(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleRender())
      this.resizeObserver.observe(this.container)
    }
    this.scheduleRender()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.resizeObserver?.disconnect()
    if (this.renderFrame !== undefined) window.cancelAnimationFrame(this.renderFrame)
    this.releaseRasterBudget()
    try {
      this.renderTask?.cancel?.()
    } catch {
      // PDF.js may settle a render while it is being cancelled.
    }
    void this.documentProxy?.destroy?.().catch(() => undefined)
    void this.loadingTask?.destroy?.().catch(() => undefined)
  }

  private scheduleRender(): void {
    if (this.disposed) return
    if (this.renderFrame !== undefined) window.cancelAnimationFrame(this.renderFrame)
    this.renderFrame = window.requestAnimationFrame(() => {
      this.renderFrame = undefined
      void this.render()
    })
  }

  private async loadDocument(): Promise<PdfDocument> {
    if (this.documentProxy) return this.documentProxy
    const pdfjs = await loadPdfJs()
    if (this.disposed) throw new Error('PDF controller disposed')
    this.loadingTask = pdfjs.getDocument(await buildPdfDocumentOptions(this.source))
    this.documentProxy = await this.loadingTask.promise
    return this.documentProxy
  }

  private async render(): Promise<void> {
    try {
      const documentProxy = await this.loadDocument()
      if (this.disposed) return
      validatePdfPageSelection(this.pageNumber, documentProxy.numPages)
      const page = await documentProxy.getPage(this.pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const rect = this.container.getBoundingClientRect()
      const width = Math.max(1, rect.width || this.container.clientWidth || viewport.width)
      const height = Math.max(1, rect.height || this.container.clientHeight || viewport.height)
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const signature = `${Math.round(width)}x${Math.round(height)}@${dpr}`
      if (signature === this.lastSize) return
      this.lastSize = signature
      const scale = Math.max(0.1, Math.min(width / viewport.width, height / viewport.height))
      const scaledViewport = page.getViewport({ scale })
      const renderScale = this.reserveRasterScale(scaledViewport.width, scaledViewport.height, dpr)
      const backBuffer = this.backBuffer || document.createElement('canvas')
      this.backBuffer = backBuffer
      const context = backBuffer.getContext('2d')
      if (!context) throw new Error('Canvas rendering context unavailable')
      try {
        this.renderTask?.cancel?.()
      } catch {
        // already completed/cancelled
      }
      const renderGeneration = ++this.renderGeneration
      backBuffer.width = Math.max(1, Math.floor(scaledViewport.width * renderScale))
      backBuffer.height = Math.max(1, Math.floor(scaledViewport.height * renderScale))
      context.setTransform(renderScale, 0, 0, renderScale, 0, 0)
      this.renderTask = page.render({ canvasContext: context, viewport: scaledViewport })
      await this.renderTask.promise
      if (this.disposed || renderGeneration !== this.renderGeneration) return
      // Render offscreen first, then commit in one draw. This keeps the prior
      // frame visible throughout a resize and avoids a black/partial PDF page.
      this.canvas.width = backBuffer.width
      this.canvas.height = backBuffer.height
      this.canvas.style.width = `${Math.floor(scaledViewport.width)}px`
      this.canvas.style.height = `${Math.floor(scaledViewport.height)}px`
      const visibleContext = this.canvas.getContext('2d')
      if (!visibleContext) throw new Error('Canvas rendering context unavailable')
      visibleContext.setTransform(1, 0, 0, 1, 0, 0)
      visibleContext.clearRect(0, 0, this.canvas.width, this.canvas.height)
      visibleContext.drawImage(backBuffer, 0, 0)
      if (!this.disposed) {
        this.container.setAttribute('data-pdf-rendered', 'true')
        this.container.dispatchEvent(new Event('darshan-pdf-rendered'))
      }
      page.cleanup?.()
    } catch (error) {
      if (this.disposed) return
      if (error instanceof Error && error.name === 'RenderingCancelledException') return
      const detail: PdfPlaybackErrorDetail = error instanceof PdfPlaybackError
        ? { ...error.detail, ...this.context }
        : {
            code: 'PDF_RENDER_FAILED',
            message: error instanceof Error ? error.message : String(error),
            requestedPage: this.pageNumber,
            actualPageCount: null,
            ...this.context,
          }
      window.darshan?.log?.('warn', 'PDF preview render failed', detail)
      this.canvas.remove()
      const visibleReason = detail.code === 'DOCUMENT_PAGE_OUT_OF_RANGE' || detail.code === 'INVALID_DOCUMENT_PAGE'
        ? detail.message
        : 'The document could not be displayed.'
      this.container.appendChild(createStatusElement(`Unavailable\n${visibleReason}`))
      this.container.setAttribute('data-pdf-rendered', 'false')
      this.container.dispatchEvent(new CustomEvent<PdfPlaybackErrorDetail>('darshan-pdf-error', { detail }))
      this.dispose()
    }
  }

  private reserveRasterScale(width: number, height: number, requestedScale: number): number {
    this.releaseRasterBudget()
    const cssPixels = Math.max(1, width * height)
    // Two canvases are held during a frame commit. Reserve both before render;
    // if other slots already use budget, reduce density rather than allocating
    // unbounded backing stores.
    const availableForBoth = Math.max(2, PDF_MAX_RASTER_PIXELS - reservedPdfRasterPixels)
    const perCanvasLimit = Math.max(1, Math.floor(availableForBoth / 2))
    const minimumScale = 1 / Math.max(1, width, height)
    const boundedScale = Math.max(minimumScale, Math.min(requestedScale, Math.sqrt(perCanvasLimit / cssPixels)))
    const pixelsPerCanvas = Math.max(1, Math.floor(cssPixels * boundedScale * boundedScale))
    this.reservedPixels = pixelsPerCanvas * 2
    reservedPdfRasterPixels += this.reservedPixels
    return boundedScale
  }

  private releaseRasterBudget(): void {
    if (this.reservedPixels <= 0) return
    reservedPdfRasterPixels = Math.max(0, reservedPdfRasterPixels - this.reservedPixels)
    this.reservedPixels = 0
  }
}

export function createPdfPlaybackElement(
  source: string | undefined,
  pageNumber: number = 1,
  context: PdfPlaybackContext = {}
): HTMLElement {
  const container = document.createElement('div') as ManagedPdfElement
  container.setAttribute('title', 'PDF playback')
  container.style.position = 'absolute'
  container.style.inset = '0'
  container.style.width = '100%'
  container.style.height = '100%'
  container.style.overflow = 'hidden'
  container.style.display = 'flex'
  container.style.alignItems = 'center'
  container.style.justifyContent = 'center'
  container.style.background = '#000'
  const resolvedSource = buildPdfPlaybackSource(source)
  if (!resolvedSource) {
    container.appendChild(createStatusElement('Unavailable\nPDF source unavailable.'))
    return container
  }
  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.maxWidth = '100%'
  canvas.style.maxHeight = '100%'
  canvas.style.background = '#fff'
  container.appendChild(canvas)
  const controller = new PdfPlaybackController(container, resolvedSource, canvas, pageNumber, context)
  container.__darshanCleanup = () => controller.dispose()
  controller.start()
  return container
}
