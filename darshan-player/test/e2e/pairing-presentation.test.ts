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
    await session.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })

    const initialStatus = { state: 'PAIRED_RUNTIME', mode: 'default', online: true }
    await session.command('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          const presentationListeners = [];
          const playbackListeners = [];
          const defaultMediaListeners = [];
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
            onDefaultMediaChanged(listener) {
              defaultMediaListeners.push(listener);
              return () => {
                const index = defaultMediaListeners.indexOf(listener);
                if (index >= 0) defaultMediaListeners.splice(index, 1);
              };
            },
            getConfig: async () => ({ runtime: { mode: 'production' }, log: { level: 'info' } }),
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
            emitDefaultMedia(value) { defaultMediaListeners.forEach((listener) => listener(value)); },
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
        pairingExpiresAt: ${JSON.stringify(new Date(Date.now() + 10 * 60 * 1000).toISOString())},
        pairingRemainingMs: 600000, hostname: 'windows-kiosk-9'
      } })`
    )
    // Simulate a delayed initial IPC snapshot arriving after the live pairing
    // event. Its lower revision must not restore runtime/default content.
    await evaluate(
      session,
      "window.__darshanE2E.emitPresentation({ revision: 1, status: { state: 'PAIRED_RUNTIME', mode: 'default', online: true } })"
    )

    await waitFor(session, "document.getElementById('pairing-code')?.textContent === '2 2 2 2 2 2'", 'replacement OTP')
    await evaluate(session, `(() => {
      const originalNow = Date.now.bind(Date);
      Date.now = () => originalNow() + 60 * 60 * 1000;
      document.getElementById('pairing-screen').dataset.density = 'MINIMAL';
    })()`)
    const visibility = await evaluate(session, `(() => {
      const host = document.getElementById('pairing-hostname');
      const expiry = document.getElementById('pairing-expiry');
      return {
        hostname: host?.textContent,
        hostnameVisible: host && getComputedStyle(host).display !== 'none' && host.getBoundingClientRect().width > 0,
        countdown: expiry?.textContent,
        mode: document.body.dataset.runtimeMode,
      };
    })()`)
    expect(visibility.hostname).to.equal('windows-kiosk-9')
    expect(visibility.hostnameVisible).to.equal(true)
    expect(visibility.mode).to.equal('production')
    expect(visibility.countdown).to.match(/^Expires in (9:|10:)/)
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

    for (const [width, height] of [[1440, 900], [820, 768], [390, 844], [640, 360]]) {
      await session.command('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      })
      if (height === 360) {
        await evaluate(session, `(() => {
          document.getElementById('pairing-hostname').textContent =
            'darshan-player-east-wing-conference-floor-very-long-hostname-01'
          document.getElementById('pairing-status').textContent =
            'The backend is temporarily unavailable. Reconnecting and checking whether this pairing code is still active.'
        })()`)
      }
      await waitFor(session, `(() => {
        return ['pairing-hostname', 'pairing-code', 'pairing-expiry', 'pairing-status'].every((id) => {
          const rect = document.getElementById(id)?.getBoundingClientRect()
          return rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
            rect.right <= innerWidth && rect.bottom <= innerHeight
        })
      })()`, `pairing viewport settlement at ${width}x${height}`)
      const layout = await evaluate(session, `(() => {
        const ids = ['pairing-hostname', 'pairing-code', 'pairing-expiry', 'pairing-status']
        const outOfBounds = ids.filter((id) => {
          const element = document.getElementById(id)
          const rect = element?.getBoundingClientRect()
          return !(rect && rect.width > 0 && rect.height > 0 &&
            rect.left >= 0 && rect.top >= 0 &&
            rect.right <= innerWidth && rect.bottom <= innerHeight)
        })
        return {
          visible: outOfBounds.length === 0,
          outOfBounds,
          surface: getComputedStyle(document.getElementById('pairing-screen')).backgroundColor,
          operatorControlHidden: getComputedStyle(document.getElementById('pairing-refresh')).display === 'none',
        }
      })()`)
      expect(layout.visible, `pairing layout at ${width}x${height}: ${JSON.stringify(layout.outOfBounds)}`).to.equal(true)
      expect(layout).to.include({
        surface: 'rgb(248, 248, 243)',
        operatorControlHidden: true,
      })
      if (width === 1440 || width === 390) {
        const screenshot = await session.command('Page.captureScreenshot', { format: 'png' })
        const evidencePath = path.resolve(__dirname,
          `../../../qa-artifacts/evidence/product-ui-player-prototype/production-pairing-forest-${width}.png`)
        await fs.promises.writeFile(evidencePath, Buffer.from(screenshot.data as string, 'base64'))
      }
    }

    await session.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    const darkPairing = await evaluate(session, `(() => ({
      surface: getComputedStyle(document.getElementById('pairing-screen')).backgroundColor,
      otp: getComputedStyle(document.getElementById('pairing-code')).color,
    }))()`)
    expect(darkPairing).to.deep.equal({ surface: 'rgb(23, 34, 28)', otp: 'rgb(222, 231, 199)' })
    await session.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })

    await evaluate(session, `window.__darshanE2E.emitPresentation({ revision: 4, status: {
      state: 'RECOVERY_REQUIRED', mode: 'empty', online: false,
      recoveryReason: 'Device credentials require administrator attention'
    } })`)
    const recovery = await evaluate(session, `(() => {
      const element = document.getElementById('recovery-overlay')
      const rect = element.getBoundingClientRect()
      return {
        visible: !element.classList.contains('hidden'),
        pairingHidden: document.getElementById('pairing-screen').classList.contains('hidden'),
        fullScreen: rect.width === innerWidth && rect.height === innerHeight,
        reason: document.getElementById('recovery-reason').textContent,
        controlsHidden: getComputedStyle(document.getElementById('recovery-retry')).display === 'none',
        surface: getComputedStyle(element).backgroundColor,
      }
    })()`)
    expect(recovery).to.deep.equal({
      visible: true,
      pairingHidden: true,
      fullScreen: true,
      reason: 'Device credentials require administrator attention',
      controlsHidden: true,
      surface: 'rgb(248, 248, 243)',
    })

    // Operational labels must not cover normal production media, including
    // cached offline playback. The emergency interruption remains visible.
    await session.command('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    })
    for (const [revision, mode, state] of [
      [5, 'default', 'PAIRED_RUNTIME'],
      [6, 'offline', 'OFFLINE_USING_LAST_VALID_PAIRING'],
      [7, 'empty', 'SOFT_RECOVERY'],
    ] as const) {
      await evaluate(session, `window.__darshanE2E.emitPresentation({ revision: ${revision}, status: {
        state: '${state}', mode: '${mode}', online: false, backendAvailable: false
      } })`)
      const badges = await evaluate(session, `(() => {
        const hidden = (id) => getComputedStyle(document.getElementById(id)).display === 'none'
        return {
          status: hidden('status-overlay'),
          mode: hidden('mode-banner'),
          connectivity: hidden('connectivity-banner'),
        }
      })()`)
      expect(badges, `${state} production overlays`).to.deep.equal({
        status: true, mode: true, connectivity: true,
      })
      if (revision === 5) {
        await waitFor(session,
          "document.querySelector('.darshan-standby-artwork')?.naturalWidth > 0",
          'packaged standby artwork')
        const standby = await evaluate(session, `(() => ({
          name: document.querySelector('.darshan-standby-name')?.textContent,
          message: document.querySelector('.darshan-standby-message')?.textContent,
          unavailable: Boolean(document.querySelector('.darshan-default-unavailable')),
        }))()`)
        expect(standby).to.deep.equal({
          name: 'DARSHAN', message: 'No content assigned', unavailable: false,
        })
        expect(await evaluate(session, "getComputedStyle(document.querySelector('.darshan-standby')).backgroundColor"))
          .to.equal('rgb(248, 248, 243)')
        const screenshot = await session.command('Page.captureScreenshot', { format: 'png' })
        const evidencePath = path.resolve(__dirname,
          '../../../qa-artifacts/evidence/product-ui-player-prototype/production-playback-no-overlays.png')
        await fs.promises.writeFile(evidencePath, Buffer.from(screenshot.data as string, 'base64'))
        for (const [width, height] of [[820, 768], [390, 844]]) {
          await session.command('Emulation.setDeviceMetricsOverride', {
            width, height, deviceScaleFactor: 1, mobile: false,
          })
          const fitted = await evaluate(session, `(() => {
            return ['darshan-standby-artwork', 'darshan-standby-name', 'darshan-standby-message']
              .every((className) => {
                const rect = document.querySelector('.' + className)?.getBoundingClientRect()
                return rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 &&
                  rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
              })
          })()`)
          expect(fitted, `standby content fits at ${width}x${height}`).to.equal(true)
          if (width === 390) {
            const phoneScreenshot = await session.command('Page.captureScreenshot', { format: 'png' })
            const phonePath = path.resolve(__dirname,
              '../../../qa-artifacts/evidence/product-ui-player-prototype/production-standby-390.png')
            await fs.promises.writeFile(phonePath, Buffer.from(phoneScreenshot.data as string, 'base64'))
          }
        }
        await session.command('Emulation.setDeviceMetricsOverride', {
          width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
        })
        await session.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
        expect(await evaluate(session,
          "getComputedStyle(document.querySelector('.darshan-standby')).backgroundColor"))
          .to.equal('rgb(23, 34, 28)')
        const darkScreenshot = await session.command('Page.captureScreenshot', { format: 'png' })
        const darkPath = path.resolve(__dirname,
          '../../../qa-artifacts/evidence/product-ui-player-prototype/production-standby-dark-1440.png')
        await fs.promises.writeFile(darkPath, Buffer.from(darkScreenshot.data as string, 'base64'))
        await session.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
      }
    }

    await evaluate(session,
      "window.__darshanE2E.emitDefaultMedia({ source: 'GLOBAL', media_id: null, media: null })")
    const assignedButUnavailable = await evaluate(session, `(() => ({
      title: document.querySelector('.darshan-default-unavailable h1')?.textContent,
      standby: Boolean(document.querySelector('.darshan-standby')),
    }))()`)
    expect(assignedButUnavailable).to.deep.equal({ title: 'Content unavailable', standby: false })
    const unavailableScreenshot = await session.command('Page.captureScreenshot', { format: 'png' })
    const unavailablePath = path.resolve(__dirname,
      '../../../qa-artifacts/evidence/product-ui-player-prototype/production-default-unavailable.png')
    await fs.promises.writeFile(unavailablePath, Buffer.from(unavailableScreenshot.data as string, 'base64'))
    await evaluate(session,
      "window.__darshanE2E.emitDefaultMedia({ source: 'NONE', media_id: null, media: null })")

    await evaluate(session, `window.__darshanE2E.emitPresentation({ revision: 8, status: {
      state: 'PAIRED_RUNTIME', mode: 'emergency', online: true, backendAvailable: true
    } })`)
    const emergencyBanner = await evaluate(session,
      "getComputedStyle(document.getElementById('mode-banner')).display !== 'none' && document.getElementById('mode-banner').textContent === 'EMERGENCY'")
    expect(emergencyBanner).to.equal(true)
    const qaDiagnostics = await evaluate(session, `(() => {
      document.body.dataset.runtimeMode = 'qa'
      const visible = getComputedStyle(document.getElementById('status-overlay')).display !== 'none'
      document.body.dataset.runtimeMode = 'production'
      return visible
    })()`)
    expect(qaDiagnostics).to.equal(true)

    await evaluate(session, `window.__darshanE2E.emitPresentation({ revision: 9, status: {
      state: 'PAIRED_RUNTIME', mode: 'offline', online: false,
      securityLock: { locked: true, reason: 'Backend validation expired' }
    } })`)
    const lockVisible = await evaluate(session, `(() => {
      const lock = document.getElementById('security-lock-overlay')
      return getComputedStyle(lock).display !== 'none' &&
        lock.textContent.includes('Backend validation expired')
    })()`)
    expect(lockVisible).to.equal(true)
    const lockScreenshot = await session.command('Page.captureScreenshot', { format: 'png' })
    const lockPath = path.resolve(__dirname,
      '../../../qa-artifacts/evidence/product-ui-player-prototype/production-security-lock.png')
    await fs.promises.writeFile(lockPath, Buffer.from(lockScreenshot.data as string, 'base64'))

    // The live receiver keeps video black while its own unavailable state uses
    // the fixed Forest palette. No media connection is needed for this style check.
    const liveReceiverUrl = pathToFileURL(path.resolve(__dirname, '../../dist/renderer/live-receiver.html')).toString()
    await session.command('Page.navigate', { url: liveReceiverUrl })
    await waitFor(session, "document.getElementById('live-unavailable') !== null", 'live receiver document')
    const lightUnavailable = await evaluate(session, `(() => ({
      unavailable: getComputedStyle(document.getElementById('live-unavailable')).backgroundColor,
      videoStage: getComputedStyle(document.body).backgroundColor,
    }))()`)
    expect(lightUnavailable).to.deep.equal({
      unavailable: 'rgb(248, 248, 243)', videoStage: 'rgb(16, 16, 16)',
    })
    await session.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    expect(await evaluate(session,
      "getComputedStyle(document.getElementById('live-unavailable')).backgroundColor"))
      .to.equal('rgb(23, 34, 28)')
  })
})
