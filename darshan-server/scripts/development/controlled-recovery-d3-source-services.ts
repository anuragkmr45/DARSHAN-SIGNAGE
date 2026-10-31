import { performance } from 'node:perf_hooks';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { deriveD3OperationAuthority } from './controlled-recovery-d3-authority';
import type { DevelopmentD2Activation } from './controlled-recovery-d2';
import { FixedD3Docker, type D3SourceDockerInventory, type D3SourceDockerObservation } from './controlled-recovery-d3-docker';
import { type D3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import { D3_SOURCE_RESOURCE_NAMES, DurableD3SourceState, type D3SourceResource, type D3SourceResourceRole } from './controlled-recovery-d3-source-state';
import { openD3ProtectedFile } from './controlled-recovery-d3-protected-files';

export interface D3SourceLayoutReceipt { evidenceSha256: string; retainedSecretsSha256: string; caSha256: string; certificates: { postgres: string; minio: string; valkey: string };
  protectedModesVerified: true; exclusiveRetainedSecretsVerified: true; }
export interface D3SourceLayoutBoundary { prepare(signal?: AbortSignal): Promise<D3SourceLayoutReceipt>; verify(): Promise<D3SourceLayoutReceipt>; }
export interface D3SourceVolumeMaterialization {
  verifyRetained(input: { profile: D3SourceBackupProfile; resources: readonly D3SourceResource[]; layout: D3SourceLayoutReceipt }): Promise<{ evidenceSha256: string }>;
  prepare(input: { profile: D3SourceBackupProfile; resources: readonly D3SourceResource[]; layout: D3SourceLayoutReceipt; signal?: AbortSignal }): Promise<{
    postgresOwner: '70:70'; minioOwner: string; valkeyOwner: string; directoryMode: '0700'; fileMode: '0600'; postgresTlsAndScramVerified: true; evidenceSha256: string }>;
}
type ProbeBase = { authenticated: boolean; tlsVerified: boolean; plaintextRejected: boolean; unauthenticatedRejected: boolean; peerCertificateSha256: string; evidenceSha256: string };
export interface D3SourceHealthProbes {
  postgresTlsSelect(input: { profile: D3SourceBackupProfile; containerId: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProbeBase & { result: '1'; database: 'darshan'; user: 'darshan'; serverMajor: 16 }>;
  minioTlsS3(input: { profile: D3SourceBackupProfile; containerId: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProbeBase & { operation: 'LIST_BUCKETS'; success: boolean }>;
  valkeyTlsPing(input: { profile: D3SourceBackupProfile; containerId: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProbeBase & { reply: 'PONG'; aclUser: 'd3-source' }>;
}
export interface D3SourceAdmission { assert(input: { phase: string; retainedResources: readonly D3SourceResource[] }): Promise<void>; }
export interface D3SourceClock { now(): number; wait(milliseconds: number, signal?: AbortSignal): Promise<void>; }
const defaultClock: D3SourceClock = { now: () => performance.now(), wait: (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(serviceError('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED')); return; }
  const abort = () => { clearTimeout(timer); reject(serviceError('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED')); }; const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
  signal?.addEventListener('abort', abort, { once: true });
}) };
const activeRoles: readonly D3SourceResourceRole[] = ['network', 'postgres-volume', 'minio-volume', 'valkey-volume', 'postgres', 'minio', 'valkey'];
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function d3SourceConfigurations(activation: DevelopmentD2Activation, profile: D3SourceBackupProfile, layout: D3SourceLayoutReceipt, profileSha256: string): Record<D3SourceResourceRole, string> {
  return Object.fromEntries((Object.keys(D3_SOURCE_RESOURCE_NAMES) as D3SourceResourceRole[]).map((role) => [role, digest({ operationId: activation.operation_id,
    profileSha256, profile, images: activation.images, caps: activation.resources.filter(({ role: value }) => ['postgres', 'minio', 'valkey'].includes(value)), layout: digest(layout), role })])) as Record<D3SourceResourceRole, string>;
}
function serviceError(code: string) { return new ControlledRecoveryError(code, 'The fixed source service lifecycle, retained ownership, or authenticated TLS probe is unverified.'); }
export function validateD3SourceLayout(value: D3SourceLayoutReceipt): D3SourceLayoutReceipt {
  if (!value.protectedModesVerified || !value.exclusiveRetainedSecretsVerified || ![value.evidenceSha256, value.retainedSecretsSha256, value.caSha256, ...Object.values(value.certificates)].every(sha) ||
      Object.keys(value.certificates).sort().join(',') !== 'minio,postgres,valkey') throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_UNVERIFIED'); return value;
}
export type D3SourceServiceStatus = 'EMPTY' | 'READY' | 'STOPPED' | 'MIXED' | 'PARTIAL';

export function validateD3SourceInventory(retained: { resources: D3SourceResource[]; pendingRoles: D3SourceResourceRole[] }, inventory: D3SourceDockerInventory, reservedDispatch?: D3SourceResourceRole) {
    if (inventory.subnetCollision) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_SUBNET_COLLISION');
    if (retained.pendingRoles.length && (!reservedDispatch || retained.pendingRoles.length !== 1 || retained.pendingRoles[0] !== reservedDispatch)) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_CREATION_AMBIGUOUS');
    if (reservedDispatch && inventory.observed.some(({ resource }) => resource.role === reservedDispatch)) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED');
    for (const observed of inventory.observed) { const recorded = retained.resources.find(({ role }) => role === observed.resource.role);
      if (!recorded || recorded.retired || digest(recorded) !== digest(observed.resource)) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED'); }
    for (const recorded of retained.resources) { const observed = inventory.observed.find(({ resource }) => resource.role === recorded.role);
      if ((!recorded.retired && !observed) || (recorded.retired && observed)) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED'); }
    const network = inventory.observed.find(({ resource }) => resource.role === 'network'); const containers = inventory.observed.filter(({ resource }) => resource.kind === 'container');
    if (network?.consumers.some((id) => !containers.some(({ resource }) => resource.id === id))) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_FOREIGN_CONSUMER');
    const retainedContainerIds = new Set(retained.resources.filter((resource) => resource.kind === 'container' && !resource.retired).map(({ id }) => id));
    if (inventory.volumeConsumers.some(({ containerId }) => !retainedContainerIds.has(containerId))) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_FOREIGN_VOLUME_CONSUMER');
    if (!inventory.observed.length && !retained.resources.length) return { status: 'EMPTY' as const, topologyComplete: false, inventory, retained: [] };
    const complete = inventory.observed.length === activeRoles.length && activeRoles.every((role) => inventory.observed.some(({ resource }) => resource.role === role));
    const status: D3SourceServiceStatus = !complete ? 'PARTIAL' : containers.every(({ running }) => running) ? 'READY' : containers.every(({ running }) => !running) ? 'STOPPED' : 'MIXED';
    return { status, topologyComplete: complete, inventory, retained: retained.resources };
}

/** Source effects require retained layout, volume materialization, admission and real probes; no installed provider is supplied by this packet. */
export class FixedD3SourceServices {
  private readonly configurations: Record<D3SourceResourceRole, string>;
  constructor(private readonly activation: DevelopmentD2Activation, private readonly profile: D3SourceBackupProfile, private readonly layout: D3SourceLayoutReceipt,
    private readonly docker: FixedD3Docker, private readonly state: DurableD3SourceState, private readonly admission: D3SourceAdmission,
    private readonly volumes: D3SourceVolumeMaterialization, private readonly probes: D3SourceHealthProbes, private readonly clock: D3SourceClock = defaultClock) {
    const authority = deriveD3OperationAuthority(activation); validateD3SourceLayout(layout);
    if (profile.minio.user !== authority.ownerUid || profile.minio.group !== authority.ownerGid || profile.valkey.user !== authority.ownerUid || profile.valkey.group !== authority.ownerGid ||
        state.authority.operationId !== authority.operationId) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_AUTHORITY_MISMATCH');
    this.configurations = d3SourceConfigurations(activation, profile, layout, state.profileSha256);
  }
  async observe(): Promise<{ status: D3SourceServiceStatus; topologyComplete: boolean; inventory: D3SourceDockerInventory; retained: D3SourceResource[] }> {
    const retained = await this.state.resources(); const inventory = await this.docker.inspectSourceInventory(this.profile, this.configurations);
    const observed = validateD3SourceInventory(retained, inventory); if (retained.resources.some(({ role }) => ['postgres', 'minio', 'valkey'].includes(role))) await this.verifyMaterialization(); return observed;
  }
  async verifyMaterialization() { const resources = (await this.state.readOnlyView().resources()).resources.slice(0, 5); const evidence = await this.volumes.verifyRetained({ profile: this.profile, resources, layout: this.layout }); if (!sha(evidence.evidenceSha256)) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_MATERIALIZATION_BINDING_UNVERIFIED'); await this.state.readOnlyView().verifyMaterializationBinding(this.layout.evidenceSha256, resources, evidence.evidenceSha256); }
  private prefix(resources: readonly D3SourceResource[]) { const order = Object.keys(D3_SOURCE_RESOURCE_NAMES); if (resources.some((resource, index) => resource.role !== order[index] || resource.retired && resource.role !== 'postgres-init') || resources.length > 5 && !resources.find(({ role }) => role === 'postgres-init')?.retired) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_PARTIAL_OR_STOPPED'); }
  async pendingCreateProof() {
    await this.state.assertCurrentCommand(); const retained = await this.state.resources(); if (retained.pendingRoles.length !== 1) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_CREATION_AMBIGUOUS'); this.prefix(retained.resources);
    const role = retained.pendingRoles[0]!; if (Object.keys(D3_SOURCE_RESOURCE_NAMES)[retained.resources.length] !== role) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_CREATION_AMBIGUOUS');
    const intent = await this.state.pendingIntent(role); if (!intent || intent.configurationSha256 !== this.configurations[role] || await this.state.hasStartEvidence(role)) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_RECONCILIATION_UNVERIFIED');
    const inventory = await this.docker.inspectSourceInventory(this.profile, this.configurations); const candidate = inventory.observed.find(({ resource }) => resource.role === role); if (!candidate) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_RECONCILIATION_UNVERIFIED'); let cid: string | null = null;
    if (candidate.resource.kind === 'container') { const handle = await openD3ProtectedFile(this.state.authority, `${this.state.authority.root}/source/state/cids/${role}.cid`, 128); try { const bytes = await handle.readFile('utf8'); if (!/^[a-f0-9]{64}\n?$/.test(bytes)) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_RECONCILIATION_UNVERIFIED'); cid = bytes.trim(); } finally { await handle.close(); }
      if (cid !== candidate.resource.id || !candidate.createdUnstarted || candidate.running || candidate.exitCode !== 0) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_RECONCILIATION_UNVERIFIED'); }
    const current = validateD3SourceInventory({ resources: [...retained.resources, candidate.resource], pendingRoles: [] }, inventory);
    if (['postgres', 'minio', 'valkey'].includes(role)) await this.verifyMaterialization();
    return { role, candidate, cid, retained: retained.resources, inventory, evidenceSha256: digest({ intentSha256: intent.receiptSha256, candidate, cid, inventory: current.inventory }) };
  }
  async reconcilePending(signal?: AbortSignal): Promise<D3SourceResourceRole[]> {
    this.checkSignal(signal); if (!(await this.state.resources()).pendingRoles.length) return []; const before = await this.pendingCreateProof();
    await this.admission.assert({ phase: `RECONCILE_${before.role}`, retainedResources: before.retained }); this.checkSignal(signal); const after = await this.pendingCreateProof(); if (before.evidenceSha256 !== after.evidenceSha256) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_RECONCILIATION_UNVERIFIED');
    await this.state.recordReconciliation(after.candidate.resource, after.cid, after.evidenceSha256); await this.state.recordCreated(after.candidate.resource); this.checkSignal(signal); return [after.role];
  }
  private async create(role: D3SourceResourceRole, signal?: AbortSignal) { this.checkSignal(signal); const retained = await this.state.resources(); this.checkSignal(signal);
    await this.admission.assert({ phase: `CREATE_${role}`, retainedResources: retained.resources }); this.checkSignal(signal);
    await this.state.reserveResource(role, this.configurations[role]); this.checkSignal(signal);
    const observed = await this.docker.createSourceResource(this.profile, role, this.configurations[role], signal);
    await this.state.recordCreated(observed.resource); this.checkSignal(signal); return observed; }
  private async start(observed: D3SourceDockerObservation, signal?: AbortSignal) { this.checkSignal(signal); const retained = await this.state.resources(); this.checkSignal(signal);
    await this.admission.assert({ phase: `START_${observed.resource.role}`, retainedResources: retained.resources }); this.checkSignal(signal);
    await this.state.recordStartIntent(observed.resource); this.checkSignal(signal);
    await this.docker.startExact(observed.resource.id, signal); this.checkSignal(signal); }
  private checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED'); }
  async prepare(signal?: AbortSignal): Promise<{ evidenceSha256: string; resources: D3SourceResource[] }> {
    this.checkSignal(signal); const existing = await this.observe();
    if (await this.state.stopReceipt()) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_PARTIAL_OR_STOPPED'); this.prefix(existing.retained);
    if (existing.status !== 'READY') {
      const retainedResource = async (role: D3SourceResourceRole) => (await this.state.resources()).resources.find((resource) => resource.role === role);
      const get = async (role: D3SourceResourceRole) => await retainedResource(role) ? this.docker.inspectSourceResource(this.profile, role, this.configurations[role]) : this.create(role, signal);
      for (const role of ['network', 'postgres-volume', 'minio-volume', 'valkey-volume'] as const) if (!await retainedResource(role)) await this.create(role, signal);
      if (!(await retainedResource('postgres-init'))?.retired) {
      const init = await get('postgres-init'); if (!init.running) { if (!init.createdUnstarted || await this.state.hasStartEvidence('postgres-init')) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_PARTIAL_OR_STOPPED'); await this.start(init, signal); }
      else if (!await this.state.hasStartEvidence('postgres-init')) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_RECONCILIATION_UNVERIFIED');
      const deadline = this.clock.now() + this.profile.postgres.init_timeout_ms; let ready = false;
      for (let attempt = 0; attempt < this.profile.health.attempts; attempt++) { this.checkSignal(signal); const observed = await this.docker.inspectSourceResource(this.profile, 'postgres-init', this.configurations['postgres-init']);
        if (observed.resource.id !== init.resource.id || observed.resource.identitySha256 !== init.resource.identitySha256 || !observed.running) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_POSTGRES_INIT_FAILED');
        if (observed.health === 'healthy' && this.clock.now() <= deadline) { ready = true; break; } if (observed.health === 'unhealthy' || this.clock.now() >= deadline) break; await this.clock.wait(this.profile.health.interval_ms, signal); }
      if (!ready) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_POSTGRES_INIT_FAILED');
      this.checkSignal(signal);
      await this.docker.stopExact(init.resource.id); await this.docker.joinExactSourceContainer(init.resource.id); const stopped = await this.docker.inspectSourceResource(this.profile, 'postgres-init', this.configurations['postgres-init']);
      if (stopped.running || stopped.exitCode !== 0 || stopped.resource.id !== init.resource.id) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_POSTGRES_INIT_FAILED');
      this.checkSignal(signal); await this.docker.removeExact(init.resource.id); const after = await this.docker.inspectSourceInventory(this.profile, this.configurations); if (after.observed.some(({ resource }) => resource.role === 'postgres-init')) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_POSTGRES_INIT_FAILED');
      await this.state.retireResource('postgres-init', digest({ id: init.resource.id, joined: true, removed: true }));
      }
      if (!(await this.state.resources()).resources.some(({ role }) => ['postgres', 'minio', 'valkey'].includes(role))) {
      this.checkSignal(signal); const materialized = await this.volumes.prepare({ profile: this.profile, resources: (await this.state.resources()).resources, layout: this.layout, ...(signal ? { signal } : {}) });
      if (materialized.postgresOwner !== '70:70' || materialized.minioOwner !== `${this.profile.minio.user}:${this.profile.minio.group}` || materialized.valkeyOwner !== `${this.profile.valkey.user}:${this.profile.valkey.group}` ||
          materialized.directoryMode !== '0700' || materialized.fileMode !== '0600' || materialized.postgresTlsAndScramVerified !== true || !sha(materialized.evidenceSha256)) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_VOLUME_MATERIALIZATION_UNVERIFIED');
      await this.state.recordMaterializationBinding(this.layout.evidenceSha256, (await this.state.resources()).resources, materialized.evidenceSha256);
      }
      else await this.verifyMaterialization();
      for (const role of ['postgres', 'minio', 'valkey'] as const) { const service = await get(role); if (!service.running) { if (!service.createdUnstarted || await this.state.hasStartEvidence(role)) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_PARTIAL_OR_STOPPED'); await this.start(service, signal); } }
    }
    return this.converge(signal);
  }
  async converge(signal?: AbortSignal): Promise<{ evidenceSha256: string; resources: D3SourceResource[] }> {
    const deadline = this.clock.now() + this.profile.health.total_timeout_ms;
    for (let attempt = 0; attempt < this.profile.health.attempts; attempt++) {
      this.checkSignal(signal); const current = await this.observe(); if (current.status !== 'READY') throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_PARTIAL_OR_STOPPED');
      await this.admission.assert({ phase: 'AUTHENTICATED_HEALTH', retainedResources: current.retained });
      const input = (role: 'postgres' | 'minio' | 'valkey') => ({ profile: this.profile, containerId: current.inventory.observed.find(({ resource }) => resource.role === role)!.resource.id,
        timeoutMs: Math.max(1, Math.min(this.profile.health.probe_timeout_ms, deadline - this.clock.now())), ...(signal ? { signal } : {}) });
      let postgres; let minio; let valkey;
      try { postgres = await this.probes.postgresTlsSelect(input('postgres')); minio = await this.probes.minioTlsS3(input('minio')); valkey = await this.probes.valkeyTlsPing(input('valkey')); }
      catch { throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_AUTHENTICATED_HEALTH_FAILED'); }
      this.checkSignal(signal);
      const checks = { postgres, minio, valkey }; const valid = Object.entries(checks).every(([role, probe]) => probe.authenticated && probe.tlsVerified && probe.plaintextRejected && probe.unauthenticatedRejected &&
        probe.peerCertificateSha256 === this.layout.certificates[role as keyof typeof checks] && sha(probe.evidenceSha256));
      if (valid && postgres.result === '1' && postgres.database === 'darshan' && postgres.user === 'darshan' && postgres.serverMajor === 16 && minio.operation === 'LIST_BUCKETS' && minio.success && valkey.reply === 'PONG' && valkey.aclUser === 'd3-source' && this.clock.now() <= deadline)
        return { evidenceSha256: digest({ layout: this.layout.evidenceSha256, checks, resources: current.retained }), resources: current.retained };
      if (this.clock.now() >= deadline) break; await this.clock.wait(this.profile.health.interval_ms, signal);
    }
    throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_AUTHENTICATED_HEALTH_FAILED');
  }
  async stop(): Promise<{ evidenceSha256: string; resources: D3SourceResource[] }> {
    const current = await this.observe(); if (!current.topologyComplete) throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_PARTIAL_OR_STOPPED');
    for (const role of ['valkey', 'minio', 'postgres'] as const) { const observed = current.inventory.observed.find(({ resource }) => resource.role === role)!;
      if (observed.running) { await this.admission.assert({ phase: `STOP_${role}`, retainedResources: current.retained }); await this.docker.stopExact(observed.resource.id); }
      await this.docker.joinExactSourceContainer(observed.resource.id); }
    const after = await this.observe(); if (after.status !== 'STOPPED') throw serviceError('CONTROLLED_RECOVERY_D3_SOURCE_STOP_UNVERIFIED');
    return { resources: after.retained, evidenceSha256: digest({ resources: after.retained, stopped: true }) };
  }
}
