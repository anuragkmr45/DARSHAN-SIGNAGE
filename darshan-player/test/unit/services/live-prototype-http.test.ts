import { expect } from 'chai'
import * as http from 'http'
import { once } from 'events'
import { performance } from 'perf_hooks'
import { createAuthorityRequest } from '../../../src/main/live-prototype/authority'

describe('Live prototype actual HTTP authority transport', () => {
  let server: http.Server | undefined
  afterEach(async () => {
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>(resolve => server!.close(() => resolve()))
    server = undefined
  })
  async function requestFor(handler: http.RequestListener) {
    server = http.createServer(handler)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as import('net').AddressInfo).port
    return createAuthorityRequest({ authority_url: `http://127.0.0.1:${port}/authority`,
      renewal_token: 'private-fixture-renewal-token', receiver_session_id: 'fixture-receiver' })
  }

  it('sends one bounded POST and accepts a complete response without exposing credentials', async () => {
    const requests: Array<{ method?: string; body: unknown; authorized: boolean }> = []
    const request = await requestFor(async (incoming, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(chunk)
      requests.push({ method: incoming.method, body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        authorized: incoming.headers.authorization === 'Bearer private-fixture-renewal-token' })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ fixture: true }))
    })
    expect(await request(true)).to.deep.equal({ status: 200, data: { fixture: true } })
    expect(requests).to.deep.equal([{ method: 'POST', body: { receiver_session_id: 'fixture-receiver', reconnect: true }, authorized: true }])
  })

  it('aborts after the absolute deadline even while response bytes keep arriving', async () => {
    const request = await requestFor((_incoming, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.write('{')
      const drip = setInterval(() => response.write(' '), 50)
      response.on('close', () => clearInterval(drip))
    })
    const began = performance.now()
    let message: string | undefined
    try { await request(false) } catch (error) { message = (error as Error).message }
    const elapsed = performance.now() - began
    expect(message).to.equal('Authority unavailable')
    expect(elapsed).to.be.greaterThan(1000)
    expect(elapsed).to.be.lessThan(2500)
  })
})
