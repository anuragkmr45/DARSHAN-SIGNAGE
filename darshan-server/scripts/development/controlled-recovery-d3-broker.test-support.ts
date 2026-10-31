import { generateKeyPairSync } from 'node:crypto';
import { vi } from 'vitest';
import { canonicalJson } from '../../src/backups/backup-broker-protocol';
import { digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { D3_BROKER_ENTRY, D3_BROKER_NODE } from './controlled-recovery-d3-broker-enrollment';
import { d3BrokerAuthoritySchema } from './controlled-recovery-d3-broker-prerequisites';
import { brokerFailure, type D3BrokerProcessIdentity } from './controlled-recovery-d3-broker-process';
import { d3BrokerProfileSchema } from './controlled-recovery-d3-broker-profile';
import { FixedD3Broker, type D3BrokerDependencies } from './controlled-recovery-d3-broker';
import type { D3BrokerRecord, D3BrokerSocketIdentity } from './controlled-recovery-d3-broker-storage';
import { reservationFixture } from './controlled-recovery-d3-reservation.test-support';
import profileJson from '../../../deploy/development/controlled-recovery/tiny-d3.broker-profile.json';
import inventoryJson from '../../../deploy/development/controlled-recovery/tiny-d3.broker-dependencies.json';
import { d3BrokerInventorySchema } from './controlled-recovery-d3-broker-enrollment';
export const brokerProfile = d3BrokerProfileSchema.parse(profileJson), brokerInventory = d3BrokerInventorySchema.parse(inventoryJson);
export async function brokerFixture() {
  const reservation = await reservationFixture(), reserved = await reservation.reservation.reserve(), pair = generateKeyPairSync('ed25519'), publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(), manifestKeyId = sha256(Buffer.from(publicKey)), manifestKeyring = canonicalJson({ [manifestKeyId]: publicKey });
  const source = reservation.input.authority;
  const authority = d3BrokerAuthoritySchema.parse({ format: 'darshan-d3-broker-authority-v1', reservationAuthority: source, reservationBindingSha256: reserved.bindingSha256, runId: reserved.runId, queueJobId: reserved.queueJobId, brokerProfileSha256: digest(brokerProfile), dependencyInventorySha256: brokerProfile.inventory_sha256, policySha256: source.capsulePolicySha256,
    capsuleGeneration: '11111111-1111-4111-8111-111111111111', capsuleSha256: source.capsuleSha256, capsuleBytes: '32', inventorySha256: source.capsuleInventorySha256, ageKeyId: source.keyId, manifestKeyId, manifestKeyringSha256: sha256(manifestKeyring), rootDevice: '1', repositoryInode: '2' });
  const input = { authority, manifestKeyring }, records = new Map<D3BrokerRecord['kind'], D3BrokerRecord>(), sockets = new Map<'main' | 'recovery', D3BrokerSocketIdentity>();
  const events: string[] = []; const state = { active: false, foreignScope: false, scopeUnavailable: false, neverNode: false, unknownProcess: false, ticks: '12345', now: 0, joinUncertain: false, failCleanupOnce: false, protocolMismatch: false, fault: null as string | null, startupAbort: null as AbortController | null };
  const identity = (): D3BrokerProcessIdentity => ({ pid: 424242, startTicks: state.ticks, executableSha256: brokerInventory.files.find(({ path }) => path === (state.neverNode ? brokerProfile.activator : D3_BROKER_NODE))!.sha256, moduleSha256: brokerInventory.files.find(({ path }) => path === D3_BROKER_ENTRY)!.sha256, scopeSha256: digest('exact scope'), listenPidfdId: null });
  const storage: D3BrokerDependencies['storage'] = {
    read: vi.fn(async (kind, repair) => { events.push(`read:${kind}:${repair === true}`); return structuredClone(records.get(kind) ?? null); }),
    publish: vi.fn(async (kind, bindingSha256, payload) => { events.push(`publish:${kind}`); const unsigned = { format: 'darshan-d3-broker-record-v1' as const, kind, bindingSha256, payload }, record = { ...unsigned, receiptSha256: digest(unsigned) }; const old = records.get(kind); if (old && digest(old) !== digest(record)) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_RECORD_CONFLICT'); records.set(kind, structuredClone(record)); return record; }),
    preparePublicKeyring: vi.fn(async () => { events.push('keyring'); }), inspectSocket: vi.fn(async (role) => structuredClone(sockets.get(role) ?? null)),
    unlinkSocket: vi.fn(async (expected) => { events.push(`unlink:${expected.role}`); if (state.failCleanupOnce && expected.role === 'recovery') { state.failCleanupOnce = false; throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_SOCKET_SETTLEMENT_UNCERTAIN'); } if (digest(sockets.get(expected.role) ?? null) !== digest(expected)) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_SOCKET_REPLACED'); sockets.delete(expected.role); }),
  };
  const scope = { verify: vi.fn(async () => { if (state.scopeUnavailable || state.foreignScope) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_SCOPE_UNVERIFIED'); return { scopeSha256: digest('exact scope') }; }) };
  const process = { start: vi.fn(() => { events.push('spawn'); state.active = true; for (const role of ['main', 'recovery'] as const) sockets.set(role, { role, dev: '1', ino: role === 'main' ? '10' : '11', uid: 1000, gid: 1000, mode: '0644', nlink: 1, type: 'socket' }); state.startupAbort?.abort(); let close!: () => void; const closed = new Promise<void>((resolve) => { close = resolve; }); return {
    pid: 424242, closed, failure: () => state.fault, terminateAndJoin: vi.fn(async () => { events.push('join'); if (state.joinUncertain) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_PROCESS_SETTLEMENT_UNCERTAIN'); state.active = false; close(); }),
  }; }) };
  const dependencies: D3BrokerDependencies = { profile: brokerProfile, profileSha256: digest(brokerProfile), inventory: brokerInventory, prerequisites: { read: vi.fn(async () => structuredClone(input)) }, storage, scope, process,
    host: { owner: async () => ({ ownerPid: 424240, ownerStartTicks: '12340' }), now: () => state.now, pause: async () => { state.now += 1000; }, observe: vi.fn(async () => { if (!state.active) return null; await scope.verify(); if (state.unknownProcess) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_PROCESS_CHANGED'); return { identity: identity(), phase: state.neverNode ? 'ACTIVATOR' as const : 'NODE' as const, listeners: { main: !state.neverNode, recovery: !state.neverNode } }; }) },
    verifyEnrollment: vi.fn(async () => brokerInventory), verifyCapabilities: vi.fn(async () => { events.push('describe'); if (state.protocolMismatch) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_DESCRIBE_MISMATCH'); return { capabilitySha256: digest('exact capability') }; }), admit: vi.fn(async () => undefined), withOperationLock: async (action) => action(),
  };
  return { input, publicKey, pair, state, records, sockets, events, storage, dependencies, core: new FixedD3Broker(dependencies), identity };
}
