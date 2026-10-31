const { expect } = require('chai')
const { mkdtempSync, readFileSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')
const { randomUUID } = require('crypto')
const { DeviceStateStore } = require('../../../src/main/services/device-state-store')
const { buildPlayerRecoveryGenerationProofPayload, isRecoveryGenerationCurrent } = require('../../../src/main/services/recovery-generation')

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('player recovery generation authority', () => {
  it('persists a new generation, cancels old local work/version counters, and retains identity fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'player-recovery-generation-')); roots.push(root)
    const statePath = join(root, 'device-state.json'); const store = new DeviceStateStore(statePath)
    await store.update({ deviceId: randomUUID(), fingerprint: 'cert-serial', installInstanceId: randomUUID(),
      recentCommands: [{ id: randomUUID(), firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), source: 'poll' }],
      lastObservedStateVersion: 99, lastAppliedStateVersion: 98, lastDesiredCommandVersion: 42,
      lastDesiredSnapshotId: randomUUID(), lastDesiredDefaultMediaVersion: 'old' })
    const before = store.getState(); const generation = randomUUID()
    await store.acceptRecoveryGeneration({ generation, receiptSha256: 'a'.repeat(64), acceptedAt: '2026-10-30T00:00:00.000Z' })
    const after = store.getState()
    expect(after).to.include({ deviceId: before.deviceId, fingerprint: 'cert-serial', installInstanceId: before.installInstanceId,
      recoveryGeneration: generation, recoveryGenerationReceiptSha256: 'a'.repeat(64) })
    expect(after.recentCommands).to.deep.equal([])
    expect(after.lastObservedStateVersion).to.equal(undefined); expect(after.lastDesiredSnapshotId).to.equal(undefined)
    expect(JSON.parse(readFileSync(statePath, 'utf8')).recoveryGeneration).to.equal(generation)
  })

  it('does not reset same-generation authority and rejects old or unproven generations before ordinary stale checks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'player-recovery-generation-')); roots.push(root)
    const store = new DeviceStateStore(join(root, 'state.json')); const generation = randomUUID()
    await store.acceptRecoveryGeneration({ generation, receiptSha256: 'b'.repeat(64) })
    await store.update({ lastObservedStateVersion: 7 })
    await store.acceptRecoveryGeneration({ generation, receiptSha256: 'c'.repeat(64) })
    expect(store.getState().lastObservedStateVersion).to.equal(7)
    expect(isRecoveryGenerationCurrent(generation, generation)).to.equal(true)
    expect(isRecoveryGenerationCurrent(randomUUID(), generation)).to.equal(false)
    expect(isRecoveryGenerationCurrent(null, generation)).to.equal(false)
  })

  it('binds the signed proof to site, generation, screen, certificate, nonce, challenge, and expiry', () => {
    const payload = buildPlayerRecoveryGenerationProofPayload({ challenge_id: randomUUID(), site_id: 'site-a',
      recovery_generation: randomUUID(), screen_id: randomUUID(), certificate_id: randomUUID(), client_nonce: 'a'.repeat(32),
      server_challenge: 'b'.repeat(43), expires_at: '2026-10-30T00:01:00.000Z' })
    expect(payload.split('\n')).to.have.length(8)
    expect(payload).to.contain('DARSHAN_RECOVERY_GENERATION_PROOF_V1')
  })
})
