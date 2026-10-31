import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
const exec = promisify(execFile); const root = resolve(new URL('..', import.meta.url).pathname);
const h = (c) => c.repeat(64); const nonce = (c) => c.repeat(32);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const wire = Buffer.from([
  'format=darshan-recovery-target-native-engine-command-v4','operation=CREATE_POSTGRES','role=POSTGRES',
  'installation_id=11111111-1111-4111-8111-111111111111','site_id=fixture-site',
  'host_installation_id=22222222-2222-4222-8222-222222222222','operation_id=33333333-3333-4333-8333-333333333333',
  'target_handle=tra:v1:target:0123456789abcdef','generation=9',`acquired_request_sha256=${h('1')}`,
  `profile_v4_sha256=${h('2')}`,`resource_admission_v3_sha256=${h('3')}`,`credential_admission_receipt_sha256=${h('4')}`,
  `credential_use_witness_sha256=${h('5')}`,`authority_instance_sha256=${h('6')}`,'supervisor_generation=7',
  `challenge_nonce=${nonce('7')}`,`command_nonce=${nonce('8')}`,`materialization_head_sha256=${h('9')}`,
  'deadline_unix_ms=2000000000000',`asset_manifest_sha256=${h('b')}`,'',
].join('\n'));
const transcript = Buffer.from([
  'format=darshan-recovery-synthetic-docker-daemon-v1',`daemon_identity_sha256=${h('a')}`,'api_version=1.44',
  'enumeration_complete=true','containers_count=2','networks_count=1','consumers_count=2',`network_id=${h('c')}`,
  'network_name=darshan-recovery-internal-0123456789abcdef','network_internal=true',`consumer_set_sha256=${h('d')}`,
  `postgres_consumer_id_sha256=${h('e')}`,`minio_consumer_id_sha256=${h('2')}`,
  `postgres_id=${h('e')}`,`postgres_image=sha256:${'0'.repeat(64)}`,`postgres_config_sha256=${h('f')}`,
  `postgres_network_id=${h('c')}`,'postgres_state=created',`postgres_owner_sha256=${h('1')}`,`minio_id=${h('2')}`,
  `minio_image=sha256:${'0'.repeat(63)}1`,`minio_config_sha256=${h('3')}`,`minio_network_id=${h('c')}`,
  'minio_state=created',`minio_owner_sha256=${h('4')}`,'',
].join('\n'));
const projection = (role,id,image,config,network,state,owner) => sha256(Buffer.from([
  'domain=darshan-recovery-docker-observation-projection-v1',`role=${role}`,`id=${id}`,`image=${image}`,
  `config=${config}`,`network=${network}`,`state=${state}`,`owner=${owner}`,'',
].join('\n')));
const inspection = (absenceReliable) => Buffer.from([
  'format=darshan-recovery-target-native-engine-inspection-v4','operation=CREATE_POSTGRES','role=POSTGRES',
  'operation_id=33333333-3333-4333-8333-333333333333','target_handle=tra:v1:target:0123456789abcdef',
  'generation=9',`command_semantic_sha256=${createHash('sha256').update(Buffer.from('darshan-recovery-target-native-engine-command-semantic-digest-v4\0')).update(Buffer.from(wire.toString().replace(/^format=darshan-recovery-target-native-engine-command-v4\n/,'domain=darshan-recovery-target-native-engine-command-semantic-v4\n'))).digest('hex')}`,
  `command_wire_sha256=${createHash('sha256').update(Buffer.from('darshan-recovery-target-native-engine-command-wire-v4\0')).update(wire).digest('hex')}`,
  `command_nonce=${nonce('8')}`,`authority_instance_sha256=${h('6')}`,'supervisor_generation=7',
  `challenge_nonce=${nonce('7')}`,`materialization_head_sha256=${h('9')}`,`asset_manifest_sha256=${h('b')}`,
  `daemon_identity_sha256=${h('a')}`,`daemon_response_sha256=${sha256(transcript)}`,'observation_complete=true',
  `absence_reliable=${absenceReliable}`,'containers_count=2','networks_count=1','consumers_count=2',
  `network_projection_sha256=${projection('NETWORK',h('c'),'none',h('d'),h('c'),'created',h('d'))}`,
  `postgres_projection_sha256=${projection('POSTGRES',h('e'),`sha256:${'0'.repeat(64)}`,h('f'),h('c'),'created',h('1'))}`,
  `minio_projection_sha256=${projection('MINIO',h('2'),`sha256:${'0'.repeat(63)}1`,h('3'),h('c'),'created',h('4'))}`,'',
].join('\n'));
test('C and TypeScript command-v4 bytes and hashes agree; observation is synthetic only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recovery-wire-v4-'));
  try { const binary=join(dir,'test'), command=join(dir,'command'), observation=join(dir,'observation');
    const inspectionFalse=join(dir,'inspection-false'),inspectionTrue=join(dir,'inspection-true');
    await writeFile(command,wire,{mode:0o600}); await writeFile(observation,transcript,{mode:0o600});
    await writeFile(inspectionFalse,inspection('false'),{mode:0o600}); await writeFile(inspectionTrue,inspection('true'),{mode:0o600});
    await exec('cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','-DRECOVERY_TARGET_DOCKER_BACKEND_TESTING','-I',join(root,'src/native'),
      join(root,'src/native/recovery-target-engine-wire-v4.c'),join(root,'src/native/recovery-target-docker-observation.c'),
      join(root,'src/native/recovery-target-docker-backend.c'),
      join(root,'src/native/recovery-target-engine-wire-v4-test.c'),'-o',binary]);
    const digest=createHash('sha256').update(Buffer.from('darshan-recovery-target-native-engine-command-wire-v4\0')).update(wire).digest('hex');
    const semanticBytes=Buffer.from(wire.toString().replace(/^format=darshan-recovery-target-native-engine-command-v4\n/,'domain=darshan-recovery-target-native-engine-command-semantic-v4\n'));
    const semantic=createHash('sha256').update(Buffer.from('darshan-recovery-target-native-engine-command-semantic-digest-v4\0')).update(semanticBytes).digest('hex');
    const {stdout,stderr}=await exec(binary,[command,digest,semantic,observation,inspectionFalse,inspectionTrue]); assert.equal(stdout,'61 wire-v4/backend-observation checks passed\n'); assert.equal(stderr,'');
    const backend=await readFile(join(root,'src/native/recovery-target-docker-backend.c'),'utf8');
    assert.match(backend, /#ifndef RECOVERY_TARGET_DOCKER_BACKEND_TESTING[\s\S]*errno=ENOTSUP/);
    assert.doesNotMatch(backend, /\b(?:system|popen|execve|execveat|docker|podman|compose|pull|build|prune|PURGE)\s*\(/i);
    assert.doesNotMatch(backend, /rtem_|INTENT|RECEIPT/);
    const worker=await readFile(join(root,'scripts/recovery-target-helper-worker.ts'),'utf8');
    assert.match(worker,/new UnavailableRecoveryTargetEngine\(\)/); assert.doesNotMatch(worker,/rtdb_|wire-v4-native|DockerBackend/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
