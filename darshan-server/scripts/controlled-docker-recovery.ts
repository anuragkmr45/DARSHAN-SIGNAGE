#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../src/backups/backup-broker-protocol';
import { ControlledRecoveryError } from '../src/recovery/controlled-docker/contracts';
import { loadInstalledControlledRecoveryActivation, type ControlledRecoveryActivation } from '../src/recovery/controlled-docker/activation';
import { controlledRecoveryPrepareInputSchema, installedControlledRecoveryProfilePath, loadInstalledControlledRecoveryProfile, type ControlledRecoveryProfile } from '../src/recovery/controlled-docker/profile';
import { controlledRecoveryReport, controlledRecoveryStatus, prepareControlledRecovery, resumeControlledRecovery,
  type ControlledRecoveryRequest, type ControlledRecoveryWorkflowAdapter } from '../src/recovery/controlled-docker/workflow';

const HELP = `Usage:
  controlled-docker-recovery prepare --operation-id UUID --backup-run-id UUID --manifest-sha256 SHA256 --site-id ID --approved-release-id release-01|release-03 --recovery-key-file ABSOLUTE
  controlled-docker-recovery resume  --operation-id UUID --backup-run-id UUID --manifest-sha256 SHA256 --site-id ID --approved-release-id release-01|release-03 --recovery-key-file ABSOLUTE
  controlled-docker-recovery status  --operation-id UUID
  controlled-docker-recovery report  --operation-id UUID
  controlled-docker-recovery reconcile --operation-id UUID
  controlled-docker-recovery validate-app --operation-id UUID
  controlled-docker-recovery review-pairing --operation-id UUID --generation UUID --screen-id UUID --certificate-id UUID --decision approve|reject --reason TEXT
  controlled-docker-recovery promote --operation-id UUID --report-sha256 SHA256 --confirm-operation UUID --confirm-report-sha256 SHA256 --approval-id ID
  controlled-docker-recovery accept --operation-id UUID --report-sha256 SHA256 --approval-id ID
  controlled-docker-recovery rollback --operation-id UUID --previous-target-set-sha256 SHA256 --approval-id ID
`;

type Packet2Command = 'reconcile' | 'validate-app' | 'review-pairing' | 'promote' | 'accept' | 'rollback';

export interface ControlledRecoveryCliDependencies {
  loadActivation?(): Promise<ControlledRecoveryActivation>;
  loadProfile(approvedReleaseId?: 'release-01' | 'release-03'): Promise<ControlledRecoveryProfile>;
  adapter?: ControlledRecoveryWorkflowAdapter;
  createPacket1Adapter?(activation: ControlledRecoveryActivation, profile: ControlledRecoveryProfile): Promise<ControlledRecoveryWorkflowAdapter>;
  readReportAggregates(operationId: string): Promise<{ aggregates: Record<string, string>; timingsMs: Record<string, string>; generation?: string; unexecutedGates?: string[] }>;
  packet2?: Record<Packet2Command, (values: ReadonlyMap<string, string>, profile: ControlledRecoveryProfile, signal?: AbortSignal) => Promise<unknown>>;
  createPacket2Handlers?(activation: ControlledRecoveryActivation, profile: ControlledRecoveryProfile): Promise<Record<Packet2Command, (values: ReadonlyMap<string, string>, profile: ControlledRecoveryProfile, signal?: AbortSignal) => Promise<unknown>>>;
}

function unavailableAdapter(): ControlledRecoveryWorkflowAdapter {
  return new Proxy({}, { get() { return async () => { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_NOT_ACTIVATED', 'No installed controlled-recovery deployment adapter is activated.'); }; } }) as ControlledRecoveryWorkflowAdapter;
}

function options(argv: string[]): { command: 'prepare' | 'resume' | 'status' | 'report' | Packet2Command; values: Map<string, string> } {
  const [command, ...rest] = argv;
  if (!['prepare', 'resume', 'status', 'report', 'reconcile', 'validate-app', 'review-pairing', 'promote', 'accept', 'rollback'].includes(command ?? '')) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Unsupported command.');
  const commandOptions: Record<string, string[]> = {
    prepare: ['--operation-id', '--backup-run-id', '--manifest-sha256', '--site-id', '--approved-release-id', '--recovery-key-file'],
    resume: ['--operation-id', '--backup-run-id', '--manifest-sha256', '--site-id', '--approved-release-id', '--recovery-key-file'],
    status: ['--operation-id'], report: ['--operation-id'], reconcile: ['--operation-id'], 'validate-app': ['--operation-id'],
    'review-pairing': ['--operation-id', '--generation', '--screen-id', '--certificate-id', '--decision', '--reason'],
    promote: ['--operation-id', '--report-sha256', '--confirm-operation', '--confirm-report-sha256', '--approval-id'],
    accept: ['--operation-id', '--report-sha256', '--approval-id'],
    rollback: ['--operation-id', '--previous-target-set-sha256', '--approval-id'],
  };
  const allowed = new Set(commandOptions[command!]);
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]; const value = rest[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--') || values.has(name)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Unknown, repeated, or valueless option.');
    values.set(name, value);
  }
  if (![...allowed].every((name) => values.has(name))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Required fixed input is missing.');
  if (command === 'review-pairing' && !['approve', 'reject'].includes(values.get('--decision') ?? '')) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Pairing review decision must be approve or reject.');
  }
  for (const [name, value] of values) {
    if (name.includes('sha256') && !/^[a-f0-9]{64}$/.test(value)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', `${name} must be a SHA-256 digest.`);
  }
  return { command: command as 'prepare' | 'resume' | 'status' | 'report' | Packet2Command, values };
}

function request(values: Map<string, string>): ControlledRecoveryRequest {
  const parsed = controlledRecoveryPrepareInputSchema.parse({ operation_id: values.get('--operation-id'), backup_run_id: values.get('--backup-run-id'),
    manifest_sha256: values.get('--manifest-sha256'), site_id: values.get('--site-id'), approved_release_id: values.get('--approved-release-id'),
    recovery_key_file: values.get('--recovery-key-file') });
  return { operationId: parsed.operation_id, backupRunId: parsed.backup_run_id, manifestSha256: parsed.manifest_sha256,
    siteId: parsed.site_id, approvedReleaseId: parsed.approved_release_id, recoveryKeyFile: parsed.recovery_key_file };
}

export async function runControlledDockerRecoveryCli(argv = process.argv.slice(2), dependencies: ControlledRecoveryCliDependencies = {
  loadActivation: loadInstalledControlledRecoveryActivation,
  loadProfile: (releaseId = 'release-03') => loadInstalledControlledRecoveryProfile(installedControlledRecoveryProfilePath(releaseId)),
  createPacket1Adapter: async () => { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PACKET_B_ASSETS_NOT_ENROLLED', 'Installed Packet A activation does not enroll the additional Packet B execution assets.'); },
  createPacket2Handlers: async () => { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PACKET_C_ASSETS_NOT_ENROLLED', 'Installed Packet A activation does not enroll Packet C effect authorities.'); },
  readReportAggregates: async () => ({ aggregates: {}, timingsMs: {} }),
}, output: { stdout(value: string): void; stderr(value: string): void } = {
  stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value),
}, signal?: AbortSignal): Promise<number> {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { output.stdout(HELP); return 0; }
  try {
    const parsed = options(argv);
    const effectCommand = ['prepare', 'resume', 'reconcile', 'validate-app', 'review-pairing', 'promote', 'accept', 'rollback'].includes(parsed.command);
    const activation = effectCommand && dependencies.loadActivation ? await dependencies.loadActivation() : null;
    const requestedRelease = parsed.values.get('--approved-release-id') as 'release-01' | 'release-03' | undefined;
    if (activation && requestedRelease && requestedRelease !== activation.release.release_id) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_IDENTITY_MISMATCH', 'Requested release differs from installed activation identity.');
    }
    const profile = await dependencies.loadProfile(requestedRelease); const operationId = parsed.values.get('--operation-id')!;
    const packet1Adapter = (parsed.command === 'prepare' || parsed.command === 'resume') && activation && dependencies.createPacket1Adapter
      ? await dependencies.createPacket1Adapter(activation, profile) : dependencies.adapter ?? unavailableAdapter();
    if (parsed.command === 'prepare') await prepareControlledRecovery({ request: request(parsed.values), profile, adapter: packet1Adapter, signal });
    else if (parsed.command === 'resume') await resumeControlledRecovery({ request: request(parsed.values), profile, adapter: packet1Adapter, signal });
    const packet2Command = ['reconcile', 'validate-app', 'review-pairing', 'promote', 'accept', 'rollback'].includes(parsed.command)
      ? parsed.command as Packet2Command : null;
    const packet2Handlers = packet2Command && activation && dependencies.createPacket2Handlers
      ? await dependencies.createPacket2Handlers(activation, profile) : dependencies.packet2;
    if (packet2Command && !packet2Handlers?.[packet2Command]) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_NOT_ACTIVATED', 'Packet 2 deployment adapter is not activated.');
    const data = packet2Command
      ? await packet2Handlers![packet2Command](parsed.values, profile, signal)
      : parsed.command === 'report'
        ? await controlledRecoveryReport({ profile, operationId, ...await dependencies.readReportAggregates(operationId) })
        : await controlledRecoveryStatus(profile, operationId);
    output.stdout(`${canonicalJson({ format: 'darshan-controlled-recovery-cli-v1', command: parsed.command, status: 'SUCCESS', data }).toString('utf8')}\n`);
    return 0;
  } catch (cause) {
    const error = cause instanceof ControlledRecoveryError ? cause : new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Controlled recovery command failed safely.', { cause });
    output.stderr(`${canonicalJson({ format: 'darshan-controlled-recovery-cli-v1', status: 'ERROR', code: error.code }).toString('utf8')}\n`);
    return error.code.includes('INPUT') ? 3 : error.code.includes('ACTIVE') || error.code.includes('BUSY') ? 7 : 5;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runControlledDockerRecoveryCli();

