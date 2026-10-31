import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { controlledRecoveryActivationSchema } from './activation';
import { buildTargetSpecification } from './docker-targets';
import { FixedDockerRunner, fixedDockerEnvironment, parseAndVerifyDockerFoundationTranscript, parseAndVerifyFixedDockerTranscript,
  parseRealDockerTargetInspection, verifyRealDockerContext, verifyRealDockerDaemon, verifyRealDockerImages } from './fixed-docker-runner';
import { currentControlledRecoveryProfileSchema } from './profile';
import { digest } from './contracts';

async function fixture() {
  const activation = controlledRecoveryActivationSchema.parse(JSON.parse(await readFile(
    new URL('../../../../deploy/production/controlled-recovery/activation.tiny-disposable.example.json', import.meta.url), 'utf8')));
  const profile = currentControlledRecoveryProfileSchema.parse(JSON.parse(await readFile(
    new URL('../../../../deploy/production/controlled-recovery/profile.release-03.example.json', import.meta.url), 'utf8')));
  activation.resources.postgres.image = profile.images.postgres.reference;
  activation.resources.minio.image = profile.images.minio.reference;
  const specification = buildTargetSpecification(profile, randomUUID(), 1);
  const common = { labels: specification.labels };
  const resources = [
    { kind: 'network' as const, name: specification.names.network, id: 'n1', consumers: [specification.names.minioContainer, specification.names.postgresContainer], ...common },
    { kind: 'volume' as const, name: specification.names.postgresVolume, id: 'v1', consumers: [specification.names.postgresContainer], ...common },
    { kind: 'volume' as const, name: specification.names.minioVolume, id: 'v2', consumers: [specification.names.minioContainer], ...common },
    { kind: 'container' as const, name: specification.names.postgresContainer, id: 'c1', image: specification.images.postgres,
      mounts: [{ volumeName: specification.names.postgresVolume, destination: '/var/lib/postgresql/data', readOnly: false }], networks: [specification.names.network], consumers: [], configurationSha256: specification.containerConfigurationSha256.postgres, ...common },
    { kind: 'container' as const, name: specification.names.minioContainer, id: 'c2', image: specification.images.minio,
      mounts: [{ volumeName: specification.names.minioVolume, destination: '/data', readOnly: false }], networks: [specification.names.network], consumers: [], configurationSha256: specification.containerConfigurationSha256.minio, ...common },
  ];
  const bytes = (value = resources) => Buffer.from(JSON.stringify({ format: 'darshan-fixed-docker-inspect-v1',
    daemon_identity_sha256: activation.docker.daemon_identity_sha256, context: activation.docker.context,
    endpoint: activation.docker.endpoint, resources: value }));
  return { activation, profile, specification, resources, bytes };
}

function realDockerOutputs(value: Awaited<ReturnType<typeof fixture>>) {
  const daemon = { ID: 'daemon-01', Name: 'recovery-host', Driver: 'overlay2', ServerVersion: '27.1.1', SecurityOptions: ['name=seccomp', 'name=cgroupns'] };
  value.activation.docker.daemon_identity_sha256 = digest({ id: daemon.ID, name: daemon.Name, driver: daemon.Driver, serverVersion: daemon.ServerVersion, securityOptions: [...daemon.SecurityOptions].sort() });
  const context = [{ Name: value.activation.docker.context, Metadata: {}, Endpoints: { docker: { Host: value.activation.docker.endpoint, SkipTLSVerify: false } } }];
  const images = Object.values(value.activation.resources).map((role, index) => ({ Id: `sha256:${String(index + 1).repeat(64)}`, RepoDigests: [role.image], Config: { User: role.user, Entrypoint: role.entrypoint, Cmd: role.command } }));
  const labels = value.specification.labels; const configLabels = (sha: string) => ({ ...labels, 'com.darshan.configuration-sha256': sha });
  const targets = [
    { Name: value.specification.names.network, Id: '1'.repeat(64), Labels: labels, Containers: { ['4'.repeat(64)]: { Name: value.specification.names.postgresContainer }, ['5'.repeat(64)]: { Name: value.specification.names.minioContainer } } },
    { Name: value.specification.names.postgresVolume, Driver: 'local', Mountpoint: '/var/lib/docker/volumes/a', Labels: labels },
    { Name: value.specification.names.minioVolume, Driver: 'local', Mountpoint: '/var/lib/docker/volumes/b', Labels: labels },
    { Name: `/${value.specification.names.postgresContainer}`, Id: '4'.repeat(64), Config: { Image: value.specification.images.postgres, Labels: configLabels(value.specification.containerConfigurationSha256.postgres) }, HostConfig: {}, Mounts: [{ Type: 'volume', Name: value.specification.names.postgresVolume, Destination: '/var/lib/postgresql/data', RW: true }], NetworkSettings: { Networks: { [value.specification.names.network]: {} } } },
    { Name: `/${value.specification.names.minioContainer}`, Id: '5'.repeat(64), Config: { Image: value.specification.images.minio, Labels: configLabels(value.specification.containerConfigurationSha256.minio) }, HostConfig: {}, Mounts: [{ Type: 'volume', Name: value.specification.names.minioVolume, Destination: '/data', RW: true }], NetworkSettings: { Networks: { [value.specification.names.network]: {} } } },
  ];
  return { daemon, context, images, targets };
}

describe('Activation Packet A fixed Docker runner', () => {
  it('rejects ambient Docker/proxy substitution and has no public generic run surface', async () => {
    expect(() => fixedDockerEnvironment({ DOCKER_HOST: 'tcp://foreign:2375' })).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_DOCKER_AMBIENT_REJECTED' }));
    const { activation } = await fixture(); const runner = new FixedDockerRunner(activation, { execute: vi.fn() }, {});
    expect('run' in runner).toBe(false);
  });

  it('parses exact transcripts and rejects foreign mounts, consumers, configuration and collisions', async () => {
    const { activation, specification, resources, bytes } = await fixture();
    expect(parseAndVerifyFixedDockerTranscript({ bytes: bytes(), activation, specification })).toHaveLength(5);
    for (const changed of [
      resources.map((entry) => entry.kind === 'container' && entry.name === specification.names.postgresContainer ? { ...entry, mounts: [...entry.mounts!, { volumeName: 'anonymous', destination: '/extra', readOnly: false }] } : entry),
      resources.map((entry) => entry.kind === 'volume' && entry.name === specification.names.postgresVolume ? { ...entry, consumers: ['foreign'] } : entry),
      resources.map((entry) => entry.kind === 'container' && entry.name === specification.names.postgresContainer ? { ...entry, configurationSha256: 'f'.repeat(64) } : entry),
      [...resources.slice(0, 4), { ...resources[4], name: specification.names.postgresContainer }],
    ]) expect(() => parseAndVerifyFixedDockerTranscript({ bytes: bytes(changed), activation, specification })).toThrowError();
  });

  it('emits only fixed create arguments with enrolled PostgreSQL and MinIO destinations', async () => {
    const { activation, specification } = await fixture(); const requests: Array<{ argv: readonly string[] }> = [];
    const execute = vi.fn(async (request: { argv: readonly string[] }) => { requests.push(request); return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }; });
    const runner = new FixedDockerRunner(activation, { execute }, {});
    await runner.createContainer(specification, 'postgres'); await runner.createContainer(specification, 'minio');
    const argv = requests.map((request) => request.argv.join(' '));
    expect(argv[0]).toContain('dst=/var/lib/postgresql/data'); expect(argv[1]).toContain('dst=/data');
    expect(argv.join(' ')).not.toMatch(/\b(?:pull|build|prune|compose|ssh)\b|down\s+-v/);
  });

  it('binds the local daemon and every preloaded image digest/user/entrypoint/command', async () => {
    const { activation } = await fixture();
    const images = Object.values(activation.resources).map((role) => ({ reference: role.image, image_id: `sha256:${'1'.repeat(64)}`,
      repo_digests: [role.image], user: role.user, entrypoint: role.entrypoint, command: role.command }));
    const transcript = (values = images) => Buffer.from(JSON.stringify({ format: 'darshan-fixed-docker-foundation-v1',
      daemon_identity_sha256: activation.docker.daemon_identity_sha256, context: activation.docker.context,
      endpoint: activation.docker.endpoint, images: values }));
    expect(() => parseAndVerifyDockerFoundationTranscript(transcript(), activation)).not.toThrow();
    expect(() => parseAndVerifyDockerFoundationTranscript(transcript(images.map((image, index) => index === 0
      ? { ...image, entrypoint: ['/foreign'] } : image)), activation)).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_DOCKER_IMAGE_CHANGED' }));
  });

  it('parses bounded real Docker context/info/image/inspect output and distinguishes absent from partial targets', async () => {
    const value = await fixture(); const real = realDockerOutputs(value);
    expect(() => verifyRealDockerContext(Buffer.from(JSON.stringify(real.context)), value.activation)).not.toThrow();
    expect(() => verifyRealDockerDaemon(Buffer.from(JSON.stringify(real.daemon)), value.activation)).not.toThrow();
    expect(() => verifyRealDockerImages(Buffer.from(JSON.stringify(real.images)), value.activation)).not.toThrow();
    expect(parseRealDockerTargetInspection({ stdout: Buffer.from(JSON.stringify(real.targets)), stderr: Buffer.alloc(0), exitCode: 0, specification: value.specification })).toHaveLength(5);
    const withUnexpectedMount = (mount: Record<string, unknown>, hostConfig: Record<string, unknown>) => real.targets.map((target) =>
      target.Name === `/${value.specification.names.postgresContainer}` ? { ...target, HostConfig: hostConfig, Mounts: [...target.Mounts!, mount] } : target);
    const hostBind = withUnexpectedMount({ Type: 'bind', Source: '/host/private', Destination: '/unexpected', RW: true }, { Binds: ['/host/private:/unexpected:rw'] });
    expect(() => parseRealDockerTargetInspection({ stdout: Buffer.from(JSON.stringify(hostBind)), stderr: Buffer.alloc(0), exitCode: 0, specification: value.specification }))
      .toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_TARGET_CONFIGURATION_CHANGED' }));
    const tmpfs = withUnexpectedMount({ Type: 'tmpfs', Source: '', Destination: '/run/extra', RW: true }, { Tmpfs: { '/run/extra': 'rw,size=65536k' } });
    expect(() => parseRealDockerTargetInspection({ stdout: Buffer.from(JSON.stringify(tmpfs)), stderr: Buffer.alloc(0), exitCode: 0, specification: value.specification }))
      .toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_TARGET_CONFIGURATION_CHANGED' }));
    const missingLines = [value.specification.names.network, value.specification.names.postgresVolume, value.specification.names.minioVolume,
      value.specification.names.postgresContainer, value.specification.names.minioContainer].map((name) => `Error: No such object: ${name}`).join('\n');
    expect(parseRealDockerTargetInspection({ stdout: Buffer.from('[]'), stderr: Buffer.from(missingLines), exitCode: 1, specification: value.specification })).toEqual([]);
    expect(() => parseRealDockerTargetInspection({ stdout: Buffer.from(JSON.stringify(real.targets.slice(0, 1))), stderr: Buffer.from(missingLines), exitCode: 1, specification: value.specification }))
      .toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_TARGET_PARTIAL' }));
    const calls: string[][] = []; const execute = vi.fn(async ({ argv }: { argv: readonly string[] }) => {
      calls.push([...argv]); const command = argv[4];
      if (command === 'context') return { exitCode: 0, stdout: Buffer.from(JSON.stringify(real.context)), stderr: Buffer.alloc(0) };
      if (command === 'info') return { exitCode: 0, stdout: Buffer.from(JSON.stringify(real.daemon)), stderr: Buffer.alloc(0) };
      if (command === 'image') return { exitCode: 0, stdout: Buffer.from(JSON.stringify(real.images)), stderr: Buffer.alloc(0) };
      return { exitCode: 0, stdout: Buffer.from(JSON.stringify(real.targets)), stderr: Buffer.alloc(0) };
    });
    const runner = new FixedDockerRunner(value.activation, { execute }, {}); await expect(runner.verifyFoundation()).resolves.toBeUndefined();
    await expect(runner.inspectTargets(value.specification)).resolves.toHaveLength(5);
    expect(calls.filter((argv) => argv[4] === 'context')).toHaveLength(2); expect(calls.filter((argv) => argv[4] === 'info')).toHaveLength(2);
  });
});
