import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runPacketCE2E, type PacketCE2EHarnessBoundary } from '../../src/recovery/controlled-docker/controlled-recovery-e2e-harness';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { loadDevelopmentD3Activation, verifyDevelopmentD3PacketAssets, type DevelopmentD3Activation } from './controlled-recovery-d3-activation';
import { assertD3ContainerToolsImage, type D3ContainerToolsObservation } from './controlled-recovery-d4-tools';
import { D3_REMAINING_BOUNDARIES } from './controlled-recovery-d3-foundation';

export interface DevelopmentD3ControllerDependencies {
  loadActivation(): Promise<DevelopmentD3Activation>;
  verifyAssets(value: DevelopmentD3Activation): Promise<{ profileSha256: string }>;
  observeContainerTools(value: DevelopmentD3Activation): Promise<D3ContainerToolsObservation | null>;
  constructBoundary(value: DevelopmentD3Activation): Promise<PacketCE2EHarnessBoundary>;
}
const execute = promisify(execFile);
const dockerEnvironment = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' });
async function observeInstalledContainerTools(value: DevelopmentD3Activation): Promise<D3ContainerToolsObservation | null> {
  const imageId = value.container_tools.image_id; if (!imageId) return null;
  let stdout: string; try { ({ stdout } = await execute('/usr/bin/docker', ['--config', '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config', '--context', 'default',
      'image', 'inspect', imageId], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, env: dockerEnvironment })); }
  catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_UNAVAILABLE', 'The enrolled development tools image could not be observed.', { cause }); }
  let entries: Array<{ Id?: string; RepoDigests?: string[]; Config?: { Labels?: Record<string, string> } }>;
  try { entries = JSON.parse(stdout) as typeof entries; } catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_UNAVAILABLE', 'The tools-image observation is invalid.', { cause }); }
  if (entries.length !== 1 || !entries[0]?.Id || !entries[0].Config) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_UNAVAILABLE', 'The tools-image observation is incomplete.');
  return { imageId: entries[0].Id, repoDigests: entries[0].RepoDigests ?? [], configSha256: digest(entries[0].Config), labels: entries[0].Config.Labels ?? {} };
}
export const DEVELOPMENT_D3_MISSING_INSTALLED_BOUNDARIES = Object.freeze({
  remainingConcreteAuthorities: D3_REMAINING_BOUNDARIES,
  workflowAuthority: ['operationId', 'siteId', 'recoveryKeyFile', 'profile', 'packet1', 'packet2', 'promotion', 'rollback', 'playwrightSha256', 'electronSha256'],
  system: ['seedSql', 'backup', 'containerTools', 'publications', 'source', 'recoveredApi', 'cms', 'player', 'worker', 'evidence', 'cleanup'],
  runtime: ['readiness', 'invariants', 'measurements'],
  reusableImplementations: ['createDevelopmentD3FixedEffects', 'createDevelopmentD3Boundary', 'D3ContainerToolRunner', 'FixedD3Docker', 'FixedD3ProcessSupervisor', 'ComposedD3ReadinessObserver'],
});
const installed: DevelopmentD3ControllerDependencies = { loadActivation: loadDevelopmentD3Activation, verifyAssets: verifyDevelopmentD3PacketAssets,
  observeContainerTools: observeInstalledContainerTools,
  async constructBoundary() { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_DEPENDENCIES_NOT_ENROLLED', 'D3 low-level system authority is not enrolled.'); } };

export async function loadCheckedInD3Boundary(dependencies: DevelopmentD3ControllerDependencies = installed) {
  const activation = await dependencies.loadActivation();
  if (activation.enabled !== true) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_NOT_ACTIVATED', 'D3 activation remains disabled.');
  if (activation.tools.some((tool) => !tool.enrolled || !tool.sha256 || !tool.version) || !activation.container_tools.enrolled || !activation.container_tools.image_id || !activation.container_tools.repo_digest || !activation.container_tools.config_sha256)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE', 'D3 host or container tool identities are not enrolled.');
  const verified = await dependencies.verifyAssets(activation);
  for (const tool of activation.tools) { const bytes = await readFile(tool.path); if (createHash('sha256').update(bytes).digest('hex') !== tool.sha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE', 'A D3 tool identity changed.'); }
  const authority = { enrolled: activation.container_tools.enrolled, imageReference: activation.container_tools.image_reference, imageId: activation.container_tools.image_id,
    repoDigest: activation.container_tools.repo_digest, configSha256: activation.container_tools.config_sha256, dockerfileSha256: activation.container_tools.dockerfile_sha256,
    wrapperSourceSha256: activation.container_tools.wrapper_sha256, wrapperBinarySha256: activation.container_tools.wrapper_binary_sha256, buildBasePackageVersion: activation.container_tools.build_base_apk_version,
    lockSha256: activation.container_tools.lock_sha256, agePackageVersion: activation.container_tools.age_package_version, ffmpegPackageVersion: activation.container_tools.ffmpeg_package_version } as const;
  assertD3ContainerToolsImage(authority, await dependencies.observeContainerTools(activation));
  return { boundary: await dependencies.constructBoundary(activation), profileSha256: verified.profileSha256 };
}

export async function runCheckedInD3Controller(dependencies: DevelopmentD3ControllerDependencies = installed) {
  const { boundary, profileSha256 } = await loadCheckedInD3Boundary(dependencies); return runPacketCE2E({ activation: { mode: 'TINY_DISPOSABLE_PACKET_C', nonProduction: true, siteId: 'tiny-d1-development',
    profileSha256, packetAEnrolled: true, packetBEnrolled: true, packetCEnrolled: true }, confirmation: 'RUN_TINY_DISPOSABLE_PACKET_C', boundary });
}

const invokedAsProgram = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsProgram) {
  runCheckedInD3Controller().then(
    () => { process.stdout.write(`${JSON.stringify({ status: 'completed', code: 'CONTROLLED_RECOVERY_D3_COMPLETED' })}\n`); },
    (cause: unknown) => {
      const code = cause instanceof ControlledRecoveryError ? cause.code : 'CONTROLLED_RECOVERY_D3_FAILED';
      process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
      process.exitCode = 1;
    },
  );
}
