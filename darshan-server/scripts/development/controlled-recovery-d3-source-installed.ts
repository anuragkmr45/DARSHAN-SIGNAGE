import { randomUUID } from 'node:crypto';
import { mkdir, rmdir, unlink } from 'node:fs/promises';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import type { DevelopmentD2Activation } from './controlled-recovery-d2';
import { FixedD3Docker } from './controlled-recovery-d3-docker';
import { loadD3Foundation } from './controlled-recovery-d3-foundation';
import { openD3ProtectedFile, protectD3Directory, publishD3ProtectedBytes, syncD3Directory } from './controlled-recovery-d3-protected-files';
import { D3SourceBackupController } from './controlled-recovery-d3-source-backup';
import type { D3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import { D3_SOURCE_RESOURCE_NAMES, DurableD3SourceState, type D3SourceResource, type D3SourceResourceRole } from './controlled-recovery-d3-source-state';
import { d3SourceConfigurations, FixedD3SourceServices, validateD3SourceInventory, type D3SourceAdmission, type D3SourceHealthProbes, type D3SourceLayoutBoundary, type D3SourceVolumeMaterialization } from './controlled-recovery-d3-source-services';
import { createDevelopmentReadinessSystem, loadDevelopmentReadinessActivation, observeDevelopmentReadiness, type DevelopmentReadinessActivation, type DevelopmentReadinessSystem } from './controlled-recovery-readiness';
import { DurableD3SourceData, FixedD3SourceData } from './controlled-recovery-d3-source-data';
import { createD3DataClients, type D3DataClients } from './controlled-recovery-d3-source-data-clients';
import { d3SourceFailureDetails } from './controlled-recovery-d3-source-process';
import { FixedD3RecoveryPrefix, ProtectedD3RecoveryPrefixAuthority, d3PrefixAgeKeyMetadata, loadD3PrefixManifest, type D3PrefixServices } from './controlled-recovery-d3-recovery-prefix';
import { loadD3RecoveryPrefixEnrollment } from './controlled-recovery-d3-recovery-prefix-contract';
import { createD3RecoveryPrefixClients } from './controlled-recovery-d3-recovery-prefix-clients';
import { readD3AgePublicReceipt } from './controlled-recovery-d3-age-staging';
import { buildD3DataFixtures } from './controlled-recovery-d3-source-data-fixtures';
import { assertD3CapsuleAcceptedData, FixedInstalledD3Capsule, loadD3CapsuleActivation } from './controlled-recovery-d3-capsule-installed';
import type { D3CapsuleReceipt } from './controlled-recovery-d3-capsule';

export const D3_SOURCE_LIVE_COMMANDS = ['preflight', 'prepare', 'status', 'stop', 'seed', 'data-status', 'recovery-prefix', 'capsule', 'capsule-status'] as const;
export type D3SourceLiveCommand = typeof D3_SOURCE_LIVE_COMMANDS[number];
const failed = (code = 'CONTROLLED_RECOVERY_D3_SOURCE_PROVIDER_WIRING_INVALID') => new ControlledRecoveryError(code, 'The fixed source provider, admission, ownership or operation-lock authority is unverified.');
export function parseD3SourceLiveCommand(argv: readonly string[]): D3SourceLiveCommand {
  if (argv.length === 1 && ['capture', 'resume'].includes(argv[0]!)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_BACKUP_DEPENDENCIES_NOT_ENROLLED');
  if (argv.length !== 1 || !D3_SOURCE_LIVE_COMMANDS.includes(argv[0] as D3SourceLiveCommand)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_INVALID'); return argv[0] as D3SourceLiveCommand;
}

/** Shared controller/source lock. Stale or uncertain ownership is retained, never adopted by PID. */
export class D3SourceControllerLock {
  private token: string | null = null;
  private get path() { return `${this.authority.root}/run/controller-source.lock`; }
  constructor(private readonly authority: D3OperationAuthority, private readonly state: DurableD3SourceState) {}
  async busy() { try { await protectD3Directory(this.authority, this.path); return true; } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false; throw failed(); } }
  async assert() { if (!this.token) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTROLLER_LOCK_REQUIRED'); const handle = await openD3ProtectedFile(this.authority, `${this.path}/owner.json`, 4096);
    try { const bytes = await handle.readFile(); const value = parseStrictJson(bytes, 4096) as Record<string, unknown>; if (!canonicalJson(value).equals(bytes) || value.token !== this.token || value.processId !== process.pid || value.operationId !== this.authority.operationId || value.siteId !== this.authority.siteId || value.repositoryId !== this.authority.repositoryId || value.profileSha256 !== this.state.profileSha256) throw failed(); } finally { await handle.close(); } }
  async run<T>(command: 'prepare' | 'stop' | 'seed' | 'capsule' | 'backup-capabilities' | 'backup', action: () => Promise<T>): Promise<T> {
    await protectD3Directory(this.authority, `${this.authority.root}/run`, true); try { await mkdir(this.path, { mode: 0o700 }); } catch { throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTROLLER_BUSY'); }
    this.token = randomUUID(); let retain = false;
    await publishD3ProtectedBytes(this.authority, `${this.path}/owner.json`, canonicalJson({ format: 'darshan-d3-source-controller-lock-v1', operationId: this.authority.operationId, siteId: this.authority.siteId, repositoryId: this.authority.repositoryId, profileSha256: this.state.profileSha256, command, token: this.token, processId: process.pid })); await syncD3Directory(`${this.authority.root}/run`);
    try { return await action(); } catch (cause) { retain = cause instanceof ControlledRecoveryError && cause.code.includes('UNCERTAIN'); throw cause; }
    finally { if (await this.state.readOnlyView().commandInProgress()) retain = true; if (!retain) { await this.assert(); await unlink(`${this.path}/owner.json`); await rmdir(this.path); await syncD3Directory(`${this.authority.root}/run`); } this.token = null; }
  }
}

export interface D3SourceProviderBindings {
  authority: D3OperationAuthority; activation: DevelopmentD2Activation; profile: D3SourceBackupProfile; state: DurableD3SourceState;
  layout: D3SourceLayoutBoundary; readOnlyLayout: Pick<D3SourceLayoutBoundary, 'verify'>; docker: FixedD3Docker; readOnlyDocker: FixedD3Docker;
  volumes: D3SourceVolumeMaterialization; health: D3SourceHealthProbes; readOnlyHealth: D3SourceHealthProbes; hostAdmission(): Promise<void>;
  readinessActivation: DevelopmentReadinessActivation; readinessSystem: DevelopmentReadinessSystem;
}
function validateBindings(value: D3SourceProviderBindings) {
  if (!value?.authority || !value.activation || !value.profile || !value.readinessActivation || !value.state) throw failed();
  const methods: Array<[unknown, string[]]> = [[value.state, ['resources', 'stages', 'readOnlyView', 'withCommandLock']], [value.layout, ['prepare', 'verify']], [value.readOnlyLayout, ['verify']], [value.docker, ['inspectSourceInventory', 'createSourceResource', 'startExact', 'stopExact']], [value.readOnlyDocker, ['inspectSourceInventory', 'inspectSourceResource']], [value.volumes, ['prepare', 'verifyRetained']], [value.health, ['postgresTlsSelect', 'minioTlsS3', 'valkeyTlsPing']], [value.readOnlyHealth, ['postgresTlsSelect', 'minioTlsS3', 'valkeyTlsPing']], [value.readinessSystem, ['readText', 'fileStat', 'fileSystemStat', 'inspectDockerContext', 'inspectDockerDaemon', 'inspectDockerImages', 'listRunningDockerContainers']]];
  if (methods.some(([object, names]) => !object || names.some((name) => typeof (object as Record<string, unknown>)[name] !== 'function')) || typeof value.hostAdmission !== 'function' || !value.profile.providers_enabled || !value.profile.live_prepare_enabled || value.profile.capture_enabled || value.profile.enabled || value.activation.enabled || digest(value.state.authority) !== digest(value.authority) || value.activation.operation_id !== value.authority.operationId || digest(value.readinessActivation) !== value.activation.d1_activation_sha256 || ['minio', 'valkey'].some((role) => value.profile[role as 'minio' | 'valkey'].user !== value.authority.ownerUid || value.profile[role as 'minio' | 'valkey'].group !== value.authority.ownerGid)) throw failed();
}

/** Fixed source/data commands plus separately gated capsule; backup/broker/capture remain unavailable. */
export class InstalledD3SourceProviders {
  private readonly lock: D3SourceControllerLock; private firefoxIdentity: string | null = null;
  private dataFactory: (() => Promise<FixedD3SourceData>) | null = null;
  private prefixFactory: (() => Promise<Pick<FixedD3RecoveryPrefix, 'observe'>>) | null = null;
  private capsuleFactory: (() => Promise<Pick<FixedInstalledD3Capsule, 'execute'>>) | null = null;
  private capsuleOwned = false; private backupOwned = false; private backupClients: (() => Promise<D3DataClients>) | null = null;
  constructor(private readonly bindings: D3SourceProviderBindings) { validateBindings(bindings); this.lock = new D3SourceControllerLock(bindings.authority, bindings.state); }
  bindData(factory: () => Promise<FixedD3SourceData>) { if (this.dataFactory || typeof factory !== 'function') throw failed(); this.dataFactory = factory; }
  bindRecoveryPrefix(factory: () => Promise<Pick<FixedD3RecoveryPrefix, 'observe'>>) { if (this.prefixFactory || typeof factory !== 'function') throw failed(); this.prefixFactory = factory; }
  bindCapsule(factory: () => Promise<Pick<FixedInstalledD3Capsule, 'execute'>>) { if (this.capsuleFactory || typeof factory !== 'function') throw failed(); this.capsuleFactory = factory; }
  async assertCapsuleInactive() { if (await this.lock.busy() || await this.bindings.state.readOnlyView().commandInProgress()) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTROLLER_BUSY'); }
  async capsuleOperationOwnership() { if (!this.capsuleOwned) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTROLLER_LOCK_REQUIRED'); await this.lock.assert(); await this.bindings.state.assertCurrentCommand(); const read = async (path: string) => { const file = await openD3ProtectedFile(this.bindings.authority, path, 4096); try { return digest(parseStrictJson(await file.readFile(), 4096)); } finally { await file.close(); } }; return { controllerReceiptSha256: await read(`${this.bindings.authority.root}/run/controller-source.lock/owner.json`), sourceCommandReceiptSha256: await read(`${this.bindings.authority.root}/source/state/command.lock/owner.json`) }; }
  bindBackupClients(factory: () => Promise<D3DataClients>) { if (this.backupClients || typeof factory !== 'function') throw failed(); this.backupClients = factory; }
  createDataClients(fallback: () => Promise<D3DataClients>) { return (this.backupClients ?? fallback)(); }
  async assertBackupOwned() { if (!this.backupOwned) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTROLLER_LOCK_REQUIRED'); await this.lock.assert(); await this.bindings.state.assertCurrentCommand(); }
  async withBackupOperationLock<T>(command: 'backup-capabilities' | 'backup', action: () => Promise<T>) { return this.lock.run(command, () => this.bindings.state.withCommandLock(command, async () => { this.backupOwned = true; this.capsuleOwned = true; try { await this.assertBackupOwned(); return await action(); } catch (cause) { if (cause instanceof ControlledRecoveryError && cause.code.includes('UNCERTAIN')) await this.bindings.state.retainUncertainCommand(digest(cause.code)); throw cause; } finally { this.backupOwned = false; this.capsuleOwned = false; } })); }
  async withCapsuleOperationLock<T>(action: () => Promise<T>) { return this.lock.run('capsule', () => this.bindings.state.withCommandLock('capsule', async () => { this.capsuleOwned = true;
    try { await this.bindings.state.stages(); return await action(); } catch (cause) { if (cause instanceof ControlledRecoveryError && cause.code.includes('UNCERTAIN')) await this.bindings.state.retainUncertainCommand(digest(cause.code)); throw cause; } finally { this.capsuleOwned = false; } })); }
  async admitCapsule() { const truth = await this.observeDataServices(); await this.admit('CAPSULE', truth.resources, !this.capsuleOwned); }
  async observeCapsuleData(signal?: AbortSignal) { if (!this.dataFactory) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_NOT_ADMITTED'); await this.admitCapsule(); await this.services(!this.capsuleOwned).converge(signal); const report = await (await this.dataFactory()).status(signal); assertD3CapsuleAcceptedData(report); return report; }
  async recordCapsuleReady(receipt: D3CapsuleReceipt) { if (!this.capsuleOwned) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTROLLER_LOCK_REQUIRED'); await this.bindings.state.assertCurrentCommand(); const resources = await this.bindings.state.readOnlyView().resources(); if (resources.pendingRoles.length || digest(resources.resources) !== receipt.resourcesSha256) throw failed(); await this.bindings.state.appendStage('CAPSULE_READY', receipt.receiptSha256, resources.resources); }
  async assertCapsuleStage(receipt: D3CapsuleReceipt) { const state = this.bindings.state.readOnlyView(), stages = await state.stages(), resources = await state.resources(); if (stages.length !== 5 || stages[4]?.stage !== 'CAPSULE_READY' || stages[4].evidenceSha256 !== receipt.receiptSha256 || digest(stages[4].resources) !== receipt.resourcesSha256 || resources.pendingRoles.length || await state.stopReceipt()) throw failed('CONTROLLED_RECOVERY_D3_CAPSULE_STAGE_UNVERIFIED'); }
  async observeRecoveryPrefix(signal?: AbortSignal): Promise<D3PrefixServices> { const truth = await this.observeDataServices(); const stages = await this.bindings.state.readOnlyView().stages(); if (stages.length !== 2 || stages[1]?.stage !== 'SERVICES_READY') throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_STAGE_REQUIRED'); const report = await this.admit('RECOVERY_PREFIX', truth.resources, true); await this.services(true).converge(signal); return { ...truth, readiness: { memory: report.memory as D3PrefixServices['readiness']['memory'], requiredAvailableBytes: report.projectedSerialPeak.requiredAvailableBytes, firefoxUntouched: true, evidenceSha256: report.evidenceSha256 } }; }
  async observeDataServices() { const truth = await this.services(true).observe(); const stages = await this.bindings.state.readOnlyView().stages(); if (truth.status !== 'READY' || !truth.topologyComplete || stages.length < 2 || stages.length > 5 || stages.length === 5 && stages[4]?.stage !== 'CAPSULE_READY' || await this.bindings.state.readOnlyView().stopReceipt()) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_STAGE_REQUIRED'); return { resources: truth.retained, layout: await this.bindings.readOnlyLayout.verify() }; }
  private async retainedIndex() { try { const value = await this.bindings.state.readOnlyView().resources(); return { retainedResources: value.resources.map(({ role, id, retired }) => ({ role, id, retired })), pendingRoles: value.pendingRoles }; } catch { return { retainedResources: null, pendingRoles: null }; } }
  private services(readOnly: boolean) {
    const b = this.bindings; const state = readOnly ? b.state.readOnlyView() : b.state; const layout = readOnly ? b.readOnlyLayout : b.layout; const docker = readOnly ? b.readOnlyDocker : b.docker; const health = readOnly ? b.readOnlyHealth : b.health;
    const admission: D3SourceAdmission = { assert: async (input) => { await this.admit(input.phase, input.retainedResources, readOnly); } };
    const create = async () => { const verified = await layout.verify(); const stages = await state.stages(); if (stages[0] && stages[0].evidenceSha256 !== digest(verified)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_CHANGED'); return new FixedD3SourceServices(b.activation, b.profile, verified, docker, state, admission, b.volumes, health); };
    return { prepare: async (signal?: AbortSignal) => (await create()).prepare(signal), converge: async (signal?: AbortSignal) => (await create()).converge(signal), stop: async () => (await create()).stop(),
      pendingCreateProof: async () => { if (readOnly) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_READ_ONLY'); return (await create()).pendingCreateProof(); },
      reconcilePending: async (signal?: AbortSignal) => { if (readOnly) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_READ_ONLY'); return (await create()).reconcilePending(signal); },
      verifyMaterialization: async () => (await create()).verifyMaterialization(),
      observe: async () => { const stages = await state.stages(); if (stages.length) return (await create()).observe(); const retained = await state.resources(); if (retained.resources.length || retained.pendingRoles.length) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED'); const inventory = await docker.inspectSourceInventory(b.profile, null);
        if (inventory.subnetCollision) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_SUBNET_COLLISION'); if (inventory.observed.length || inventory.volumeConsumers.length) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_FOREIGN_VOLUME_CONSUMER'); return { status: 'EMPTY' as const, topologyComplete: false, inventory, retained: [] }; } };
  }
  async assertEffectAdmission(phase: string) { const retained = await this.bindings.state.readOnlyView().resources(); if (retained.pendingRoles.length && !phase.startsWith('DOCKER_')) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CREATION_AMBIGUOUS'); await this.admit(phase, retained.resources, false); }
  private async admit(phase: string, retained: readonly D3SourceResource[], readOnly: boolean) {
    const b = this.bindings; if (!readOnly) { await this.lock.assert(); if (!phase.startsWith('ENTRY_')) await b.state.assertCurrentCommand(); }
    else if (await this.lock.busy() || await b.state.readOnlyView().commandInProgress()) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTROLLER_BUSY');
    const state = b.state.readOnlyView(); const reserved = phase.startsWith('DOCKER_CREATE_') ? phase.slice('DOCKER_CREATE_'.length) as D3SourceResourceRole : undefined;
    if (reserved && (!(reserved in D3_SOURCE_RESOURCE_NAMES) || readOnly)) throw failed();
    const proof = phase.startsWith('RECONCILE_') ? await this.services(false).pendingCreateProof() : null; if (proof && phase !== `RECONCILE_${proof.role}`) throw failed();
    const observed = proof ? { retained: proof.retained } : reserved ? validateD3SourceInventory(await state.resources(), await b.readOnlyDocker.inspectSourceInventory(b.profile, d3SourceConfigurations(b.activation, b.profile, await b.readOnlyLayout.verify(), state.profileSha256)), reserved) : await this.services(true).observe(); if (digest(retained) !== digest(observed.retained)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED');
    if (reserved && ['postgres', 'minio', 'valkey'].includes(reserved)) await this.services(true).verifyMaterialization();
    await b.hostAdmission(); const firefox = await b.readinessSystem.fileStat(b.readinessActivation.firefox_executable); const identity = digest(firefox); if (firefox.kind !== 'file' || !(firefox.mode & 0o111) || this.firefoxIdentity && this.firefoxIdentity !== identity) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_FIREFOX_CHANGED'); this.firefoxIdentity = identity;
    const owned = new Set((await state.resources()).resources.filter((resource) => resource.kind === 'container' && !resource.retired).map(({ id }) => id));
    const system: DevelopmentReadinessSystem = { ...b.readinessSystem, listRunningDockerContainers: async () => { const bytes = await b.readinessSystem.listRunningDockerContainers(); const lines = Buffer.from(bytes).toString('utf8').split('\n').filter(Boolean); if (lines.length > 256) throw failed(); return Buffer.from(lines.filter((line) => { const row = parseStrictJson(Buffer.from(line), 64 * 1024) as { ID: string }; if (!/^[a-f0-9]{64}$/.test(row.ID)) throw failed(); return !owned.has(row.ID); }).join('\n')); } };
    const report = await observeDevelopmentReadiness(b.readinessActivation, system); if (report.status !== 'READY' || report.memory.pressureAvg10Micros === null || BigInt(report.memory.swapUsedBytes) < 0n || !report.artifacts.firefoxUntouched || !report.docker.observed) throw failed(report.codes[0] ?? 'CONTROLLED_RECOVERY_D3_SOURCE_READINESS_UNVERIFIED');
    if (digest(await b.readinessSystem.fileStat(b.readinessActivation.firefox_executable)) !== this.firefoxIdentity) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_FIREFOX_CHANGED');
    return report;
  }
  async execute(command: D3SourceLiveCommand, signal?: AbortSignal): Promise<Record<string, unknown>> {
    parseD3SourceLiveCommand([command]); const b = this.bindings; const cancelled = () => { if (signal?.aborted) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED'); };
    if (command === 'recovery-prefix') { if (!this.prefixFactory) throw failed('CONTROLLED_RECOVERY_D3_PREFIX_NOT_ADMITTED'); return (await this.prefixFactory()).observe(signal); }
    if (command === 'capsule' || command === 'capsule-status') { if (!this.capsuleFactory) throw failed('CONTROLLED_RECOVERY_D3_CAPSULE_NOT_ADMITTED'); return (await this.capsuleFactory()).execute(command, signal); }
    if (command === 'seed' || command === 'data-status') { if (!this.dataFactory) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_NOT_ADMITTED'); const data = await this.dataFactory();
      if (command === 'data-status') { cancelled(); const truth = await this.observeDataServices(); await this.admit('DATA_STATUS', truth.resources, true); await this.services(true).converge(signal); return data.status(signal); }
      data.assertSeedEnrolled(); return this.lock.run('seed', () => b.state.withCommandLock('seed', async () => { cancelled(); const truth = await this.observeDataServices(); await this.admit('ENTRY_seed', truth.resources, false); await this.services(false).converge(signal); return data.seed(signal); })); }
    if (command === 'preflight' || command === 'status') {
      try { cancelled(); if (await this.lock.busy() || await b.state.readOnlyView().commandInProgress()) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTROLLER_BUSY'); const truth = await this.services(true).observe(); const readiness = await this.admit('PREFLIGHT', truth.retained, true); cancelled();
        const stage = (await b.state.readOnlyView().stages()).at(-1)?.stage ?? null; if (truth.status === 'PARTIAL') throw failed('CONTROLLED_RECOVERY_D3_SOURCE_PARTIAL_OR_STOPPED');
        if (command === 'status' && truth.status === 'READY' && ['SCHEMA_READY', 'SEEDED_AND_SEALED', 'CAPSULE_READY'].includes(stage ?? '')) await this.services(true).converge(signal);
        const result = command === 'status' && !['SCHEMA_READY', 'SEEDED_AND_SEALED', 'CAPSULE_READY'].includes(stage ?? '') ? await new D3SourceBackupController({ state: b.state.readOnlyView(), layout: { prepare: async () => { throw failed('CONTROLLED_RECOVERY_D3_SOURCE_READ_ONLY'); }, verify: () => b.readOnlyLayout.verify() }, services: this.services(true) }).execute('status') : {};
        return { format: 'darshan-d3-source-provider-report-v1', command, status: truth.status === 'MIXED' ? 'STOP_REQUIRED' : truth.status === 'STOPPED' ? 'STOPPED_RETAINED' : 'READY', sourceStatus: truth.status, stage, nextAction: truth.status === 'MIXED' ? 'stop' : truth.status === 'STOPPED' ? 'REVIEW_RETAINED_RESOURCES' : ['SCHEMA_READY', 'SEEDED_AND_SEALED', 'CAPSULE_READY'].includes(stage ?? '') ? 'data-status' : command === 'preflight' ? 'prepare' : 'NONE', captureEnabled: false, wholeRunEnabled: false, backupCreated: false, ownershipReobserved: true, ...await this.retainedIndex(), readiness: { memory: readiness.memory, requiredAvailableBytes: readiness.projectedSerialPeak.requiredAvailableBytes, firefoxUntouched: readiness.artifacts.firefoxUntouched, evidenceSha256: readiness.evidenceSha256 }, ...result };
      } catch (cause) { return { format: 'darshan-d3-source-provider-report-v1', command, status: 'BLOCKED', codes: [cause instanceof ControlledRecoveryError ? cause.code : 'CONTROLLED_RECOVERY_D3_SOURCE_PREFLIGHT_FAILED'], nextAction: 'REVIEW_RETAINED_RESOURCES', captureEnabled: false, wholeRunEnabled: false, backupCreated: false, ownershipReobserved: false, ...d3SourceFailureDetails(cause), ...await this.retainedIndex() }; }
    }
    return this.lock.run(command, async () => { cancelled(); if (command === 'stop') { const truth = await this.services(true).observe(); if (!truth.topologyComplete) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_PARTIAL_OR_STOPPED'); await this.admit('ENTRY_stop', truth.retained, false); }
      const result = await new D3SourceBackupController({ state: b.state, layout: b.layout, services: this.services(false), prepareAdmission: async (preparingSignal) => { const reconciledRoles = (await b.state.resources()).pendingRoles.length ? await this.services(false).reconcilePending(preparingSignal) : []; cancelled(); const truth = await this.services(true).observe(); await this.admit('ENTRY_prepare', truth.retained, false); return reconciledRoles; } }).execute(command, signal);
      if (digest(await b.readinessSystem.fileStat(b.readinessActivation.firefox_executable)) !== this.firefoxIdentity) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_FIREFOX_CHANGED'); return { ...result, captureEnabled: false, nextAction: command === 'prepare' ? 'status' : 'REVIEW_RETAINED_RESOURCES' }; });
  }
}

export async function loadInstalledD3SourceProviders(enrolled?: Awaited<ReturnType<typeof loadD3Foundation>>): Promise<InstalledD3SourceProviders> {
  const foundation = enrolled ?? await loadD3Foundation(); const d1 = await loadDevelopmentReadinessActivation(); const c = foundation.components; const base = createDevelopmentReadinessSystem(d1);
  const system: DevelopmentReadinessSystem = { ...base, inspectDockerContext: () => c.sourceExecutor.observeReadinessDocker('context'), inspectDockerDaemon: () => c.sourceExecutor.observeReadinessDocker('daemon'), inspectDockerImages: () => c.sourceExecutor.observeReadinessDocker('images'), listRunningDockerContainers: () => c.sourceExecutor.observeReadinessDocker('running') };
  const readOnlyLayout = c.sourceLayout.readOnlyView(); const readOnlyHealth = c.sourceHealth.readOnlyView(readOnlyLayout, (role, id) => c.sourceExecutor.verifyProbeTargetReadOnly(role, id, readOnlyLayout));
  const providers = new InstalledD3SourceProviders({ authority: foundation.authority, activation: foundation.developmentActivation, profile: foundation.profile.source_backup, state: c.sourceState, layout: c.sourceLayout, readOnlyLayout, docker: new FixedD3Docker(foundation.developmentActivation, c.sourceExecutor), readOnlyDocker: new FixedD3Docker(foundation.developmentActivation, c.sourceExecutor.readOnlyView()), volumes: c.sourceVolumes, health: c.sourceHealth, readOnlyHealth, hostAdmission: () => c.sourceExecutor.assertHostAdmission(), readinessActivation: d1, readinessSystem: system }); c.sourceExecutor.bindSourceAdmission((phase) => providers.assertEffectAdmission(phase));
  providers.bindData(async () => { const data = c.sourceDataEnrollment; if (data.profile.source_profile_sha256 !== c.sourceState.profileSha256) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_PROFILE_INVALID'); const store = new DurableD3SourceData(foundation.authority, c.sourceState.profileSha256, data.sha256);
    return new FixedD3SourceData({ authority: foundation.authority, profile: data.profile, profileSha256: data.sha256, sourceProfileSha256: c.sourceState.profileSha256, state: c.sourceState, store, observeServices: () => providers.observeDataServices(), admit: (phase) => providers.assertEffectAdmission(phase), fixtureInputs: () => store.fixtureInputs(), readOnlyFixtureInputs: () => store.readOnlyView().fixtureInputs(), clients: () => providers.createDataClients(() => createD3DataClients(foundation.authority, foundation.profile.source_backup, readOnlyLayout)) }); });
  providers.bindRecoveryPrefix(async () => { const data = c.sourceDataEnrollment, prefix = await loadD3RecoveryPrefixEnrollment(); if (!data.profile.live_seed_enabled || prefix.enrollment.source_profile_sha256 !== c.sourceState.profileSha256 || prefix.enrollment.data_profile_sha256 !== data.sha256) throw failed('CONTROLLED_RECOVERY_D3_PREFIX_NOT_ADMITTED'); const store = new DurableD3SourceData(foundation.authority, c.sourceState.profileSha256, data.sha256);
    return new FixedD3RecoveryPrefix({ authority: foundation.authority, enrollment: prefix.enrollment, enrollmentSha256: prefix.sha256, dataProfile: data.profile, dataProfileSha256: data.sha256, sourceProfileSha256: c.sourceState.profileSha256, observeServices: (signal) => providers.observeRecoveryPrefix(signal), clients: () => createD3RecoveryPrefixClients(foundation.authority, foundation.profile.source_backup, readOnlyLayout), manifest: () => loadD3PrefixManifest(data.profile, prefix.enrollment),
      host: new ProtectedD3RecoveryPrefixAuthority({ authority: foundation.authority, enrollment: prefix.enrollment, state: c.sourceState, data: store, publicAgeReceipt: () => readD3AgePublicReceipt(foundation.authority, foundation.toolsAuthority), fixturePlan: async () => (await buildD3DataFixtures(foundation.authority, await store.readOnlyView().fixtureInputs())).planSha256 }) }); });
  providers.bindCapsule(async () => { const enrolled = await loadD3CapsuleActivation(), a = enrolled.activation;
    if (!a.enabled) throw failed('CONTROLLED_RECOVERY_D3_CAPSULE_NOT_ADMITTED');
    if (enrolled.sha256 !== c.capsuleActivationSha256 || a.source_profile_sha256 !== c.sourceState.profileSha256 || a.data_profile_sha256 !== c.sourceDataEnrollment.sha256 || a.capsule_profile_sha256 !== c.capsuleEnrollment.sha256) throw failed('CONTROLLED_RECOVERY_D3_CAPSULE_BINDING_CHANGED');
    const verifyActivation = async () => { const current = await loadD3CapsuleActivation(); if (!current.activation.enabled || current.sha256 !== c.capsuleActivationSha256) throw failed('CONTROLLED_RECOVERY_D3_CAPSULE_BINDING_CHANGED'); };
    const admit = async () => { await verifyActivation(); await providers.admitCapsule(); };
    const core = c.capsuleProvider({ admit, operationOwnership: () => providers.capsuleOperationOwnership(), withOperationLock: (action) => providers.withCapsuleOperationLock(action), dataStatus: async (signal) => { await verifyActivation(); return providers.observeCapsuleData(signal); },
      verifyRetainedIdentity: async () => { await verifyActivation(); if (await d3PrefixAgeKeyMetadata(foundation.authority) !== a.age_key_metadata_sha256) throw failed('CONTROLLED_RECOVERY_D3_CAPSULE_BINDING_CHANGED'); },
      expected: { sourceIntentSha256: a.source_intent_sha256, layoutSha256: a.layout_sha256, resourcesSha256: a.resources_sha256, ageReceiptSha256: a.age_receipt_sha256 }, onVerified: (receipt) => providers.recordCapsuleReady(receipt) });
    return new FixedInstalledD3Capsule({ activation: a, activationSha256: enrolled.sha256, capsuleProfileSha256: c.capsuleEnrollment.sha256, core, assertInactive: () => providers.assertCapsuleInactive(), assertPublishedStage: (receipt) => providers.assertCapsuleStage(receipt), admit });
  }); return providers;
}
