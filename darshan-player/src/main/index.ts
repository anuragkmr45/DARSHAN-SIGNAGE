/** Dispatch before loading ordinary player configuration, identity or services. */
import { app } from 'electron'
import { assertLivePrototypeMode, parseLivePrototypeArgument } from './live-prototype/config'

try {
  const prototypePath = parseLivePrototypeArgument(process.argv)
  if (prototypePath) {
    assertLivePrototypeMode(process.env['DARSHAN_RUNTIME_MODE'])
    void import('./live-prototype/application.js')
      .then(({ startLivePrototype }) => startLivePrototype(prototypePath))
      .catch(() => {
        console.error('Live prototype could not start; check its private configuration.')
        app.exit(1)
      })
  } else {
    // Synchronous load preserves registration of the ordinary ready handler.
    require('./application')
  }
} catch {
  console.error('Invalid live prototype launch; explicit dev mode and a private config are required.')
  app.exit(1)
}
