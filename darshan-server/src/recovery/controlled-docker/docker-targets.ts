import { ControlledRecoveryError, digest } from './contracts';
import type { ControlledRecoveryProfile } from './profile';

export const OWNERSHIP_LABELS = Object.freeze({
  managedBy: 'darshan-controlled-recovery', purpose: 'restore-candidate', packet: '1',
});

export interface RecoveryTargetSpecification {
  operationId: string; generation: number; siteId: string;
  names: { network: string; postgresVolume: string; minioVolume: string; postgresContainer: string; minioContainer: string };
  labels: Record<string, string>;
  images: { postgres: string; minio: string };
  containerConfigurationSha256: { postgres: string; minio: string };
  composeFile: string; dockerContext: string;
}

export interface ObservedTargetResource {
  kind: 'network' | 'volume' | 'container'; name: string; id: string; labels: Record<string, string>;
  image?: string; mounts?: Array<{ volumeName: string; destination: string; readOnly: boolean }>;
  networks?: string[]; consumers?: string[]; configurationSha256?: string;
}

export interface FixedDeploymentAdapter {
  inspect(specification: RecoveryTargetSpecification, signal?: AbortSignal): Promise<readonly ObservedTargetResource[]>;
  createFresh(specification: RecoveryTargetSpecification, signal?: AbortSignal): Promise<void>;
  resetOwnedDatabaseTarget(specification: RecoveryTargetSpecification, signal?: AbortSignal): Promise<void>;
}

function suffix(operationId: string, generation: number): string { return `${operationId.replaceAll('-', '').slice(0, 16)}-g${generation}`; }

export function buildTargetSpecification(profile: ControlledRecoveryProfile, operationId: string, generation: number): RecoveryTargetSpecification {
  if (!Number.isSafeInteger(generation) || generation < 1) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_INVALID', 'Target generation must be positive.');
  const unique = suffix(operationId, generation);
  const labels = { 'com.darshan.managed-by': OWNERSHIP_LABELS.managedBy, 'com.darshan.purpose': OWNERSHIP_LABELS.purpose,
    'com.darshan.packet': OWNERSHIP_LABELS.packet, 'com.darshan.operation-id': operationId,
    'com.darshan.generation': String(generation), 'com.darshan.site-id': profile.site_id };
  const names = {
    network: `${profile.docker.private_network_prefix}-${unique}`,
    postgresVolume: `${profile.docker.postgres_volume_prefix}-${unique}`,
    minioVolume: `${profile.docker.minio_volume_prefix}-${unique}`,
    postgresContainer: `darshan-recovery-postgres-${unique}`,
    minioContainer: `darshan-recovery-minio-${unique}`,
  };
  const images = { postgres: profile.images.postgres.reference, minio: profile.images.minio.reference };
  const destinations = profile.docker.mount_destinations;
  return { operationId, generation, siteId: profile.site_id, names, labels, images,
    containerConfigurationSha256: {
      postgres: digest({ image: images.postgres, network: names.network, volume: names.postgresVolume, destination: destinations.postgres, readOnly: false }),
      minio: digest({ image: images.minio, network: names.network, volume: names.minioVolume, destination: destinations.minio, readOnly: false }),
    }, composeFile: profile.docker.compose_file, dockerContext: profile.docker.context };
}

function assertLabels(resource: ObservedTargetResource, spec: RecoveryTargetSpecification): void {
  if (digest(resource.labels) !== digest(spec.labels) || !resource.id) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_FOREIGN', 'Recovery resource ownership labels/ID are missing or differ.');
  }
}

export function verifyOwnedFreshTargets(spec: RecoveryTargetSpecification, resources: readonly ObservedTargetResource[]): void {
  const expected = new Set<string>([
    `network:${spec.names.network}`, `volume:${spec.names.postgresVolume}`, `volume:${spec.names.minioVolume}`,
    `container:${spec.names.postgresContainer}`, `container:${spec.names.minioContainer}`,
  ]);
  if (resources.length !== expected.size) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_SET_INVALID', 'Target set has missing or unexpected resources.');
  for (const resource of resources) {
    const key = `${resource.kind}:${resource.name}`;
    if (!expected.has(key)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_FOREIGN', 'Target name collision or unexpected resource detected.');
    expected.delete(key); assertLabels(resource, spec);
    const expectedConsumers = resource.kind === 'network' ? [spec.names.minioContainer, spec.names.postgresContainer].sort()
      : resource.kind === 'volume' ? [resource.name === spec.names.postgresVolume ? spec.names.postgresContainer : spec.names.minioContainer] : [];
    if (JSON.stringify([...(resource.consumers ?? [])].sort()) !== JSON.stringify(expectedConsumers))
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_CONSUMER_UNEXPECTED', 'Recovery resource has a missing or unexpected consumer.');
    if (resource.kind === 'container') {
      const postgres = resource.name === spec.names.postgresContainer;
      const expectedImage = postgres ? spec.images.postgres : spec.images.minio;
      const expectedVolume = postgres ? spec.names.postgresVolume : spec.names.minioVolume;
      const expectedDestination = postgres ? '/var/lib/postgresql/data' : '/data';
      const expectedConfigurationSha256 = postgres ? spec.containerConfigurationSha256.postgres : spec.containerConfigurationSha256.minio;
      if (resource.image !== expectedImage || JSON.stringify(resource.networks) !== JSON.stringify([spec.names.network]) ||
          resource.mounts?.length !== 1 || resource.mounts[0].volumeName !== expectedVolume || resource.mounts[0].destination !== expectedDestination ||
          resource.mounts[0].readOnly || resource.configurationSha256 !== expectedConfigurationSha256) {
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_CONFIGURATION_CHANGED', 'Recovery container image/network/mount configuration differs.');
      }
    }
  }
}

export async function createAndVerifyFreshTargets(input: {
  adapter: FixedDeploymentAdapter; specification: RecoveryTargetSpecification; signal?: AbortSignal;
}): Promise<{ targetEvidenceSha256: string; resources: readonly ObservedTargetResource[] }> {
  const before = await input.adapter.inspect(input.specification, input.signal);
  if (before.length) {
    // A complete exact-owned set can exist after create succeeded but before its
    // external receipt was published. Re-observe and synthesize truth; never
    // repeat create. Partial/foreign sets still fail closed in verification.
    verifyOwnedFreshTargets(input.specification, before);
    return { resources: before, targetEvidenceSha256: digest(before.map(({ kind, name, id, labels, image, mounts, networks, consumers, configurationSha256 }) =>
      ({ kind, name, id, labels, image, mounts, networks, consumers, configurationSha256 }))) };
  }
  await input.adapter.createFresh(input.specification, input.signal); const resources = await input.adapter.inspect(input.specification, input.signal);
  verifyOwnedFreshTargets(input.specification, resources);
  return { resources, targetEvidenceSha256: digest(resources.map(({ kind, name, id, labels, image, mounts, networks, consumers, configurationSha256 }) =>
    ({ kind, name, id, labels, image, mounts, networks, consumers, configurationSha256 }))) };
}

export async function resetOwnedDatabaseTarget(input: { adapter: FixedDeploymentAdapter; specification: RecoveryTargetSpecification; signal?: AbortSignal }): Promise<void> {
  const observed = await input.adapter.inspect(input.specification, input.signal);
  verifyOwnedFreshTargets(input.specification, observed);
  await input.adapter.resetOwnedDatabaseTarget(input.specification, input.signal);
  verifyOwnedFreshTargets(input.specification, await input.adapter.inspect(input.specification, input.signal));
}

