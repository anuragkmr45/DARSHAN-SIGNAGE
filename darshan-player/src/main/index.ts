/** Dispatch before loading ordinary player configuration, identity or services. */
import { app } from 'electron'
import { assertLivePrototypeMode, parseLivePrototypeArgument } from './live-prototype/config'
import { developmentLiveTestRoot } from './live-development-profile'

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
    const testRoot = developmentLiveTestRoot()
    if (testRoot) app.setPath('userData', testRoot)
    // Synchronous load preserves registration of the ordinary ready handler.
    require('./application')
  }
} catch {
  console.error('Invalid live launch; development overrides require their explicit private configuration.')
  app.exit(1)
}
