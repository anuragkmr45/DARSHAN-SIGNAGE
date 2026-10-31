import { describe, expect, it } from 'vitest';
import {
  encodeTargetNativeEngineCommandV4, encodeTargetNativeEngineInspectionV4,
  parseTargetNativeEngineCommandV4, parseTargetNativeEngineInspectionV4,
  targetNativeEngineCommandSemanticV4Sha256, targetNativeEngineCommandWireV4Sha256,
  targetNativeEngineInspectionWireV4Sha256, type TargetNativeEngineCommandV4,
  type TargetNativeEngineInspectionV4,
} from './target-native-engine-wire-v4';

const d = (value: string) => value.repeat(64);
const n = (value: string) => value.repeat(32);
const command: TargetNativeEngineCommandV4 = {
  format: 'darshan-recovery-target-native-engine-command-v4', operation: 'CREATE_POSTGRES', role: 'POSTGRES',
  installationId: '11111111-1111-4111-8111-111111111111', siteId: 'fixture-site',
  hostInstallationId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333', targetHandle: 'tra:v1:target:0123456789abcdef',
  generation: '9', acquiredRequestSha256: d('1'), profileV4Sha256: d('2'), resourceAdmissionV3Sha256: d('3'),
  credentialAdmissionReceiptSha256: d('4'), credentialUseWitnessSha256: d('5'), authorityInstanceSha256: d('6'),
  supervisorGeneration: '7', challengeNonce: n('7'), commandNonce: n('8'), materializationHeadSha256: d('9'),
  deadlineUnixMs: '2000000000000', assetManifestSha256: d('b'),
};

describe('native engine wire v4', () => {
  it('strictly round-trips fixed bytes with distinct semantic and executed-wire digests', () => {
    const bytes = encodeTargetNativeEngineCommandV4(command);
    expect(encodeTargetNativeEngineCommandV4(parseTargetNativeEngineCommandV4(bytes))).toEqual(bytes);
    expect(targetNativeEngineCommandSemanticV4Sha256(command)).toMatch(/^[a-f0-9]{64}$/);
    expect(targetNativeEngineCommandWireV4Sha256(command)).toMatch(/^[a-f0-9]{64}$/);
    expect(targetNativeEngineCommandSemanticV4Sha256(command)).not.toBe(targetNativeEngineCommandWireV4Sha256(command));
  });
  it.each([
    ['old version', (bytes: Buffer) => Buffer.from(bytes.toString().replace('command-v4', 'command-v3'))],
    ['reordered', (bytes: Buffer) => Buffer.from(bytes.toString().replace('operation=CREATE_POSTGRES\nrole=POSTGRES', 'role=POSTGRES\noperation=CREATE_POSTGRES'))],
    ['trailing', (bytes: Buffer) => Buffer.concat([bytes, Buffer.from('x')])],
    ['oversize', (bytes: Buffer) => Buffer.concat([bytes, Buffer.alloc(17 * 1024, 0x61)])],
  ])('rejects %s command bytes', (_label, mutate) => expect(() => parseTargetNativeEngineCommandV4(mutate(encodeTargetNativeEngineCommandV4(command)))).toThrow());
  it('binds every command field and rejects action/authority nonce aliasing', () => {
    const fields: (keyof TargetNativeEngineCommandV4)[] = ['installationId', 'siteId', 'hostInstallationId', 'operationId',
      'targetHandle', 'generation', 'acquiredRequestSha256', 'profileV4Sha256', 'resourceAdmissionV3Sha256',
      'credentialAdmissionReceiptSha256', 'credentialUseWitnessSha256', 'authorityInstanceSha256', 'supervisorGeneration',
      'challengeNonce', 'commandNonce', 'materializationHeadSha256', 'deadlineUnixMs', 'assetManifestSha256'];
    for (const field of fields) {
      const alternate = { ...command } as Record<keyof TargetNativeEngineCommandV4, string>;
      const value = alternate[field];
      if (field === 'siteId') alternate[field] = 'other-site';
      else if (field === 'targetHandle') alternate[field] = 'tra:v1:target:fedcba9876543210';
      else if (field.endsWith('Id')) alternate[field] = value.startsWith('1') ? value.replace(/^1/, '4') : value.replace(/^./, '1');
      else if (field === 'generation' || field === 'supervisorGeneration' || field === 'deadlineUnixMs') alternate[field] = `${BigInt(value) + 1n}`;
      else alternate[field] = `${value.slice(0, -1)}${value.endsWith('a') ? 'b' : 'a'}`;
      expect(targetNativeEngineCommandWireV4Sha256(alternate as unknown as TargetNativeEngineCommandV4)).not.toBe(targetNativeEngineCommandWireV4Sha256(command));
    }
    expect(() => encodeTargetNativeEngineCommandV4({ ...command, commandNonce: command.challengeNonce })).toThrow();
  });
  it('strictly round-trips independently observed inspection-v4 bytes', () => {
    const inspection: TargetNativeEngineInspectionV4 = {
      format: 'darshan-recovery-target-native-engine-inspection-v4', operation: command.operation, role: command.role,
      operationId: command.operationId, targetHandle: command.targetHandle, generation: command.generation,
      commandSemanticSha256: targetNativeEngineCommandSemanticV4Sha256(command),
      commandWireSha256: targetNativeEngineCommandWireV4Sha256(command), commandNonce: command.commandNonce,
      authorityInstanceSha256: command.authorityInstanceSha256, supervisorGeneration: command.supervisorGeneration,
      challengeNonce: command.challengeNonce, materializationHeadSha256: command.materializationHeadSha256,
      assetManifestSha256: command.assetManifestSha256, daemonIdentitySha256: d('a'), daemonResponseSha256: d('c'),
      observationComplete: 'true', absenceReliable: 'false', containersCount: '2', networksCount: '1', consumersCount: '2',
      networkProjectionSha256: d('d'), postgresProjectionSha256: d('e'), minioProjectionSha256: d('f'),
    };
    const bytes = encodeTargetNativeEngineInspectionV4(inspection);
    expect(encodeTargetNativeEngineInspectionV4(parseTargetNativeEngineInspectionV4(bytes))).toEqual(bytes);
    expect(targetNativeEngineInspectionWireV4Sha256(bytes)).toMatch(/^[a-f0-9]{64}$/);
  });
});
