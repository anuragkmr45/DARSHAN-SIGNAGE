const { expect } = require('chai')
const http = require('http')
const { performance } = require('perf_hooks')
const { LiveAuthorityClient } = require('../../src/main/services/live-authority-client')
const { LIVE_IDS } = require('../helpers/live-fixtures')

describe('Normal LIVE authority transport faults', function () {
  this.timeout(8000)
  it('closes a dribbling real HTTP response at the total deadline with no automatic retry', async () => {
    let requests = 0
    const sockets = new Set()
    const intervals = new Set()
    const server = http.createServer((request, response) => {
      requests += 1
      request.resume()
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.write('{"version":')
      const interval = setInterval(() => response.write(' '), 50)
      intervals.add(interval)
      response.on('close', () => { clearInterval(interval); intervals.delete(interval) })
    })
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const client = new LiveAuthorityClient(LIVE_IDS.device, { apiBase: base, development: true,
      request: async (method, pathname, body, signal) => {
        const response = await fetch(`${base}${pathname}`, { method, signal, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error' })
        return await response.json()
      } })
    const started = performance.now()
    try {
      let error
      try { await client.authenticateEpoch() } catch (failure) { error = failure }
      const elapsed = performance.now() - started
      expect(error.code).to.equal('LIVE_AUTHORITY_TIMEOUT')
      expect(elapsed).to.be.at.least(1400)
      expect(elapsed).to.be.below(2500)
      expect(requests).to.equal(1)
    } finally {
      for (const interval of intervals) clearInterval(interval)
      for (const socket of sockets) socket.destroy()
      await new Promise(resolve => server.close(resolve))
    }
  })
})
