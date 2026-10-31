import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { loadDevelopmentD2Activation } from './controlled-recovery-d2';
import { loadDevelopmentD3Activation, verifyDevelopmentD3PacketAssets } from './controlled-recovery-d3-activation';
import { D3_OPERATION_ID, D3_REPOSITORY_ID, D3_ROOT, D3_SITE_ID, deriveD3OperationAuthority } from './controlled-recovery-d3-authority';
import { assertD3ContainerToolsImage, D3ContainerToolRunner, type D3ContainerToolsObservation } from './controlled-recovery-d4-tools';
import { DirectD3ToolExecution } from './controlled-recovery-d3-execution';
import { DurableD3PublicationStore } from './controlled-recovery-d3-publication';
import { DurableD3AgeIdentity } from './controlled-recovery-d3-age-identity';
import { d3SourceBackupProfileSchema, fixedD3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import { DurableD3SourceState } from './controlled-recovery-d3-source-state';
import { EnrolledD3SourceCrypto, D3_OPENSSL } from './controlled-recovery-d3-source-crypto';
import { ProtectedD3SourceLayout } from './controlled-recovery-d3-source-layout';
import { EnrolledD3SourceExecutor } from './controlled-recovery-d3-source-executor';
import { ProtectedD3SourceVolumes } from './controlled-recovery-d3-source-volumes';
import { ProtectedD3SourceHealth } from './controlled-recovery-d3-source-health';
import { D3_MINIO_FILE_CREDENTIALS, D3_SOURCE_HELPER_CAPABILITY } from './controlled-recovery-d3-source-enrollment';
import { loadD3SourceDataProfile } from './controlled-recovery-d3-source-data-profile';
import { loadD3CapsuleProfile } from './controlled-recovery-d3-capsule-profile';
import { ProtectedD3AgeStaging, readD3AgePublicReceipt } from './controlled-recovery-d3-age-staging';
import { ProtectedD3LegacyAgeHandoff } from './controlled-recovery-d3-age-legacy-handoff';
import { d3StagingProcessIdentity } from './controlled-recovery-d3-age-staging';
import { ProtectedD3Capsule, type D3CapsuleDependencies } from './controlled-recovery-d3-capsule';
import { DurableD3SourceData } from './controlled-recovery-d3-source-data';
import { loadD3ReservationProfile } from './controlled-recovery-d3-reservation-profile';
import { ProtectedD3ReservationPrerequisites } from './controlled-recovery-d3-reservation-prerequisites';
import { d3ReservationSessionFactory, FixedD3BackupReservation } from './controlled-recovery-d3-reservation';
import { loadD3BrokerProfile } from './controlled-recovery-d3-broker-profile';
import { verifyD3BrokerInventory } from './controlled-recovery-d3-broker-enrollment';
import { ProtectedD3BrokerPrerequisites } from './controlled-recovery-d3-broker-prerequisites';
import { DirectD3BrokerProcess, UnenrolledD3BrokerScope } from './controlled-recovery-d3-broker-process';
import { ProtectedD3BrokerStorage } from './controlled-recovery-d3-broker-storage';
import { LinuxD3BrokerHost } from './controlled-recovery-d3-broker-host';
import { FixedD3Broker, verifyD3BrokerCapabilities } from './controlled-recovery-d3-broker';
import { loadD3CaptureProfile, d3CaptureDisabledStatus } from './controlled-recovery-d3-capture-profile';

const sha = z.string().regex(/^[a-f0-9]{64}$/).refine((value) => !/^([a-f0-9])\1{63}$/.test(value), 'Placeholder digest is forbidden.');
const path = z.string().startsWith('/').max(512).refine((value) => !value.includes('.example') && !value.includes('..') && !/[\s,\0]/u.test(value));
const image = z.object({ role: z.enum(['postgres', 'minio', 'valkey', 'tools']), reference: z.string().min(1).refine((value) => !value.includes('registry.invalid')),
  image_id: z.string().regex(/^sha256:[a-f0-9]{64}$/), repo_digest: z.string().regex(/^[a-z0-9./-]+@sha256:[a-f0-9]{64}$/) }).strict();
const asset = z.object({ role: z.enum(['node20', 'server', 'cms', 'player', 'chromium', 'electron', 'cms-launcher', 'browser-launcher', 'player-launcher']), path, sha256: sha, executable: z.boolean() }).strict();
export const d3FoundationProfileSchema = z.object({
  format: z.literal('darshan-development-d3-foundation-v1'), non_production: z.literal(true), whole_run_enabled: z.literal(false),
  operation_id: z.literal(D3_OPERATION_ID), repository_id: z.literal(D3_REPOSITORY_ID), site_id: z.literal(D3_SITE_ID),
  release_id: z.literal('release-03'), schema_id: z.literal('0057_controlled_recovery_report_projection'), root: z.literal(D3_ROOT),
  owner: z.object({ uid: z.number().int().nonnegative(), gid: z.number().int().nonnegative() }).strict(),
  docker: z.object({ executable: z.literal('/usr/bin/docker'), config: z.literal('/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config'),
    context: z.literal('default'), endpoint: z.literal('unix:///var/run/docker.sock'), images: z.array(image).length(4) }).strict(),
  assets: z.array(asset).length(9),
  resources: z.array(z.object({ role: z.enum(['postgres', 'minio', 'valkey', 'api', 'worker', 'cms', 'browser', 'player', 'controller']), name: z.string().regex(/^darshan-d2-20261030-[a-z]+$/),
    memory_bytes: z.string().regex(/^[1-9][0-9]*$/), pids_limit: z.number().int().positive().max(1024), nano_cpus: z.string().regex(/^[1-9][0-9]*$/) }).strict()).length(9),
  tools_config_sha256: sha, tools_lock_sha256: sha, tools_dockerfile_sha256: sha,
  tool_wrapper: z.object({ entrypoint: z.literal('/usr/local/bin/darshan-d3-tool'), source_path: z.literal('/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tools/darshan-d3-tool.c'),
    source_sha256: sha, binary_sha256: sha, build_base_apk_version: z.literal('0.5-r4'), umask: z.literal('0077') }).strict(),
  tool_caps: z.object({ memory_bytes: z.literal('268435456'), pids_limit: z.literal(32), nano_cpus: z.literal('500000000'), network: z.literal('none'),
    read_only_root: z.literal(true), cap_drop: z.literal('ALL'), timeout_ms: z.literal(120000), maximum_output_bytes: z.literal(1048576) }).strict(),
  capacity: z.object({ required_available_ram_bytes: z.literal('2717908992'), host_reserve_bytes: z.literal('536870912'), maximum_dataset_bytes: z.literal('33554432') }).strict(),
  source_backup: d3SourceBackupProfileSchema,
  source_runtime: z.object({ openssl: z.object({ path: z.literal(D3_OPENSSL.path), sha256: z.literal(D3_OPENSSL.sha256), version: z.literal(D3_OPENSSL.version), ownerUid: z.literal(0), ownerGid: z.literal(0), mode: z.literal('0755') }).strict(),
    materializer: z.object({ imageId: z.literal(D3_SOURCE_HELPER_CAPABILITY.imageId), observedByRoot: z.literal(true), networkNone: z.literal(true), install: z.literal('/usr/bin/install'), stat: z.literal('/bin/stat'), sha256sum: z.literal('/usr/bin/sha256sum'), sync: z.literal('/bin/sync'), minioBinaryFileCredentialsVerified: z.literal(true) }).strict(),
    minio_file_credentials: z.object({ verified: z.literal(true), imageId: z.literal(D3_MINIO_FILE_CREDENTIALS.imageId), evidencePath: z.literal(D3_MINIO_FILE_CREDENTIALS.evidencePath), evidenceSha256: z.literal(D3_MINIO_FILE_CREDENTIALS.evidenceSha256) }).strict() }).strict(),
}).strict();
export type D3FoundationProfile = z.infer<typeof d3FoundationProfileSchema>;
export const D3_FOUNDATION_PROFILE_PATH = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-d3.runtime-profile.json';

export async function loadD3FoundationProfile(): Promise<D3FoundationProfile> {
  const handle = await open(D3_FOUNDATION_PROFILE_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o664 || stat.size > 128 * 1024) throw new Error('unsafe');
    const bytes = await handle.readFile(); const value = d3FoundationProfileSchema.parse(parseStrictJson(bytes, 128 * 1024));
    if (!canonicalJson(value).equals(bytes)) throw new Error('canonical'); return value;
  } catch { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PROFILE_INVALID', 'The fixed development runtime profile is invalid.'); }
  finally { await handle.close(); }
}

export const D3_REMAINING_BOUNDARIES = Object.freeze([
  'liveSourceSqlAndObjectSeedAcceptance', 'sourceServiceTlsSecretsAndCgroups', 'brokerPolicyTrustAndTransactionalOperationBackupBinding', 'signedConfigurationCapsule', 'enrolledBrokerControllerScopeAndLiveInheritedFdAcceptance',
  'liveCaptureExecutableFingerprintsAndDeterministicTarProof', 'acceptedBrokeredCaptureComposition', 'restoreTargetsAndArtifactVerification', 'runtimeLayoutAndReadinessMeasurements', 'apiCmsAndActualPlayerValidation',
  'separatePromotionAndWriteFreeze', 'rollbackOriginalTargetAuthority', 'retainedOwnershipCleanup',
] as const);

/** This factory verifies reusable components. It deliberately cannot return a whole-run harness boundary. */
export async function loadD3Foundation(input: { toolsObservation?: D3ContainerToolsObservation } = {}) {
  const [profile, d2, d3] = await Promise.all([loadD3FoundationProfile(), loadDevelopmentD2Activation(), loadDevelopmentD3Activation()]);
  const authority = deriveD3OperationAuthority(d2); const tools = d3.container_tools;
  const expectedImages = [...d2.images, { role: 'tools', reference: tools.image_reference, image_id: tools.image_id, repo_digest: tools.repo_digest }];
  if (d2.enabled || digest(d2) !== d3.d2_activation_sha256 || profile.owner.uid !== authority.ownerUid || profile.owner.gid !== authority.ownerGid ||
      digest(profile.resources) !== digest(d2.resources) || digest(profile.docker.images) !== digest(expectedImages) || d2.images.find(({ role }) => role === 'minio')?.image_id !== D3_MINIO_FILE_CREDENTIALS.imageId ||
      profile.tools_config_sha256 !== tools.config_sha256 || profile.tools_lock_sha256 !== tools.lock_sha256 || profile.tools_dockerfile_sha256 !== tools.dockerfile_sha256 ||
      profile.tool_wrapper.source_sha256 !== tools.wrapper_sha256 || profile.tool_wrapper.binary_sha256 !== tools.wrapper_binary_sha256 ||
      digest(profile.source_backup) !== digest(fixedD3SourceBackupProfile(authority.ownerUid, authority.ownerGid)) ||
      new Set(profile.assets.map(({ role }) => role)).size !== 9)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PROFILE_BINDING_CHANGED', 'The real development runtime profile differs from its D2/D3 enrollment.');
  await verifyDevelopmentD3PacketAssets(d3);
  const sourceDataEnrollment = await loadD3SourceDataProfile(); if (sourceDataEnrollment.profile.source_profile_sha256 !== digest(profile)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_DATA_PROFILE_INVALID', 'The bounded data profile differs from retained source authority.');
  const capsuleEnrollment = await loadD3CapsuleProfile(); if (capsuleEnrollment.profile.source_profile_sha256 !== digest(profile) || capsuleEnrollment.profile.data_profile_sha256 !== sourceDataEnrollment.sha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPSULE_BINDING_CHANGED', 'The disabled capsule profile differs from retained source/data authority.');
  const reservationEnrollment = await loadD3ReservationProfile(); if (reservationEnrollment.profile.source_profile_sha256 !== digest(profile) || reservationEnrollment.profile.data_profile_sha256 !== sourceDataEnrollment.sha256 || reservationEnrollment.profile.capsule_profile_sha256 !== capsuleEnrollment.sha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RESERVATION_PROFILE_INVALID', 'The disabled reservation profile differs from accepted source/data/capsule authority.');
  const brokerEnrollment = await loadD3BrokerProfile(); if (brokerEnrollment.profile.source_profile_sha256 !== digest(profile) || brokerEnrollment.profile.data_profile_sha256 !== sourceDataEnrollment.sha256 || brokerEnrollment.profile.capsule_profile_sha256 !== capsuleEnrollment.sha256 || brokerEnrollment.profile.reservation_profile_sha256 !== reservationEnrollment.sha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BROKER_PROFILE_INVALID', 'The disabled broker profile differs from accepted source/data/capsule/reservation authority.');
  const captureEnrollment = await loadD3CaptureProfile(); if (captureEnrollment.profile.broker_profile_sha256 !== brokerEnrollment.sha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPTURE_UNVERIFIED','The disabled capture profile differs from accepted broker authority.');
  for (const [path, expected] of [[tools.lock_path, tools.lock_sha256], [tools.dockerfile_path, tools.dockerfile_sha256], [D3_MINIO_FILE_CREDENTIALS.evidencePath, D3_MINIO_FILE_CREDENTIALS.evidenceSha256]] as const) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== authority.ownerUid || stat.size > 128 * 1024 || createHash('sha256').update(await handle.readFile()).digest('hex') !== expected)
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PROFILE_ASSET_CHANGED', 'An enrolled tools source changed.'); }
    finally { await handle.close(); }
  }
  const expectedPaths = {
    node20: d3.tools.find(({ role }) => role === 'node20')!.path,
    server: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/dist/index.js', cms: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/dist/index.html',
    player: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player/dist/main/main/index.js', chromium: d3.tools.find(({ role }) => role === 'playwright-chromium')!.path,
    electron: d3.tools.find(({ role }) => role === 'electron-player')!.path,
    'cms-launcher': '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-static-cms.mjs',
    'browser-launcher': '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-cms-live.mjs',
    'player-launcher': '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-player-bootstrap.mjs',
  };
  for (const asset of profile.assets) {
    const handle = await open(asset.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); const hash = createHash('sha256');
      if (asset.path !== expectedPaths[asset.role] || await realpath(asset.path) !== asset.path || !stat.isFile() || stat.nlink !== 1 || stat.uid !== authority.ownerUid ||
          (stat.mode & 0o002) !== 0 || ((stat.mode & 0o111) !== 0) !== asset.executable || stat.size > 256 * 1024 * 1024) throw new Error('unsafe');
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      if (hash.digest('hex') !== asset.sha256) throw new Error('changed');
    } catch { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PROFILE_ASSET_CHANGED', 'An enrolled runtime asset changed.'); }
    finally { await handle.close(); }
  }
  const toolsAuthority = { enrolled: tools.enrolled, imageReference: tools.image_reference, imageId: tools.image_id, repoDigest: tools.repo_digest,
    wrapperSourceSha256: tools.wrapper_sha256, wrapperBinarySha256: tools.wrapper_binary_sha256, buildBasePackageVersion: tools.build_base_apk_version,
    configSha256: tools.config_sha256, dockerfileSha256: tools.dockerfile_sha256, lockSha256: tools.lock_sha256, agePackageVersion: tools.age_package_version, ffmpegPackageVersion: tools.ffmpeg_package_version };
  if (input.toolsObservation) assertD3ContainerToolsImage(toolsAuthority, input.toolsObservation);
  const execution = new DirectD3ToolExecution(authority, Object.freeze(toolsAuthority));
  const containerTools = new D3ContainerToolRunner(toolsAuthority, execution, authority);
  const sourceState = new DurableD3SourceState(authority, digest(profile)); const sourceCrypto = new EnrolledD3SourceCrypto(authority); await sourceCrypto.run('version', 'ca');
  const sourceLayout = new ProtectedD3SourceLayout(authority, async () => (await sourceState.stages()).length > 0, sourceCrypto);
  const sourceExecutor = new EnrolledD3SourceExecutor(authority, d2, profile.source_backup, sourceState, sourceLayout);
  const sourceVolumes = new ProtectedD3SourceVolumes(authority, profile.source_backup, sourceState, sourceLayout, sourceExecutor);
  const sourceHealth = new ProtectedD3SourceHealth(authority, profile.source_backup, sourceLayout, (role, id) => sourceExecutor.verifyProbeTarget(role, id));
  const ageIdentity = new DurableD3AgeIdentity(authority, { imageId: toolsAuthority.imageId!, configSha256: toolsAuthority.configSha256! }, containerTools);
  const capsuleProvider = (dependencies: Pick<D3CapsuleDependencies, 'admit' | 'withOperationLock' | 'dataStatus' | 'expected' | 'verifyRetainedIdentity' | 'operationOwnership' | 'onVerified'>) => new ProtectedD3Capsule({ ...dependencies, authority, profile: capsuleEnrollment.profile, profileSha256: capsuleEnrollment.sha256, state: sourceState,
    data: new DurableD3SourceData(authority, digest(profile), sourceDataEnrollment.sha256), layout: sourceLayout.readOnlyView(), publicAgeReceipt: () => readD3AgePublicReceipt(authority, toolsAuthority),
    ageIdentity: () => ageIdentity.readOrCreate({ allowCreate: false, dependentAuthorityExists: true }), age: new ProtectedD3AgeStaging(authority, toolsAuthority, execution, dependencies.admit, undefined, undefined, undefined, undefined, new ProtectedD3LegacyAgeHandoff(authority, toolsAuthority, d3StagingProcessIdentity)) });
  const reservationProvider = (dependencies: Pick<D3CapsuleDependencies, 'admit' | 'withOperationLock' | 'dataStatus'>) => new FixedD3BackupReservation({ ...dependencies,
    profile: reservationEnrollment.profile, profileSha256: reservationEnrollment.sha256,
    prerequisites: new ProtectedD3ReservationPrerequisites({ authority, profile: reservationEnrollment.profile, profileSha256: reservationEnrollment.sha256, state: sourceState,
      data: new DurableD3SourceData(authority, digest(profile), sourceDataEnrollment.sha256), layout: sourceLayout.readOnlyView(), capsule: capsuleProvider(dependencies), publicAgeReceipt: () => readD3AgePublicReceipt(authority, toolsAuthority) }),
    session: d3ReservationSessionFactory(authority, profile.source_backup, sourceLayout.readOnlyView(), reservationEnrollment.profile) });
  const brokerProvider = (dependencies: Pick<D3CapsuleDependencies, 'admit' | 'withOperationLock' | 'dataStatus'>) => {
    const scope = new UnenrolledD3BrokerScope();
    const source = new ProtectedD3ReservationPrerequisites({ authority, profile: reservationEnrollment.profile, profileSha256: reservationEnrollment.sha256, state: sourceState, data: new DurableD3SourceData(authority, digest(profile), sourceDataEnrollment.sha256), layout: sourceLayout.readOnlyView(), capsule: capsuleProvider(dependencies), publicAgeReceipt: () => readD3AgePublicReceipt(authority, toolsAuthority) });
    return new FixedD3Broker({ ...dependencies, profile: brokerEnrollment.profile, profileSha256: brokerEnrollment.sha256, inventory: brokerEnrollment.inventory,
      prerequisites: new ProtectedD3BrokerPrerequisites({ authority, profile: brokerEnrollment.profile, profileSha256: brokerEnrollment.sha256, source, reservation: reservationProvider(dependencies), capsule: capsuleProvider(dependencies) }),
      scope, host: new LinuxD3BrokerHost(brokerEnrollment.profile, brokerEnrollment.inventory, scope), storage: new ProtectedD3BrokerStorage(authority), process: new DirectD3BrokerProcess(brokerEnrollment.profile),
      verifyEnrollment: () => verifyD3BrokerInventory(brokerEnrollment.profile.inventory_sha256), verifyCapabilities: (input, signal) => verifyD3BrokerCapabilities(brokerEnrollment.profile, input, signal) });
  };
  return Object.freeze({ authority, profile, developmentActivation: d2, toolsAuthority, verifiedComponents: ['operationAuthority', 'runtimeFileEnrollment', 'hostTools'] as const,
    components: { execution, containerTools, ageIdentity,
      publications: new DurableD3PublicationStore(authority), sourceState, sourceCrypto, sourceLayout, sourceExecutor, sourceVolumes, sourceHealth, sourceDataEnrollment, capsuleEnrollment, capsuleActivationSha256: d3.packet_assets.find(({ role }) => role === 'd3-capsule-activation-json')!.sha256, capsuleProvider, reservationEnrollment, reservationProvider, brokerEnrollment, brokerProvider, captureEnrollment, captureStatus: () => d3CaptureDisabledStatus(captureEnrollment.profile) },
    liveToolsImageVerified: input.toolsObservation !== undefined, missingRequirements: [...D3_REMAINING_BOUNDARIES, 'liveSourceMaterializationAndTlsProbes', ...(input.toolsObservation ? [] : ['liveToolsImageObservation'])] });
}
