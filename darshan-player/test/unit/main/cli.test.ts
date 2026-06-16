const { expect } = require('chai')

describe('player CLI parser', () => {
  afterEach(() => {
    delete require.cache[require.resolve('../../../src/main/cli')]
  })

  it('parses doctor flag', () => {
    const { parseOperatorCommand } = require('../../../src/main/cli')
    expect(parseOperatorCommand(['/path/to/electron', '.', '--doctor'])).to.deep.equal({ name: 'doctor' })
  })

  it('parses pair request subcommand', () => {
    const { parseOperatorCommand } = require('../../../src/main/cli')
    expect(parseOperatorCommand(['/path/to/player', 'pair', 'request'])).to.deep.equal({ name: 'pair-request' })
  })

  it('parses pair submit subcommand', () => {
    const { parseOperatorCommand } = require('../../../src/main/cli')
    expect(parseOperatorCommand(['/path/to/player', 'pair', 'submit', 'ABC123'])).to.deep.equal({
      name: 'pair-submit',
      pairingCode: 'ABC123',
    })
  })

  it('parses pair flag syntax', () => {
    const { parseOperatorCommand } = require('../../../src/main/cli')
    expect(parseOperatorCommand(['/path/to/player', '--pair=ZXCV12'])).to.deep.equal({
      name: 'pair-submit',
      pairingCode: 'ZXCV12',
    })
  })

  it('parses reset pairing command with reason', () => {
    const { parseOperatorCommand } = require('../../../src/main/cli')
    expect(parseOperatorCommand(['/path/to/player', 'reset-pairing', '--reason=stale identity'])).to.deep.equal({
      name: 'reset-pairing',
      reason: 'stale identity',
      dryRun: false,
      clearCache: false,
    })
  })

  it('parses pairing status command', () => {
    const { parseOperatorCommand } = require('../../../src/main/cli')
    expect(parseOperatorCommand(['/path/to/player', '--pairing-status'])).to.deep.equal({ name: 'pairing-status' })
  })

  it('parses reset pairing dry-run with optional cache clearing', () => {
    const { parseOperatorCommand } = require('../../../src/main/cli')
    expect(parseOperatorCommand(['/path/to/player', 'reset-pairing', '--dry-run', '--clear-cache'])).to.deep.equal({
      name: 'reset-pairing',
      reason: undefined,
      dryRun: true,
      clearCache: true,
    })
  })
})
