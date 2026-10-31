import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { PacketCE2EReadinessObservation } from '../../src/recovery/controlled-docker/controlled-recovery-e2e-harness';
import { assertD3Tools, type D3ToolObserver } from './controlled-recovery-d3-process';
import { assertD3ContainerToolsImage, type D3ContainerToolsAuthority, type D3ContainerToolsObservation } from './controlled-recovery-d4-tools';
import type { D3OwnedResource, D3ReadinessObservation, D3ReadinessObserver } from './controlled-recovery-d3-effects';
import { observeDevelopmentReadiness, type DevelopmentReadinessActivation, type DevelopmentReadinessSystem } from './controlled-recovery-readiness';

export interface D3ResourceReadinessBoundary { observe(): Promise<{ owned: readonly D3OwnedResource[]; foreign: readonly D3OwnedResource[] }>; }
export interface D3CgroupReadinessBoundary { prove(): Promise<{ available: boolean; delegationSha256: string }>; }
export interface D3ContainerToolsReadinessBoundary { observe(): Promise<D3ContainerToolsObservation | null>; }

/** Composes real D1 host/disk/daemon/image/artifact observations with D3-owned container and tool/cgroup authority. */
export class ComposedD3ReadinessObserver implements D3ReadinessObserver {
  constructor(private readonly d1: DevelopmentReadinessActivation, private readonly system: DevelopmentReadinessSystem,
    private readonly resources: D3ResourceReadinessBoundary, private readonly tools: D3ToolObserver,
    private readonly enrolledTools: Readonly<Record<string, { sha256: string; version: string }>>, private readonly containerToolsAuthority: D3ContainerToolsAuthority,
    private readonly containerTools: D3ContainerToolsReadinessBoundary, private readonly cgroups: D3CgroupReadinessBoundary) {}
  async observe(): Promise<D3ReadinessObservation> {
    const resourceTruth = await this.resources.observe();
    // D1's empty-workload rule is delegated to the exact D3 ownership projection; all other D1 observations remain real.
    const d1System: DevelopmentReadinessSystem = { ...this.system, listRunningDockerContainers: async () => Buffer.alloc(0) };
    const [report, hostToolsEvidenceSha256, observedContainerTools, cgroup] = await Promise.all([
      observeDevelopmentReadiness(this.d1, d1System), assertD3Tools(this.tools, this.enrolledTools), this.containerTools.observe(), this.cgroups.prove(),
    ]);
    const toolsEvidenceSha256 = digest({ host: hostToolsEvidenceSha256, container: assertD3ContainerToolsImage(this.containerToolsAuthority, observedContainerTools) });
    if (report.status !== 'READY') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_D1_PREREQUISITE_FAILED', `D1 prerequisite failed: ${report.codes.join(',')}`);
    if (!cgroup.available || !/^[a-f0-9]{64}$/.test(cgroup.delegationSha256)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CGROUP_UNAVAILABLE', 'D3 cgroup v2 delegation is unavailable or unenrolled.');
    const prerequisite: PacketCE2EReadinessObservation = { availableRamBytes: report.memory.availableBytes, requiredRamBytes: report.projectedSerialPeak.requiredAvailableBytes,
      workspaceFreeBytes: report.workspace.availableBytes, requiredWorkspaceBytes: this.d1.resources.required_workspace_bytes,
      targetFreeBytes: report.target.availableBytes, requiredTargetBytes: this.d1.resources.required_target_bytes,
      swapInUseBytes: report.memory.swapUsedBytes, maximumSwapInUseBytes: this.d1.resources.maximum_swap_used_bytes,
      firefoxUntouched: report.artifacts.firefoxUntouched,
      enrolledAssetsSha256: digest({ activation: report.activationSha256, observation: report.evidenceSha256, docker: report.docker.evidenceSha256, images: report.docker.imagesEvidenceSha256 }), };
    return { prerequisite, pressureUnsafe: report.codes.some((code) => code.includes('PRESSURE')), foreignResources: resourceTruth.foreign,
      ownedResources: resourceTruth.owned, toolsEvidenceSha256, cgroupEvidenceSha256: cgroup.delegationSha256 };
  }
}
