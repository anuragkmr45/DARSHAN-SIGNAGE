import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { canonicalJson } from '../../src/backups/backup-broker-protocol';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile, publishD3ProtectedBytes, recoverD3PublishedLinks } from './controlled-recovery-d3-protected-files';
import type { D3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import { DurableD3SourceState, type D3SourceResource } from './controlled-recovery-d3-source-state';
import type { D3SourceLayoutBoundary, D3SourceLayoutReceipt, D3SourceVolumeMaterialization } from './controlled-recovery-d3-source-services';

import { D3_PG_MATERIALIZER_IMAGE, D3_SOURCE_HELPER_CAPABILITY } from './controlled-recovery-d3-source-enrollment';
export { D3_PG_MATERIALIZER_IMAGE, D3_SOURCE_HELPER_CAPABILITY } from './controlled-recovery-d3-source-enrollment';
export type D3VolumeRole = 'postgres' | 'minio' | 'valkey';
export type D3VolumeAction = 'directory' | 'install' | 'stat-directory' | 'stat-file' | 'hash' | 'sync';
export interface D3VolumeOperation { role: D3VolumeRole; action: D3VolumeAction; index: number; }
export const D3_VOLUME_FILES = {
  postgres: [['tls/postgres/server.crt', '.d3-tls/server.crt'], ['tls/postgres/server.key', '.d3-tls/server.key'], ['tls/postgres/ca.crt', '.d3-tls/ca.crt'], ['config/pg_hba.conf', '.d3-tls/pg_hba.conf']],
  minio: [['tls/minio/public.crt', '.d3-config/tls/public.crt'], ['tls/minio/private.key', '.d3-config/tls/private.key'], ['tls/minio/CAs/ca.crt', '.d3-config/tls/CAs/ca.crt'], ['secrets/minio-access-key', '.d3-config/secrets/minio-access-key'], ['secrets/minio-secret-key', '.d3-config/secrets/minio-secret-key']],
  valkey: [['tls/valkey/server.crt', '.d3-config/tls/server.crt'], ['tls/valkey/server.key', '.d3-config/tls/server.key'], ['tls/valkey/ca.crt', '.d3-config/tls/ca.crt'], ['secrets/valkey.acl', '.d3-config/users.acl'], ['config/valkey.conf', '.d3-config/valkey.conf']],
} as const;
const directories = { postgres: ['', '.d3-tls'], minio: ['', '.d3-config', '.d3-config/tls', '.d3-config/tls/CAs', '.d3-config/secrets'], valkey: ['', '.d3-config', '.d3-config/tls'] } as const;
export function fixedD3VolumePlan(authority: D3OperationAuthority, profile: D3SourceBackupProfile, operation: D3VolumeOperation, layoutSha256: string, resource: D3SourceResource) {
  const { role, action, index } = operation; if (!['postgres', 'minio', 'valkey'].includes(role) || !Number.isSafeInteger(index) || index < 0 || resource.role !== `${role}-volume` || resource.kind !== 'volume' || resource.retired) throw failure();
  const files = D3_VOLUME_FILES[role]; const dirs = directories[role]; const uid = role === 'postgres' ? 70 : profile[role].user; const gid = role === 'postgres' ? 70 : profile[role].group;
  let entrypoint: string; let command: string[]; let source: string | null = null; let destination: string;
  if (action === 'directory' || action === 'stat-directory') { if (index >= dirs.length) throw failure(); destination = `/volume${dirs[index] ? `/${dirs[index]}` : ''}`;
    entrypoint = action === 'directory' ? D3_SOURCE_HELPER_CAPABILITY.install : D3_SOURCE_HELPER_CAPABILITY.stat; command = action === 'directory' ? ['-d', '-m', '0700', '-o', String(uid), '-g', String(gid), destination] : ['-c', '%F|%u|%g|%a|%h|%s', destination];
  } else if (action === 'sync') { if (index !== 0) throw failure(); destination = '/volume'; entrypoint = D3_SOURCE_HELPER_CAPABILITY.sync; command = ['-f', destination]; }
  else { if (index >= files.length || !['install', 'stat-file', 'hash'].includes(action)) throw failure(); const file = files[index]!; destination = `/volume/${file[1]}`;
    entrypoint = action === 'install' ? D3_SOURCE_HELPER_CAPABILITY.install : action === 'hash' ? D3_SOURCE_HELPER_CAPABILITY.sha256sum : D3_SOURCE_HELPER_CAPABILITY.stat;
    if (action === 'install') { source = `${authority.root}/source/${file[0]}`; command = ['-m', '0600', '-o', String(uid), '-g', String(gid), '/input', destination]; }
    else command = action === 'hash' ? [destination] : ['-c', '%F|%u|%g|%a|%h|%s', destination]; }
  const readonly = action.startsWith('stat-') || action === 'hash'; const step = `${role}-${action}-${index}`; const cidfile = `${authority.root}/source/state/volume-helper/${step}.cid`;
  const name = `darshan-d3-volume-${authority.operationId}-${step}`; const configSha256 = digest({ operation, layoutSha256, resource, entrypoint, command, source, readonly });
  const labels = { 'com.darshan.d3.operation': authority.operationId, 'com.darshan.d3.site': authority.siteId, 'com.darshan.d3.role': 'source-volume-helper', 'com.darshan.d3.step': step, 'com.darshan.d3.configuration-sha256': configSha256 };
  const argv = ['--config', '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config', '--context', 'default', 'container', 'run', '--pull=never', '--name', name, '--cidfile', cidfile,
    ...Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]), '--network', 'none', '--user', '0:0', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE',
    ...(!readonly ? ['--cap-add', 'CHOWN', '--cap-add', 'FOWNER'] : []), '--security-opt', 'no-new-privileges=true', '--memory', '67108864', '--cpus', '0.25', '--pids-limit', '32', '--restart', 'no',
    '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=1m,mode=0700', '--mount', `type=volume,src=${resource.name},dst=/volume${readonly ? ',readonly' : ''}`,
    ...(source ? ['--mount', `type=bind,src=${source},dst=/input,readonly`] : []), '--env', 'LANG=C', '--env', 'LC_ALL=C', '--entrypoint', entrypoint, D3_PG_MATERIALIZER_IMAGE, ...command];
  return { argv, cidfile, name, labels, source, destination, uid, gid, readonly, configurationSha256: configSha256 };
}
export interface D3VolumeExecution { executeVolume(operation: D3VolumeOperation, signal?: AbortSignal): Promise<{ stdout: Buffer }>; }
const failure = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_VOLUME_INVALID', 'The exact source volume materialization, numeric ownership, mode, hash, or settlement is unverified.');

export class ProtectedD3SourceVolumes implements D3SourceVolumeMaterialization {
  constructor(private readonly authority: D3OperationAuthority, private readonly profile: D3SourceBackupProfile, private readonly state: DurableD3SourceState,
    private readonly layout: D3SourceLayoutBoundary, private readonly executor: D3VolumeExecution) {}
  /** Revalidate the retained file-proof chain against current layout and reobserved volume identities; no helper, repair or new measurement. */
  async verifyRetained(input: { profile: D3SourceBackupProfile; resources: readonly D3SourceResource[]; layout: D3SourceLayoutReceipt }) {
    try {
      if (digest(input.profile) !== digest(this.profile) || input.resources.length !== 5 || input.resources[4]?.role !== 'postgres-init' || !input.resources[4]?.retired) throw failure();
      const files: Array<{ role: D3VolumeRole; path: string; sha256: string; bytes: number }> = [];
      for (const role of ['postgres', 'minio', 'valkey'] as const) { const volume = input.resources.find((value) => value.role === `${role}-volume`); if (!volume || volume.kind !== 'volume' || volume.retired) throw failure(); for (const file of D3_VOLUME_FILES[role]) { const handle = await openD3ProtectedFile(this.authority, `${this.authority.root}/source/${file[0]}`, 64 * 1024); let bytes: Buffer; try { bytes = await handle.readFile(); } finally { await handle.close(); } files.push({ role, path: file[1], sha256: sha256(bytes), bytes: bytes.length }); } }
      const record = { format: 'darshan-d3-source-volume-materialization-v1', operationId: this.authority.operationId, profileSha256: this.state.profileSha256, layoutSha256: input.layout.evidenceSha256, resourcesSha256: digest(input.resources), files };
      const handle = await openD3ProtectedFile(this.authority, `${this.authority.root}/source/state/volume-materialization.json`, 128 * 1024); try { if (!(await handle.readFile()).equals(canonicalJson(record))) throw failure(); } finally { await handle.close(); } return { evidenceSha256: digest(record) };
    } catch { throw failure(); }
  }
  async prepare(input: { profile: D3SourceBackupProfile; resources: readonly D3SourceResource[]; layout: D3SourceLayoutReceipt; signal?: AbortSignal }) {
    try {
      if (input.signal?.aborted) throw failure();
      if (digest(input.profile) !== digest(this.profile) || digest(input.resources) !== digest((await this.state.resources()).resources) || digest(input.layout) !== digest(await this.layout.verify())) throw failure();
      if (input.resources.some((resource) => resource.kind === 'container' && !resource.retired)) throw failure();
      const path = `${this.authority.root}/source/state/volume-materialization.json`; let retained: Buffer | null = null;
      await recoverD3PublishedLinks(this.authority, path);
      try { const handle = await openD3ProtectedFile(this.authority, path, 128 * 1024); try { retained = await handle.readFile(); } finally { await handle.close(); } } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw failure(); }
      const evidence: Array<{ role: D3VolumeRole; path: string; sha256: string; bytes: number }> = [];
      for (const role of ['postgres', 'minio', 'valkey'] as const) {
        const resource = input.resources.find((value) => value.role === `${role}-volume`); if (!resource || resource.retired) throw failure();
        const run = async (action: D3VolumeAction, index: number) => { if (input.signal?.aborted) throw failure(); const value = await this.executor.executeVolume({ role, action, index }, input.signal); if (input.signal?.aborted) throw failure(); return value; };
        if (!retained) { for (let index = 0; index < directories[role].length; index++) await run('directory', index); for (let index = 0; index < D3_VOLUME_FILES[role].length; index++) await run('install', index); await run('sync', 0); }
        const uid = role === 'postgres' ? 70 : this.profile[role].user; const gid = role === 'postgres' ? 70 : this.profile[role].group;
        for (let index = 0; index < directories[role].length; index++) { const text = (await run('stat-directory', index)).stdout.toString('utf8').trim().split('|'); if (text.length !== 6 || text[0] !== 'directory' || text[1] !== String(uid) || text[2] !== String(gid) || text[3] !== '700' || !/^[1-9][0-9]*$/.test(text[4]!) || !/^[0-9]+$/.test(text[5]!)) throw failure(); }
        for (const [index, file] of D3_VOLUME_FILES[role].entries()) {
          const handle = await openD3ProtectedFile(this.authority, `${this.authority.root}/source/${file[0]}`, 64 * 1024); let bytes: Buffer; try { bytes = await handle.readFile(); } finally { await handle.close(); }
          const stat = (await run('stat-file', index)).stdout.toString('utf8').trim().split('|'); const hash = (await run('hash', index)).stdout.toString('utf8').trim();
          if (stat.length !== 6 || stat[0] !== 'regular file' || stat[1] !== String(uid) || stat[2] !== String(gid) || stat[3] !== '600' || stat[4] !== '1' || stat[5] !== String(bytes.length) || hash !== `${sha256(bytes)}  /volume/${file[1]}`) throw failure();
          evidence.push({ role, path: file[1], sha256: sha256(bytes), bytes: bytes.length });
        }
      }
      const record = { format: 'darshan-d3-source-volume-materialization-v1', operationId: this.authority.operationId, profileSha256: this.state.profileSha256, layoutSha256: input.layout.evidenceSha256, resourcesSha256: digest(input.resources), files: evidence };
      const bytes = canonicalJson(record); if (input.signal?.aborted || (retained && !retained.equals(bytes))) throw failure(); if (!retained) await publishD3ProtectedBytes(this.authority, path, bytes);
      return { postgresOwner: '70:70' as const, minioOwner: `${this.profile.minio.user}:${this.profile.minio.group}`, valkeyOwner: `${this.profile.valkey.user}:${this.profile.valkey.group}`, directoryMode: '0700' as const, fileMode: '0600' as const, postgresTlsAndScramVerified: true as const, evidenceSha256: digest(record) };
    } catch { throw failure(); }
  }
}
