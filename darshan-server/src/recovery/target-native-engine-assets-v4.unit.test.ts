import { describe, expect, it } from 'vitest';
import {
  encodeInstalledEngineAssetsV1, installedEngineAssetsV1Sha256, parseInstalledEngineAssetsV1,
  type InstalledEngineAssetsV1,
} from './target-native-engine-asset-manifest';
import {
  encodeTargetBackendResourceAdmissionV3, encodeTargetNativeEngineExecutionProfileV4,
  targetBackendResourceAdmissionV3Sha256, targetNativeEngineExecutionProfileV4Sha256,
  type TargetBackendResourceAdmissionV3, type TargetNativeEngineExecutionProfileV4,
} from './target-native-engine-execution-profile-v4';
const d = (v: string) => v.repeat(64);
const descriptor = (index: number, path: string, mode: '0400'|'0440'|'0500'|'0555'|'0600'|'0700'|'0755') => ({
  authorityHandle: `tra:v1:asset:${`${index}`.padStart(16, '0')}`, fixedPath: path, contentSha256: d('a'),
  descriptorIdentitySha256: d('b'), deviceMajor: '8', deviceMinor: '1', inode: `${100 + index}`, mountId: '29',
  ownerUid: '0', ownerGid: '0', mode, linkCount: '1' as const, stableIdentity: true as const,
});
function manifest(): InstalledEngineAssetsV1 {
  const value = {
    format: 'darshan-recovery-installed-engine-assets-v1' as const,
    protectedRoot: '/var/lib/darshan-recovery/installed-engine-v1' as const, enumerationComplete: true as const,
    dockerElf: { ...descriptor(1, '/usr/bin/docker', '0555'), elfClass: 'ELF64' as const, elfMachine: 'X86_64' as const },
    clientConfig: { ...descriptor(2, '/var/lib/darshan-recovery/docker-client', '0700'), fixedPath: '/var/lib/darshan-recovery/docker-client' as const },
    daemon: { transport: 'UNIX' as const, fixedSocketPath: '/run/docker.sock' as const,
      socketAuthorityHandle: 'tra:v1:daemon:0123456789abcdef', socketIdentitySha256: d('c'), daemonIdentitySha256: d('d'),
      apiVersion: '1.44' as const, contextName: 'default-local' as const, tls: false as const,
      ambientContextAllowed: false as const, ambientProxyAllowed: false as const, authHelperAllowed: false as const, pluginsAllowed: false as const },
    images: [
      { role: 'POSTGRES_IMAGE' as const, imageId: `sha256:${d('1')}`, repositoryDigest: `postgres@sha256:${d('2')}`,
        configSha256: d('3'), rootfsSha256: d('4'), platform: 'linux' as const, architecture: 'amd64' as const,
        operatingSystem: 'linux' as const, preloaded: true as const, implicitPullAllowed: false as const },
      { role: 'MINIO_IMAGE' as const, imageId: `sha256:${d('5')}`, repositoryDigest: `minio/minio@sha256:${d('6')}`,
        configSha256: d('7'), rootfsSha256: d('8'), platform: 'linux' as const, architecture: 'amd64' as const,
        operatingSystem: 'linux' as const, preloaded: true as const, implicitPullAllowed: false as const },
    ] as const,
    assets: [descriptor(3, '/etc/darshan-recovery/postgresql.conf', '0440'), descriptor(4, '/etc/darshan-recovery/minio.env', '0400'),
      descriptor(5, '/opt/darshan-recovery/bootstrap/postgres', '0500'), descriptor(6, '/opt/darshan-recovery/bootstrap/minio', '0500'),
      descriptor(7, '/opt/darshan-recovery/probes/postgres-ready', '0500'), descriptor(8, '/opt/darshan-recovery/probes/minio-ready', '0500')] as const,
    numericUsers: { postgresUid: '999' as const, postgresGid: '999' as const, minioUid: '1000' as const,
      minioGid: '1000' as const, usernsMode: 'private' as const, usernsMappingSha256: d('9') },
    policySha256: d('a'), securityPolicySha256: d('b'), resourcePolicySha256: d('c'), loggingPolicySha256: d('d'),
    quiescencePolicySha256: d('e'), manifestSha256: d('0'),
  };
  const typed = value as unknown as InstalledEngineAssetsV1;
  return { ...typed, manifestSha256: installedEngineAssetsV1Sha256(typed) };
}
describe('installed assets and execution profile v4', () => {
  it('round-trips exact complete manifest bytes', () => { const value=manifest(); expect(parseInstalledEngineAssetsV1(encodeInstalledEngineAssetsV1(value))).toEqual(value); });
  it.each(['protectedRoot','enumerationComplete','dockerContent','dockerArch','clientPath','daemonSocket','daemonApi','imageId','rootfs','platform','implicitPull','assetOrder','assetLink','assetIdentity','assetOwner','userMapping','securityPolicy'])(
    'rejects installed manifest substitution: %s', (kind) => {
      // Deliberately permit invalid nested fixture mutations for strict rejection cases.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value=structuredClone(manifest()) as any;
      if(kind==='protectedRoot')value.protectedRoot='/tmp/assets'; else if(kind==='enumerationComplete')value.enumerationComplete=false;
      else if(kind==='dockerContent')value.dockerElf.contentSha256=d('1'); else if(kind==='dockerArch')value.dockerElf.elfMachine='AARCH64';
      else if(kind==='clientPath')value.clientConfig.fixedPath='/tmp/client'; else if(kind==='daemonSocket')value.daemon.fixedSocketPath='/tmp/docker.sock';
      else if(kind==='daemonApi')value.daemon.apiVersion='1.45'; else if(kind==='imageId')value.images[0].imageId=`sha256:${d('f')}`;
      else if(kind==='rootfs')value.images[0].rootfsSha256=d('f'); else if(kind==='platform')value.images[0].platform='windows';
      else if(kind==='implicitPull')value.images[0].implicitPullAllowed=true; else if(kind==='assetOrder')[value.assets[0],value.assets[1]]=[value.assets[1],value.assets[0]];
      else if(kind==='assetLink')value.assets[0].linkCount='2'; else if(kind==='assetIdentity')value.assets[1].inode=value.assets[0].inode;
      else if(kind==='assetOwner')value.assets[0].ownerUid='999'; else if(kind==='userMapping')value.numericUsers.usernsMappingSha256=d('f');
      else value.securityPolicySha256=d('f');
      expect(() => encodeInstalledEngineAssetsV1(value)).toThrow();
    });
  it('binds profile-v4 and disabled admission-v3 to fresh credential use and assets', () => {
    const assets=manifest(); const base={ format:'darshan-recovery-target-native-engine-execution-profile-v4' as const,
      targetHandle:'tra:v1:target:0123456789abcdef',generation:'9',historicalProfileV2Sha256:d('1'),credentialProfileV3Sha256:d('2'),
      historicalResourceAdmissionV2Sha256:d('3'),credentialAdmissionReceiptSha256:d('4'),credentialUseWitnessSha256:d('5'),
      physicalAllocationIdentitySha256:d('6'),allocationLedgerHeadSha256:d('7'),installedAssetManifestSha256:assets.manifestSha256,
      daemonCompatibilitySha256:d('8'),effectivePolicySha256:d('9'),backend:'FIXED_DOCKER_LOCAL_UNIX_V1' as const,
      availability:'UNAVAILABLE' as const,dispatchEnabled:false as const,lifecycleEnabled:false as const,profileSha256:d('0') };
    const profile:TargetNativeEngineExecutionProfileV4={...base,profileSha256:targetNativeEngineExecutionProfileV4Sha256(base)};
    expect(encodeTargetNativeEngineExecutionProfileV4(profile,assets)).toBeInstanceOf(Buffer);
    const admissionBase={ format:'darshan-recovery-target-backend-resource-admission-v3' as const,targetHandle:profile.targetHandle,
      generation:profile.generation,executionProfileV4Sha256:profile.profileSha256,installedAssetManifestSha256:assets.manifestSha256,
      credentialAdmissionReceiptSha256:profile.credentialAdmissionReceiptSha256,credentialUseWitnessSha256:profile.credentialUseWitnessSha256,
      physicalAllocationIdentitySha256:profile.physicalAllocationIdentitySha256,allocationLedgerHeadSha256:profile.allocationLedgerHeadSha256,
      daemonCompatibilitySha256:profile.daemonCompatibilitySha256,effectivePolicySha256:profile.effectivePolicySha256,
      status:'UNAVAILABLE' as const,materializationEnabled:false as const,lifecycleEnabled:false as const,admissionSha256:d('0') };
    const admission:TargetBackendResourceAdmissionV3={...admissionBase,admissionSha256:targetBackendResourceAdmissionV3Sha256(admissionBase)};
    expect(encodeTargetBackendResourceAdmissionV3(admission,profile)).toBeInstanceOf(Buffer);
    expect(() => encodeTargetBackendResourceAdmissionV3({...admission,credentialUseWitnessSha256:d('f')},profile)).toThrow();
    for (const field of ['physicalAllocationIdentitySha256', 'allocationLedgerHeadSha256',
      'daemonCompatibilitySha256', 'effectivePolicySha256'] as const) {
      const substitutedBase = { ...admission, [field]: d('f') };
      const substituted = { ...substitutedBase,
        admissionSha256: targetBackendResourceAdmissionV3Sha256(substitutedBase) };
      expect(() => encodeTargetBackendResourceAdmissionV3(substituted, profile)).toThrow();
    }
  });
});
