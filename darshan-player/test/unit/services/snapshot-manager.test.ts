/**
 * Unit tests for snapshot manager offline fallback
 */

const { expect } = require('chai')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils.ts')

function clearRuntimeModuleCache() {
  Object.keys(require.cache).forEach((key) => {
    const normalizedKey = key.replace(/\\/g, '/')
    if (normalizedKey.includes('src/main/services') || normalizedKey.includes('src/common')) {
      delete require.cache[key]
    }
  })
}

describe('Snapshot Manager', () => {
  let tempDir: string
  let cacheDir: string
  let sandbox: sinon.SinonSandbox
  let clock: sinon.SinonFakeTimers | undefined

  beforeEach(() => {
    clearRuntimeModuleCache()
    sandbox = sinon.createSandbox()
    tempDir = createTempDir('snapshot-test-')
    cacheDir = path.join(tempDir, 'cache')
    fs.mkdirSync(cacheDir, { recursive: true })

    process.env.HEXMON_CONFIG_PATH = path.join(tempDir, 'config.json')
    const testConfig = {
      apiBase: 'https://api-test.darshan.com',
      wsUrl: 'wss://api-test.darshan.com/ws',
      deviceId: 'device-123',
      cache: {
        path: cacheDir,
        maxBytes: 10485760,
      },
      intervals: {
        heartbeatMs: 30000,
        commandPollMs: 30000,
        schedulePollMs: 60000,
        healthCheckMs: 60000,
        screenshotMs: 300000,
      },
      mtls: {
        enabled: false,
        certPath: path.join(tempDir, 'client.crt'),
        keyPath: path.join(tempDir, 'client.key'),
        caPath: path.join(tempDir, 'ca.crt'),
      },
    }
    fs.writeFileSync(process.env.HEXMON_CONFIG_PATH, JSON.stringify(testConfig, null, 2))
  })

  afterEach(() => {
    clock?.restore()
    clock = undefined
    sandbox.restore()
    cleanupTempDir(tempDir)
    delete process.env.HEXMON_CONFIG_PATH

    clearRuntimeModuleCache()
  })

  it('reports an exact publish as applied after persistence when required media is ready', async () => {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    sandbox.stub(getHttpClient(), 'getResponse').resolves({
      status: 200,
      data: {
        publish: {
          publish_id: '11111111-1111-4111-8111-111111111111',
          snapshot_id: '22222222-2222-4222-8222-222222222222',
        },
        content_state: 'scheduled',
        snapshot: {
          id: '22222222-2222-4222-8222-222222222222',
          schedule: {
            id: '33333333-3333-4333-8333-333333333333',
            items: [{ id: 'message-1', type: 'message', message: 'Ready' }],
          },
        },
      },
    })
    const { getHeartbeatService } = require('../../../src/main/services/telemetry/heartbeat')
    const heartbeat = getHeartbeatService()
    const applied = sandbox.stub(heartbeat, 'setAppliedSnapshot')
    const immediate = sandbox.stub(heartbeat, 'sendImmediate').resolves()

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const playlist = await getSnapshotManager().refreshSnapshot()

    expect(playlist?.publishId).to.equal('11111111-1111-4111-8111-111111111111')
    expect(applied.calledOnceWithExactly(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )).to.equal(true)
    expect(immediate.calledOnce).to.equal(true)
    const persisted = JSON.parse(fs.readFileSync(path.join(cacheDir, 'last-snapshot.json'), 'utf8'))
    expect(persisted.publish.publish_id).to.equal('11111111-1111-4111-8111-111111111111')
  })

  it('does not confirm a publish when required media could not be cached', async () => {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    sandbox.stub(getHttpClient(), 'getResponse').resolves({
      status: 200,
      data: {
        publish: {
          publish_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          snapshot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
        content_state: 'scheduled',
        snapshot: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          schedule: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', items: [] },
          items: [{ id: 'image-1', media_id: 'media-1', type: 'image', media_url: 'https://invalid.example/image.jpg' }],
        },
      },
    })
    const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
    sandbox.stub(getCacheManager(), 'prefetch').resolves()
    sandbox.stub(getCacheManager(), 'has').resolves(false)
    const { getHeartbeatService } = require('../../../src/main/services/telemetry/heartbeat')
    const heartbeat = getHeartbeatService()
    const applied = sandbox.stub(heartbeat, 'setAppliedSnapshot')
    const immediate = sandbox.stub(heartbeat, 'sendImmediate').resolves()

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    await getSnapshotManager().refreshSnapshot()

    expect(applied.called).to.equal(false)
    expect(immediate.called).to.equal(false)
  })

  it('does not fetch a retired webpage URL or its old preview while applying a snapshot', async () => {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    sandbox.stub(getHttpClient(), 'getResponse').resolves({
      status: 200,
      data: {
        publish: { publish_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', snapshot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        content_state: 'scheduled',
        snapshot: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          schedule: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', items: [] },
          items: [{ id: 'old-page', media_id: 'old-page', type: 'url', url: 'https://legacy.example.test/live', fallback_url: 'https://cdn.example.test/preview.png' }],
        },
      },
    })
    const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
    const prefetch = sandbox.stub(getCacheManager(), 'prefetch').resolves()
    const has = sandbox.stub(getCacheManager(), 'has')

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const playlist = await getSnapshotManager().refreshSnapshot()

    expect(prefetch.calledOnceWithExactly([])).to.equal(true)
    expect(has.called).to.equal(false)
    expect(playlist?.items[0]?.type).to.equal('url')
    expect(playlist?.items[0]?.remoteUrl).to.equal(undefined)
    expect(playlist?.items[0]?.localUrl).to.equal(undefined)
  })

  it('should treat a 404 snapshot response as intentional no-content instead of offline fallback', async () => {
    const mediaDir = path.join(cacheDir, 'media')
    fs.mkdirSync(mediaDir, { recursive: true })

    const snapshotFile = path.join(cacheDir, 'last-snapshot.json')
    fs.writeFileSync(
      snapshotFile,
      JSON.stringify({
        id: 'snap-1',
        schedule: {
          id: 'sched-1',
          items: [
            {
              id: 'item-1',
              media_id: 'media-1',
              display_ms: 10000,
              type: 'image',
              media_url: 'https://cdn.example.com/media-1.jpg',
            },
          ],
        },
        media_urls: {
          'media-1': 'https://cdn.example.com/media-1.jpg',
        },
      })
    )

    fs.writeFileSync(path.join(mediaDir, 'media-1.jpg'), Buffer.from('cached'))

    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const httpClient = getHttpClient()
    sandbox.stub(httpClient, 'getResponse').rejects({ response: { status: 404 } })

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()

    const playlist = await snapshotManager.refreshSnapshot()

    expect(playlist?.mode).to.equal('empty')
    expect(playlist?.items).to.deep.equal([])
  })

  it('should treat a successful empty snapshot as a valid empty playback state', async () => {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const httpClient = getHttpClient()
    sandbox.stub(httpClient, 'getResponse').resolves({
      status: 200,
      data: {
        device_id: 'device-123',
        publish: null,
        snapshot: null,
        media_urls: undefined,
        emergency: null,
        default_media: null,
        default_media_resolution: {
          source: 'NONE',
          aspect_ratio: '16:9',
        },
      },
    })

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()

    const playlist = await snapshotManager.refreshSnapshot()

    expect(playlist?.mode).to.equal('empty')
    expect(playlist?.items).to.deep.equal([])
    expect(snapshotManager.getLastError()).to.equal(undefined)
  })

  it('blocks normal snapshot refreshes while locked and permits only an explicit secure-recovery refresh', async () => {
    const configured = JSON.parse(fs.readFileSync(process.env.HEXMON_CONFIG_PATH, 'utf8'))
    configured.security = {
      offlinePlaybackPolicy: 'secure',
      backendRequiredForPlayback: true,
      playbackLeaseMs: 120000,
    }
    fs.writeFileSync(process.env.HEXMON_CONFIG_PATH, JSON.stringify(configured, null, 2))

    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const httpClient = getHttpClient()
    const getResponse = sandbox.stub(httpClient, 'getResponse').resolves({
      status: 200,
      data: {
        device_id: 'device-123',
        content_state: 'empty',
        snapshot: null,
        emergency: null,
        default_media: null,
      },
    })

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()

    expect(await snapshotManager.refreshSnapshot()).to.equal(null)
    expect(getResponse.called).to.equal(false)

    const recovered = await snapshotManager.refreshSnapshot({
      force: true,
      allowWhileSecurityLocked: true,
    })
    expect(recovered?.mode).to.equal('empty')
    expect(getResponse.calledOnce).to.equal(true)
  })

  it('should expire a message emergency locally while offline', async () => {
    const baseTime = new Date('2026-09-07T10:00:00.000Z')
    clock = sandbox.useFakeTimers({ now: baseTime, shouldAdvanceTime: false })

    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const httpClient = getHttpClient()
    sandbox.stub(httpClient, 'getResponse').resolves({
      status: 200,
      headers: { etag: 'W/"message-emergency-v1"' },
      data: {
        server_time: baseTime.toISOString(),
        content_state: 'empty',
        snapshot: null,
        emergency: {
          id: 'emergency-message-1',
          active: true,
          kind: 'MESSAGE',
          message: 'Evacuate now.',
          severity: 'CRITICAL',
          version: 'emergency-message-1:1',
          expires_at: '2026-09-07T10:00:01.000Z',
        },
      },
    })

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()
    const initial = await snapshotManager.refreshSnapshot()
    expect(initial?.mode).to.equal('emergency')
    expect(initial?.items[0]?.type).to.equal('message')

    await clock.tickAsync(1000)
    expect(snapshotManager.getCurrentPlaylist()?.mode).to.equal('empty')
    expect(snapshotManager.getCurrentPlaylist()?.items).to.deep.equal([])
  })

  it('should store the response ETag separately and force transition refreshes unconditionally', async () => {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const httpClient = getHttpClient()
    const getResponse = sandbox.stub(httpClient, 'getResponse')
    getResponse.onFirstCall().resolves({
      status: 200,
      headers: { etag: 'W/"representation-a"' },
      data: {
        server_time: new Date().toISOString(),
        content_state: 'empty',
        snapshot: null,
        emergency: null,
        default_media: null,
      },
    })
    getResponse.onSecondCall().resolves({ status: 304, headers: {}, data: null })
    getResponse.onThirdCall().resolves({
      status: 200,
      headers: { etag: 'W/"representation-b"' },
      data: {
        server_time: new Date().toISOString(),
        content_state: 'empty',
        snapshot: null,
        emergency: null,
        default_media: null,
      },
    })

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()
    await snapshotManager.refreshSnapshot()
    await snapshotManager.refreshSnapshot()
    await snapshotManager.refreshSnapshot({ force: true })

    expect(getResponse.secondCall.args[1]?.headers).to.deep.equal({
      'If-None-Match': 'W/"representation-a"',
    })
    expect(getResponse.thirdCall.args[1]?.headers).to.equal(undefined)
  })

  it('should schedule an immediate forced refresh for an already-expired persisted signed URL', () => {
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()
    const issuedAt = new Date(Date.now() - 20 * 60 * 1000)
    const signatureDate = issuedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const expiredUrl = `https://cdn.example.test/object.png?X-Amz-Date=${signatureDate}&X-Amz-Expires=600`
    const refreshAt = (snapshotManager as any).findSignedUrlRefreshAt({
      items: [{ remoteUrl: expiredUrl }],
      scheduleWindows: [],
    })

    expect(refreshAt).to.be.a('number')
    expect(refreshAt).to.be.lessThanOrEqual(Date.now())
  })

  it('should locally switch from default fallback to an active schedule window when the boundary is reached', async () => {
    const baseTime = new Date('2026-03-14T09:00:00.000Z')
    clock = sandbox.useFakeTimers({ now: baseTime, shouldAdvanceTime: false })

    const mediaDir = path.join(cacheDir, 'media')
    fs.mkdirSync(mediaDir, { recursive: true })

    const snapshotFile = path.join(cacheDir, 'last-snapshot.json')
    fs.writeFileSync(
      snapshotFile,
      JSON.stringify({
        publish_id: 'publish-local-window',
        snapshot_id: 'snap-local-window',
        schedule: {
          id: 'sched-window',
          timezone: 'UTC',
          items: [
            {
              id: 'window-1',
              start_at: '2026-03-14T09:00:01.000Z',
              end_at: '2026-03-14T09:10:00.000Z',
              priority: 10,
              presentation: {
                id: 'presentation-1',
                name: 'Morning Takeover',
                items: [
                  {
                    id: 'presentation-item-1',
                    media_id: 'media-1',
                    order: 0,
                    duration_seconds: 15,
                    media: {
                      id: 'media-1',
                      name: 'Morning Asset',
                      type: 'VIDEO',
                    },
                  },
                ],
              },
            },
          ],
        },
        default_media: {
          id: 'media-default',
          type: 'image',
          display_ms: 12000,
          media_url: 'https://cdn.example.com/default.jpg',
        },
        media_urls: {
          'media-1': 'https://cdn.example.com/morning.mp4',
          'media-default': 'https://cdn.example.com/default.jpg',
        },
      })
    )

    fs.writeFileSync(path.join(mediaDir, 'media-1.mp4'), Buffer.from('scheduled'))
    fs.writeFileSync(path.join(mediaDir, 'media-default.jpg'), Buffer.from('default'))

    const { getHeartbeatService } = require('../../../src/main/services/telemetry/heartbeat')
    const heartbeat = getHeartbeatService()
    const clearApplied = sandbox.spy(heartbeat, 'clearAppliedSnapshot')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()

    await clock.tickAsync(0)

    const initialPlaylist = snapshotManager.getCurrentPlaylist()
    expect(initialPlaylist?.mode).to.equal('default')
    expect((heartbeat as any).appliedPublishId).to.equal('publish-local-window')
    expect(initialPlaylist?.items.map((item: any) => item.mediaId)).to.deep.equal(['media-default'])

    await clock.tickAsync(1000)

    const transitionedPlaylist = snapshotManager.getCurrentPlaylist()
    expect(transitionedPlaylist?.mode).to.equal('normal')
    expect(transitionedPlaylist?.items[0]?.type).to.equal('video')
    expect(transitionedPlaylist?.items.map((item: any) => item.mediaId)).to.deep.equal(['media-1'])
    expect((heartbeat as any).appliedPublishId).to.equal('publish-local-window')

    await clock.tickAsync(9 * 60 * 1000 + 59 * 1000)

    const postWindowPlaylist = snapshotManager.getCurrentPlaylist()
    expect(postWindowPlaylist?.mode).to.equal('default')
    expect(postWindowPlaylist?.items.map((item: any) => item.mediaId)).to.deep.equal(['media-default'])
    expect((heartbeat as any).appliedPublishId).to.equal('publish-local-window')
    expect(clearApplied.called).to.equal(false)
  })

  it('should synthesize a layout scene for slot-based active schedule windows', async () => {
    const baseTime = new Date('2026-03-14T09:00:05.000Z')
    clock = sandbox.useFakeTimers({ now: baseTime, shouldAdvanceTime: false })

    const mediaDir = path.join(cacheDir, 'media')
    fs.mkdirSync(mediaDir, { recursive: true })

    const snapshotFile = path.join(cacheDir, 'last-snapshot.json')
    fs.writeFileSync(
      snapshotFile,
      JSON.stringify({
        snapshot_id: 'snap-layout-scene',
        schedule: {
          id: 'sched-layout-scene',
          items: [
            {
              id: 'window-layout-1',
              start_at: '2026-03-14T09:00:00.000Z',
              end_at: '2026-03-14T09:00:05.100Z',
              priority: 20,
              presentation: {
                id: 'presentation-layout-1',
                name: 'Lobby Wall',
                layout: {
                  id: 'layout-1',
                  name: 'Two Up',
                  aspect_ratio: '16:9',
                  spec: {
                    slots: [
                      { id: 'left', x: 0, y: 0, w: 0.5, h: 1 },
                      { id: 'right', x: 0.5, y: 0, w: 0.5, h: 1 },
                    ],
                  },
                },
                slots: [
                  {
                    id: 'slot-item-left',
                    slot_id: 'left',
                    media_id: 'media-left',
                    order: 0,
                    duration_seconds: 10,
                    fit_mode: 'contain',
                    audio_enabled: false,
                    media: {
                      id: 'media-left',
                      name: 'Left Promo',
                      type: 'IMAGE',
                    },
                  },
                  {
                    id: 'slot-item-right',
                    slot_id: 'right',
                    media_id: 'media-right',
                    order: 0,
                    duration_seconds: 12,
                    fit_mode: 'cover',
                    audio_enabled: true,
                    loop_enabled: true,
                    media: {
                      id: 'media-right',
                      name: 'Right Video',
                      type: 'VIDEO',
                    },
                  },
                ],
              },
            },
          ],
        },
        media_urls: {
          'media-left': 'https://cdn.example.com/left.jpg',
          'media-right': 'https://cdn.example.com/right.mp4',
        },
      })
    )

    fs.writeFileSync(path.join(mediaDir, 'media-left.jpg'), Buffer.from('left'))
    fs.writeFileSync(path.join(mediaDir, 'media-right.mp4'), Buffer.from('right'))

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()

    await clock.tickAsync(0)

    const playlist = snapshotManager.getCurrentPlaylist()
    expect(playlist?.mode).to.equal('normal')
    expect(playlist?.items).to.have.length(1)
    expect(playlist?.items[0]?.type).to.equal('scene')
    expect(playlist?.items[0]?.mediaId).to.equal(undefined)
    expect(playlist?.items[0]?.displayMs).to.equal(100)
    const scene = (playlist?.items[0]?.meta as any)?.scene
    expect(scene?.slots).to.have.length(2)
    expect(scene?.slots.find((slot: any) => slot.id === 'right')?.items[0]?.loop).to.equal(true)
  })

  it('should keep scheduled items playable from remote URLs when cache is cold', async () => {
    const baseTime = new Date('2026-03-14T09:00:05.000Z')
    clock = sandbox.useFakeTimers({ now: baseTime, shouldAdvanceTime: false })

    const snapshotFile = path.join(cacheDir, 'last-snapshot.json')
    fs.writeFileSync(
      snapshotFile,
      JSON.stringify({
        snapshot_id: 'snap-remote-only',
        schedule: {
          id: 'sched-remote-only',
          items: [
            {
              id: 'window-remote-1',
              start_at: '2026-03-14T09:00:00.000Z',
              end_at: '2026-03-14T09:30:00.000Z',
              priority: 20,
              presentation: {
                id: 'presentation-remote-1',
                name: 'Remote Schedule',
                items: [
                  {
                    id: 'presentation-item-remote-1',
                    media_id: 'media-remote-1',
                    order: 0,
                    duration_seconds: 15,
                    media: {
                      id: 'media-remote-1',
                      name: 'Remote Asset',
                      type: 'IMAGE',
                    },
                  },
                ],
              },
            },
          ],
        },
        media_urls: {
          'media-remote-1': 'https://cdn.example.com/remote-asset.jpg',
        },
      })
    )

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()

    await clock.tickAsync(0)

    const playlist = snapshotManager.getCurrentPlaylist()
    expect(playlist?.mode).to.equal('normal')
    expect(playlist?.items).to.have.length(1)
    expect(playlist?.items[0]?.mediaId).to.equal('media-remote-1')
    expect(playlist?.items[0]?.remoteUrl).to.equal('https://cdn.example.com/remote-asset.jpg')
    expect(playlist?.items[0]?.localUrl).to.equal(undefined)
  })

  it('should restore a selected PDF page from the cached offline snapshot', async () => {
    const baseTime = new Date('2026-03-14T09:00:05.000Z')
    clock = sandbox.useFakeTimers({ now: baseTime, shouldAdvanceTime: false })
    const snapshotFile = path.join(cacheDir, 'last-snapshot.json')
    fs.writeFileSync(
      snapshotFile,
      JSON.stringify({
        snapshot_id: 'snap-pdf-page',
        schedule: {
          id: 'sched-pdf-page',
          items: [{
            id: 'window-pdf-page',
            start_at: '2026-03-14T09:00:00.000Z',
            end_at: '2026-03-14T09:30:00.000Z',
            presentation: {
              id: 'presentation-pdf-page',
              items: [{
                id: 'presentation-item-pdf-page',
                media_id: 'document-1',
                order: 0,
                duration_seconds: 15,
                page_number: 4,
                media: {
                  id: 'document-1',
                  name: 'Runbook.pdf',
                  type: 'DOCUMENT',
                  content_type: 'application/pdf',
                },
              }],
            },
          }],
        },
        media_urls: { 'document-1': 'https://cdn.example.com/runbook.pdf' },
      })
    )

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()
    await clock.tickAsync(0)

    const playlist = snapshotManager.getCurrentPlaylist()
    expect(playlist?.items[0]?.type).to.equal('pdf')
    expect(playlist?.items[0]?.pageNumber).to.equal(4)
  })

  it('should clear identity-bound cached snapshot state during hard reset', async () => {
    const snapshotFile = path.join(cacheDir, 'last-snapshot.json')
    fs.writeFileSync(
      snapshotFile,
      JSON.stringify({
        snapshot_id: 'snap-clear',
        schedule: {
          id: 'sched-clear',
          items: [],
        },
      })
    )

    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const snapshotManager = getSnapshotManager()

    expect(fs.existsSync(snapshotFile)).to.equal(true)

    snapshotManager.clearIdentityBoundState()

    expect(fs.existsSync(snapshotFile)).to.equal(false)
    expect(snapshotManager.getCurrentPlaylist()?.mode).to.equal('empty')
  })
})
