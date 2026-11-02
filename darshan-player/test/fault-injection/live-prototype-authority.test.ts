import { expect } from 'chai'
import sinon from 'sinon'
import { LivePrototypeAuthority, type AuthorityResponse } from '../../src/main/live-prototype/authority'
import type { LivePrototypeGrant } from '../../src/common/live-prototype'

describe('Live prototype authority fault boundaries', () => {
  let clock: sinon.SinonFakeTimers
  let authority: LivePrototypeAuthority | undefined
  beforeEach(() => { clock = sinon.useFakeTimers({ now: 0 }) })
  afterEach(() => { authority?.stop(); clock.restore() })
  const grant: LivePrototypeGrant = { run_id: 'run-1', admission_id: 'admission-1', presenter_identity: 'presenter-1', generation: 1,
    signal_url: 'ws://127.0.0.1:19001', ticket: 'one-use-fixture-ticket', lease_ms: 10000, window_remaining_ms: 60000 }

  function create(request: (reconnect: boolean) => Promise<AuthorityResponse>) {
    const admitted: LivePrototypeGrant[] = []
    const unavailable: string[] = []
    authority = new LivePrototypeAuthority({ request, now: () => clock.now,
      onGrant: value => admitted.push(value), onUnavailable: value => unavailable.push(value) })
    return { authority, admitted, unavailable }
  }

  it('renews a healthy lease without reconnecting or redistributing the ticket', async () => {
    const calls: boolean[] = []
    const test = create(async reconnect => { calls.push(reconnect); return { status: 200, data: reconnect ? grant : { ...grant, ticket: undefined } } })
    test.authority.start()
    await clock.tickAsync(9000)
    expect(calls).to.deep.equal([true, false, false, false])
    expect(test.admitted).to.have.length(1)
    expect(test.authority.isAuthorized(grant)).to.equal(true)
    expect(test.unavailable).to.have.length(0)
  })

  it('stops by the existing lease when Backend renewal fails', async () => {
    let count = 0
    const test = create(async () => ++count === 1 ? { status: 200, data: grant } : { status: 503 })
    test.authority.start()
    await clock.tickAsync(9999)
    expect(test.authority.isAuthorized(grant)).to.equal(true)
    await clock.tickAsync(1)
    expect(test.authority.isAuthorized(grant)).to.equal(false)
    expect(test.unavailable).to.include('Content unavailable — live authority expired')
  })

  it('caps authority at schedule end and subtracts response travel time', async () => {
    const test = create(async () => {
      await new Promise(resolve => setTimeout(resolve, 2000))
      return { status: 200, data: { ...grant, window_remaining_ms: 4000 } }
    })
    test.authority.start()
    await clock.tickAsync(3999)
    expect(test.authority.isAuthorized(grant)).to.equal(true)
    await clock.tickAsync(1)
    expect(test.authority.isAuthorized(grant)).to.equal(false)
  })

  it('does not resurrect an old response after suspend or stop', async () => {
    let complete: ((response: AuthorityResponse) => void) | undefined
    const test = create(() => new Promise(resolve => { complete = resolve }))
    test.authority.start()
    test.authority.suspend()
    complete?.({ status: 200, data: grant })
    await clock.tickAsync(0)
    expect(test.admitted).to.have.length(0)
    expect(test.authority.isAuthorized(grant)).to.equal(false)
    test.authority.stop()
    await clock.tickAsync(30000)
    expect(test.admitted).to.have.length(0)
  })

  it('requires a new ticket after renderer disconnect and rejects delayed generations', async () => {
    const reconnects: boolean[] = []
    const test = create(async reconnect => { reconnects.push(reconnect); return { status: 200, data: reconnect ? grant : { ...grant, ticket: undefined, generation: 2 } } })
    test.authority.start()
    await clock.tickAsync(0)
    test.authority.requestReconnect()
    expect(test.authority.isAuthorized(grant)).to.equal(false)
    await clock.tickAsync(1000)
    expect(reconnects).to.deep.equal([true, true])
    expect(test.admitted).to.have.length(2)
    await clock.tickAsync(3000)
    expect(test.authority.isAuthorized(grant)).to.equal(false)
    expect(test.unavailable).to.include('Content unavailable — live authority changed')
  })

  it('treats revocation as terminal and never automatically requests new admission', async () => {
    let count = 0
    const test = create(async () => ++count === 1 ? { status: 200, data: grant } : { status: 403 })
    test.authority.start()
    await clock.tickAsync(30000)
    expect(count).to.equal(2)
    expect(test.authority.isAuthorized(grant)).to.equal(false)
  })

  it('rejects a renewal processed after expiry even if the expiry timer was delayed', async () => {
    let elapsed = 0
    let finishRenewal: ((value: AuthorityResponse) => void) | undefined
    let calls = 0
    const admitted: LivePrototypeGrant[] = []
    authority = new LivePrototypeAuthority({ now: () => elapsed, onGrant: value => admitted.push(value), onUnavailable: () => undefined,
      request: async () => ++calls === 1 ? { status: 200, data: grant } : new Promise(resolve => { finishRenewal = resolve }) })
    authority.start()
    await clock.tickAsync(3000)
    elapsed = 10001
    finishRenewal?.({ status: 200, data: { ...grant, ticket: undefined } })
    await clock.tickAsync(0)
    expect(authority.isAuthorized(grant)).to.equal(false)
    expect(admitted).to.have.length(1)
  })
})
