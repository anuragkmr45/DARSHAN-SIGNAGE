import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { validateAgeX25519Recipient } from '../../src/backups/encryption';
import { D3_ROOT, D3_OPERATION_ID, type D3OperationAuthority } from './controlled-recovery-d3-authority';

const ROOT = D3_ROOT;
const DOCKER = '/usr/bin/docker'; const DOCKER_CONFIG = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config';
const IMAGE_REFERENCE = 'darshan-d3-tools:packet-d4';
export const D3_TOOL_WRAPPER = '/usr/local/bin/darshan-d3-tool';
export const D3_TOOL_ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' });
const env = D3_TOOL_ENV;
const sha = (value: string | null): value is string => value !== null && /^[a-f0-9]{64}$/.test(value);
const imageId = (value: string | null): value is string => value !== null && /^sha256:[a-f0-9]{64}$/.test(value);

export interface D3ContainerToolsAuthority { enrolled: boolean; imageReference: typeof IMAGE_REFERENCE; imageId: string | null; repoDigest: string | null; configSha256: string | null;
  dockerfileSha256: string; lockSha256: string; agePackageVersion: string | null; ffmpegPackageVersion: string | null;
  wrapperSourceSha256: string; wrapperBinarySha256: string | null; buildBasePackageVersion: string; }
export interface D3ContainerToolsObservation { imageId: string; repoDigests: readonly string[]; configSha256: string; labels: Readonly<Record<string, string>>; }
export type D3ToolComponent = 'age-version' | 'age-fingerprint' | 'age-keygen' | 'age-recipient' | 'age-encrypt' | 'age-decrypt' | 'ffprobe' | 'ffmpeg';
export interface D3ContainerToolExecution { runFixed(input: { executable: typeof DOCKER; argv: readonly string[]; env: typeof env; timeoutMs: number; maximumOutputBytes: number;
  owned: { operationId: string; component: D3ToolComponent; containerName: string; cidfile: string; slot: 'age' | 'media'; recipient?: string }; signal?: AbortSignal }): Promise<{ exitCode: number; stdout: Uint8Array; stderr: Uint8Array }>;
  terminateAndJoin(containerName: string, timeoutMs: number): Promise<void>;
  assertSharedAgeOwnership?(): Promise<{ device: string; inode: string }>; }

export function assertD3ContainerToolsImage(authority: D3ContainerToolsAuthority, observed: D3ContainerToolsObservation | null): string {
  if (!authority.enrolled || !imageId(authority.imageId) || !authority.repoDigest?.match(/^darshan-d3-tools@sha256:[a-f0-9]{64}$/) || !sha(authority.configSha256) ||
      !sha(authority.dockerfileSha256) || !sha(authority.lockSha256) || !sha(authority.wrapperSourceSha256) || !sha(authority.wrapperBinarySha256) || !authority.agePackageVersion || !authority.ffmpegPackageVersion || !observed || observed.imageId !== authority.imageId ||
      !observed.repoDigests.includes(authority.repoDigest) || observed.configSha256 !== authority.configSha256 || observed.labels['com.darshan.development-only'] !== 'true' ||
      observed.labels['com.darshan.d3.role'] !== 'container-tools' || observed.labels['com.darshan.d3.age-apk-version'] !== authority.agePackageVersion ||
      observed.labels['com.darshan.d3.ffmpeg-apk-version'] !== authority.ffmpegPackageVersion ||
      observed.labels['com.darshan.d3.wrapper-source-sha256'] !== authority.wrapperSourceSha256 || observed.labels['com.darshan.d3.wrapper-umask'] !== '0077' ||
      observed.labels['com.darshan.d3.wrapper-build-base-apk-version'] !== authority.buildBasePackageVersion)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_UNAVAILABLE', 'The fixed development tools image is missing, changed, or unenrolled.');
  return digest({ imageId: observed.imageId, repoDigest: authority.repoDigest, configSha256: observed.configSha256, labels: observed.labels });
}

type Mount = { source: string; destination: string; readonly: boolean };
export function fixedD3ToolInvocation(authority: D3ContainerToolsAuthority, operation: D3OperationAuthority, component: D3ToolComponent, recipient?: string) {
  if (operation.operationId !== D3_OPERATION_ID || operation.root !== ROOT || operation.ownerUid !== process.getuid?.() || operation.ownerGid !== process.getgid?.())
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_INPUT_INVALID', 'The tool operation or enrolled developer UID:GID differs.');
  if (component === 'age-encrypt') validateAgeX25519Recipient(recipient ?? '');
  else if (recipient !== undefined) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_INPUT_INVALID', 'Unexpected tool recipient.');
  const key = { source: `${ROOT}/keys/recovery.age`, destination: '/key/recovery.age', readonly: true };
  const plans: Record<D3ToolComponent, { entrypoint: string; command: string[]; mounts: Mount[] }> = {
    'age-version': { entrypoint: '/usr/bin/age', command: ['--version'], mounts: [] },
    'age-fingerprint': { entrypoint: '/usr/bin/sha256sum', command: ['/usr/bin/age'], mounts: [] },
    'age-keygen': { entrypoint: '/usr/bin/age-keygen', command: ['-o', '/output/recovery.age'], mounts: [{ source: `${ROOT}/keys/pending`, destination: '/output', readonly: false }] },
    'age-recipient': { entrypoint: '/usr/bin/age-keygen', command: ['-y', '/key/recovery.age'], mounts: [key] },
    'age-encrypt': { entrypoint: '/usr/bin/age', command: ['-r', recipient ?? '', '-o', '/output/artifact.age', '/input/plain.tar'], mounts: [{ source: `${ROOT}/staging/encrypt-input`, destination: '/input', readonly: true }, { source: `${ROOT}/staging/encrypt-output`, destination: '/output', readonly: false }] },
    'age-decrypt': { entrypoint: '/usr/bin/age', command: ['-d', '-i', '/key/recovery.age', '-o', '/output/plain.tar', '/input/artifact.age'], mounts: [key, { source: `${ROOT}/staging/decrypt-input`, destination: '/input', readonly: true }, { source: `${ROOT}/staging/decrypt-output`, destination: '/output', readonly: false }] },
    ffprobe: { entrypoint: '/usr/bin/ffprobe', command: ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height', '-of', 'json', '/input/media'], mounts: [{ source: `${ROOT}/media/input`, destination: '/input', readonly: true }] },
    ffmpeg: { entrypoint: '/usr/bin/ffmpeg', command: ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', '/input/media', '-map_metadata', '-1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '/output/media.mp4'], mounts: [{ source: `${ROOT}/media/input`, destination: '/input', readonly: true }, { source: `${ROOT}/media/output`, destination: '/output', readonly: false }] },
  };
  const plan = plans[component]; if (!plan) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_INPUT_INVALID', 'Unknown fixed tool component.');
  const name = `darshan-d3-tools-${operation.operationId}-${component}`; const cidfile = `${ROOT}/run/tool-slots/${component}.cid`;
  const mountArgs = plan.mounts.flatMap((mount) => ['--mount', `type=bind,src=${mount.source},dst=${mount.destination}${mount.readonly ? ',readonly' : ''}`]);
  const argv = ['--config', DOCKER_CONFIG, '--context', 'default', 'container', 'run', '--pull=never', '--name', name, '--cidfile', cidfile,
    '--label', `com.darshan.d3.operation=${operation.operationId}`, '--label', `com.darshan.d3.component=${component}`, '--label', 'com.darshan.development-only=true',
    '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--pids-limit', '32', '--memory', '268435456', '--cpus', '0.50',
    '--user', `${operation.ownerUid}:${operation.ownerGid}`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--env', 'HOME=/nonexistent', '--env', 'LANG=C',
    '--tmpfs', `/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=1m,uid=${operation.ownerUid},gid=${operation.ownerGid},mode=0700`,
    ...mountArgs, '--entrypoint', component === 'age-fingerprint' ? plan.entrypoint : D3_TOOL_WRAPPER, authority.imageId!, ...(component === 'age-fingerprint' ? [] : [plan.entrypoint]), ...plan.command];
  return { argv, mounts: plan.mounts, owned: { operationId: operation.operationId, component, containerName: name, cidfile, slot: component.startsWith('age-') ? 'age' as const : 'media' as const, ...(recipient ? { recipient } : {}) } };
}
export class D3ContainerToolRunner {
  constructor(private readonly authority: D3ContainerToolsAuthority, private readonly execution: D3ContainerToolExecution, private readonly operation: D3OperationAuthority) {
    if (!authority.enrolled || !imageId(authority.imageId) || !sha(authority.configSha256)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_UNAVAILABLE', 'The fixed development tools image is not enrolled.');
  }
  private async run(component: D3ToolComponent, signal?: AbortSignal, recipient?: string) {
    if (signal?.aborted) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED', 'The fixed container-tool operation was cancelled before dispatch.');
    const { argv, owned } = fixedD3ToolInvocation(this.authority, this.operation, component, recipient);
    // The concrete executor owns cancellation and joins both CLI and exact container before settling.
    const result = await this.execution.runFixed({ executable: DOCKER, argv, owned, env, timeoutMs: 120_000, maximumOutputBytes: 1024 * 1024, ...(signal ? { signal } : {}) });
    if (result.exitCode !== 0 || result.stdout.byteLength > 1024 * 1024 || result.stderr.byteLength > 1024 * 1024)
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_FAILED', 'The fixed container-tool operation failed.');
    return result;
  }
  ageVersion(signal?: AbortSignal) { return this.run('age-version', signal); }
  async ageFingerprint(signal?: AbortSignal) { const version = Buffer.from((await this.ageVersion(signal)).stdout).toString('utf8').trim(); const text = Buffer.from((await this.run('age-fingerprint', signal)).stdout).toString('utf8'); const match = /^([a-f0-9]{64}) {2}\/usr\/bin\/age\n$/.exec(text); if (!match || !/^v?[0-9]+\.[0-9]+\.[0-9]+$/.test(version) || version.replace(/^v/,'') !== this.authority.agePackageVersion?.replace(/-r[0-9]+$/,'') || match[1] === this.authority.imageId?.slice(7) || match[1] === this.authority.configSha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPTURE_FINGERPRINT_CHANGED', 'The fixed age executable byte fingerprint or version is unverified.'); return { path: '/usr/bin/age' as const, version, executableSha256: match[1]!, imageId: this.authority.imageId! }; }
  async ageKeygen(signal?: AbortSignal): Promise<void> { await this.run('age-keygen', signal); }
  async ageRecipient(signal?: AbortSignal) { const result = await this.run('age-recipient', signal); const recipient = Buffer.from(result.stdout).toString('utf8').trim();
    try { validateAgeX25519Recipient(recipient); } catch { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_FAILED', 'The derived age public recipient is invalid.'); } return { recipient }; }
  ageEncrypt(recipient: string, signal?: AbortSignal) { validateAgeX25519Recipient(recipient); return this.run('age-encrypt', signal, recipient); }
  ageDecrypt(signal?: AbortSignal) { return this.run('age-decrypt', signal); }
  ffprobe(signal?: AbortSignal) { return this.run('ffprobe', signal); }
  ffmpegTranscode(signal?: AbortSignal) { return this.run('ffmpeg', signal); }
}

export class D3ContainerizedRecoveryTools { constructor(private readonly tools: D3ContainerToolRunner) {} decryptArchive(signal?: AbortSignal) { return this.tools.ageDecrypt(signal); } }
export class D3ContainerizedMediaTools { constructor(private readonly tools: D3ContainerToolRunner) {} validate(signal?: AbortSignal) { return this.tools.ffprobe(signal); } transcode(signal?: AbortSignal) { return this.tools.ffmpegTranscode(signal); } }
