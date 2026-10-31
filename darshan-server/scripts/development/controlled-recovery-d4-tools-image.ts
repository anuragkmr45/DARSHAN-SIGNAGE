import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { digest, sha256 } from '../../src/recovery/controlled-docker/contracts';

const execute = promisify(execFile); const docker = '/usr/bin/docker';
const root = '/home/hexmon/Desktop/DARSHAN-SIGNAGE'; const context = `${root}/deploy/development/controlled-recovery/tools`;
const lockPath = `${context}/tool-image.lock.json`; const dockerfile = `${context}/Dockerfile`; const image = 'darshan-d3-tools:packet-d4';
type Lock = { enrolled: boolean; dockerfile: { sha256: string }; packages: { age: { version: string | null }; ffmpeg: { version: string | null } }; image: { reference: string };
  wrapper: { source_path: string; source_sha256: string; binary_path: string; binary_sha256: string | null; umask: string }; build_dependencies: { apk: string; version: string | null } };
async function lock(): Promise<Lock> { const handle = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW); try { const bytes = await handle.readFile(); const value = parseStrictJson(bytes, 128 * 1024) as Lock;
    if (!canonicalJson(value).equals(bytes) || value.image.reference !== image) throw new Error('D4 tools lock is invalid'); return value; } finally { await handle.close(); } }
async function dockerfileHash(): Promise<string> { const handle = await open(dockerfile, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1) throw new Error('unsafe Dockerfile'); return sha256(await handle.readFile()); } finally { await handle.close(); } }
async function main() { const action = process.argv[2]; if (!['build', 'inspect'].includes(action ?? '') || process.argv.length !== 3) throw new Error('Usage: controlled-recovery-d4-tools-image.ts build|inspect'); const value = await lock();
  if (await dockerfileHash() !== value.dockerfile.sha256) throw new Error('D4 Dockerfile identity changed');
  const source = await open(`${context}/darshan-d3-tool.c`, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await source.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 || sha256(await source.readFile()) !== value.wrapper.source_sha256 ||
      value.wrapper.source_path !== `${context}/darshan-d3-tool.c` || value.wrapper.binary_path !== '/usr/local/bin/darshan-d3-tool' || value.wrapper.umask !== '0077') throw new Error('D4 wrapper identity changed'); }
  finally { await source.close(); }
  if (action === 'build') { if (!value.packages.age.version || !value.packages.ffmpeg.version || value.build_dependencies.apk !== 'build-base' || value.build_dependencies.version !== '0.5-r4' ||
      ![value.packages.age.version, value.packages.ffmpeg.version].every((version) => /^[A-Za-z0-9.+_~-]+-r[0-9]+$/.test(version)) ||
      !/^[a-f0-9]{64}$/.test(value.wrapper.source_sha256) || (value.wrapper.binary_sha256 !== null && !/^[a-f0-9]{64}$/.test(value.wrapper.binary_sha256))) throw new Error('D4 exact APK versions or wrapper identity are not enrolled in the lock');
    await execute(docker, ['--config', `${root}/deploy/development/controlled-recovery/docker-config`, '--context', 'default', 'build', '--pull=false', '--network=default',
      '--build-arg', `AGE_APK_VERSION=${value.packages.age.version}`, '--build-arg', `FFMPEG_APK_VERSION=${value.packages.ffmpeg.version}`,
      '--build-arg', `BUILD_BASE_APK_VERSION=${value.build_dependencies.version}`, '--build-arg', `WRAPPER_SOURCE_SHA256=${value.wrapper.source_sha256}`,
      ...(value.wrapper.binary_sha256 ? ['--build-arg', `WRAPPER_BINARY_SHA256=${value.wrapper.binary_sha256}`] : []), '--tag', image, context],
    { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' } }); return; }
  const { stdout } = await execute(docker, ['--config', `${root}/deploy/development/controlled-recovery/docker-config`, '--context', 'default', 'image', 'inspect', image],
    { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' } });
  const inspected = JSON.parse(stdout) as Array<{ Id?: string; RepoDigests?: string[]; Config?: unknown }> ; const entry = inspected[0]; if (!entry?.Id?.match(/^sha256:[a-f0-9]{64}$/)) throw new Error('D4 tools image is absent');
  const receipt = { format: 'darshan-d4-tools-image-inspection-v1', imageId: entry.Id, repoDigests: entry.RepoDigests ?? [], configSha256: digest(entry.Config), dockerfileSha256: value.dockerfile.sha256,
    agePackageVersion: value.packages.age.version, ffmpegPackageVersion: value.packages.ffmpeg.version,
    wrapperSourceSha256: value.wrapper.source_sha256, wrapperBinarySha256: value.wrapper.binary_sha256, buildBasePackageVersion: value.build_dependencies.version,
    wrapperBinaryVerificationPending: value.wrapper.binary_sha256 === null }; process.stdout.write(canonicalJson(receipt)); }
main().catch(() => { process.stderr.write(`${JSON.stringify({ code: 'CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_COMMAND_FAILED' })}\n`); process.exitCode = 1; });
