import type { FixedDeploymentAdapter, RecoveryTargetSpecification, ObservedTargetResource } from './docker-targets';
import { FixedDockerRunner } from './fixed-docker-runner';
import { ControlledRecoveryError } from './contracts';

function byName(resources: readonly ObservedTargetResource[], name: string): ObservedTargetResource {
  const matches = resources.filter((resource) => resource.name === name);
  if (matches.length !== 1) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_SET_INVALID', 'Exact target resource is absent or duplicated.');
  return matches[0];
}

export class FixedDockerDeploymentAdapter implements FixedDeploymentAdapter {
  constructor(private readonly runner: FixedDockerRunner) {}
  inspect(specification: RecoveryTargetSpecification, signal?: AbortSignal): Promise<readonly ObservedTargetResource[]> { return this.runner.inspectTargets(specification, signal); }
  async createFresh(specification: RecoveryTargetSpecification, signal?: AbortSignal): Promise<void> {
    await this.runner.verifyFoundation(signal); await this.runner.createNetwork(specification, signal);
    await this.runner.createVolume(specification, 'postgres', signal); await this.runner.createVolume(specification, 'minio', signal);
    await this.runner.createContainer(specification, 'postgres', signal); await this.runner.createContainer(specification, 'minio', signal);
    const resources = await this.runner.inspectTargets(specification, signal);
    await this.runner.startContainer(byName(resources, specification.names.postgresContainer).id, signal);
    await this.runner.startContainer(byName(resources, specification.names.minioContainer).id, signal);
  }
  async resetOwnedDatabaseTarget(specification: RecoveryTargetSpecification, signal?: AbortSignal): Promise<void> {
    const resources = await this.runner.inspectTargets(specification, signal);
    await this.runner.resetOwnedDatabase(byName(resources, specification.names.postgresContainer).id,
      byName(resources, specification.names.postgresVolume).id, signal);
    await this.runner.createVolume(specification, 'postgres', signal); await this.runner.createContainer(specification, 'postgres', signal);
    const after = await this.runner.inspectTargets(specification, signal);
    await this.runner.startContainer(byName(after, specification.names.postgresContainer).id, signal);
  }
}
