import { expect } from 'chai'
import { spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { pathToFileURL } from 'url'
import WebSocket from 'ws'

type CdpResponse = {
  id?: number
  result?: Record<string, unknown>
  error?: { message: string }
}

const CHROMIUM_DEBUGGER_STARTUP_TIMEOUT_MS = 15_000

class CdpSession {
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: CdpResponse) => void; reject: (error: Error) => void }
  >()

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as CdpResponse
      if (typeof message.id !== 'number') return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message))
      } else {
        pending.resolve(message)
      }
    })
  }

  command(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (message) => resolve(message.result || {}),
        reject,
      })
    })
  }

  close(): void {
    this.socket.close()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a Chromium debugging port')
  }
  return address.port
}

async function waitForTarget(
  port: number,
  browser: ChildProcess,
  getDiagnostics: () => string
): Promise<{ webSocketDebuggerUrl: string }> {
  let lastError = 'Chromium did not expose a debugging target'
  const deadline = Date.now() + CHROMIUM_DEBUGGER_STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (browser.exitCode !== null) {
      throw new Error(
        `Chromium exited before exposing a debugging target (exit ${browser.exitCode}). ${getDiagnostics()}`
      )
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`)
      const targets = (await response.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page?.webSocketDebuggerUrl) return { webSocketDebuggerUrl: page.webSocketDebuggerUrl }
      lastError = 'Chromium started without a page debugging target'
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(50)
  }
  throw new Error(
    `Chromium did not expose a debugging target within ${CHROMIUM_DEBUGGER_STARTUP_TIMEOUT_MS}ms: ${lastError}. ${getDiagnostics()}`
  )
}

async function closeBrowser(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`)
  const version = (await response.json()) as { webSocketDebuggerUrl?: string }
  if (!version.webSocketDebuggerUrl) return

  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })))
    socket.once('message', () => {
      socket.close()
      resolve()
    })
    socket.once('error', reject)
  })
}

async function evaluate(session: CdpSession, expression: string): Promise<unknown> {
  const result = await session.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  const evaluation = result.result as { value?: unknown; exceptionDetails?: unknown } | undefined
  if (evaluation?.exceptionDetails) {
    throw new Error(`Browser evaluation failed: ${JSON.stringify(evaluation.exceptionDetails)}`)
  }
  return evaluation?.value
}

async function waitFor(session: CdpSession, expression: string, description: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(session, expression)) return
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

function browserExecutable(): string {
  const configured = process.env.DARSHAN_E2E_CHROMIUM
  if (configured) return configured
  if (fs.existsSync('/snap/bin/chromium')) return '/snap/bin/chromium'
  throw new Error('Set DARSHAN_E2E_CHROMIUM to a Chromium-family browser executable for the browser test.')
}

describe('Pairing presentation browser regression', () => {
  let browser: ChildProcess | undefined
  let session: CdpSession | undefined
  let profileDir: string | undefined
  let debugPort: number | undefined
  let browserDiagnostics = ''

  afterEach(async () => {
    session?.close()
    session = undefined
    if (debugPort !== undefined) {
      await closeBrowser(debugPort).catch(() => undefined)
      debugPort = undefined
    }
    browser = undefined
    browserDiagnostics = ''
    if (profileDir) {
      await fs.promises.rm(profileDir, { recursive: true, force: true })
      profileDir = undefined
    }
  })

  it('makes a replacement OTP the only primary surface after recovery cleanup', async () => {
    const port = await freePort()
    debugPort = port
    profileDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'darshan-player-e2e-'))
    browser = spawn(
      browserExecutable(),
      [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--remote-allow-origins=*',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    browser.stderr?.on('data', (chunk: Buffer) => {
      browserDiagnostics = `${browserDiagnostics}${chunk.toString()}`.slice(-8_000)
    })

    const target = await waitForTarget(port, browser, () => browserDiagnostics.trim() || 'No Chromium stderr captured')
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    session = new CdpSession(socket)
    await session.command('Page.enable')
    await session.command('Runtime.enable')

    const initialStatus = { state: 'PAIRED_RUNTIME', mode: 'default', online: true }
    await session.command('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          const presentationListeners = [];
          const playbackListeners = [];
          const initialStatus = ${JSON.stringify(initialStatus)};
          const noOp = () => undefined;
          window.darshan = {
            onPlayerPresentation(listener) {
              presentationListeners.push(listener);
              return () => {
                const index = presentationListeners.indexOf(listener);
                if (index >= 0) presentationListeners.splice(index, 1);
              };
            },
            getPlayerPresentation: async () => ({ revision: 1, status: initialStatus }),
            onPlaybackUpdate(listener) { playbackListeners.push(listener); },
            onMediaChange: noOp,
            onEmergencyOverride: noOp,
            onPlayerStatus: noOp,
            getDefaultMedia: async () => ({ source: 'NONE', aspect_ratio: null, media_id: null, media: null }),
            onDefaultMediaChanged: () => () => undefined,
            getConfig: async () => ({ log: { level: 'info' } }),
            getDeviceInfo: async () => ({ hostname: 'e2e-player', platform: 'linux', arch: 'x64' }),
            getDiagnostics: async () => ({ hostname: 'e2e-player', ipAddresses: ['127.0.0.1'], dnsResolution: true, apiReachable: true, latency: 1 }),
            playerAction: async () => undefined,
            completePairing: async () => null,
            log: noOp,
            reportActivePlayback: noOp,
            reportPlaybackProgress: noOp,
            getPlaybackResumeState: async () => null,
            readPdfData: async () => new ArrayBuffer(0),
          };
          window.__darshanE2E = {
            emitPresentation(value) { presentationListeners.forEach((listener) => listener(value)); },
            emitPlayback(value) { playbackListeners.forEach((listener) => listener(value)); },
          };
        })();
      `,
    })

    const rendererUrl = pathToFileURL(path.resolve(__dirname, '../../dist/renderer/index.html')).toString()
    await session.command('Page.navigate', { url: rendererUrl })
    await waitFor(
      session,
      "document.getElementById('default-media-container')?.classList.contains('hidden') === false",
      'default surface'
    )
    await waitFor(session, "document.getElementById('device-label')?.value === 'e2e-player'", 'pairing controller')

    // This is the observed failure ordering: cleanup during recovery, followed
    // by a newly issued OTP. Old code selected the default/paired-idle surface.
    await evaluate(session, "window.__darshanE2E.emitPlayback({ type: 'clear-active', reason: 'timeline-stopped' })")
    await evaluate(
      session,
      "window.__darshanE2E.emitPresentation({ revision: 2, status: { state: 'HARD_RECOVERY', mode: 'empty', online: false, error: 'OTP expired' } })"
    )
    await evaluate(
      session,
      `window.__darshanE2E.emitPresentation({ revision: 3, status: {
        state: 'PAIRING_PENDING', mode: 'empty', online: false, pairingCode: '222222',
        pairingExpiresAt: ${JSON.stringify(new Date(Date.now() + 10 * 60 * 1000).toISOString())}
      } })`
    )
    // Simulate a delayed initial IPC snapshot arriving after the live pairing
    // event. Its lower revision must not restore runtime/default content.
    await evaluate(
      session,
      "window.__darshanE2E.emitPresentation({ revision: 1, status: { state: 'PAIRED_RUNTIME', mode: 'default', online: true } })"
    )

    await waitFor(session, "document.getElementById('pairing-code')?.textContent === '2 2 2 2 2 2'", 'replacement OTP')
    const result = await evaluate(
      session,
      `(() => {
        const hidden = (id) => document.getElementById(id)?.classList.contains('hidden') === true;
        const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        return {
          pairingVisible: !hidden('pairing-screen'),
          playbackHidden: hidden('playback-container'),
          defaultHidden: hidden('default-media-container'),
          statusHidden: hidden('status-overlay'),
          bannerHidden: hidden('mode-banner'),
          falsePairedCopy: document.body.innerText.includes('Screen paired successfully. No content assigned yet.'),
          topSurface: center?.closest('#pairing-screen, #recovery-overlay, #default-media-container, #playback-container')?.id,
        };
      })()`
    )

    expect(result).to.deep.equal({
      pairingVisible: true,
      playbackHidden: true,
      defaultHidden: true,
      statusHidden: true,
      bannerHidden: true,
      falsePairedCopy: false,
      topSurface: 'pairing-screen',
    })
  })
})
