import { canonicalJson } from '../../backups/backup-broker-protocol';
import { CONTROLLED_RECOVERY_PACKET2_TARGET } from '../release-target';
import { ControlledRecoveryError, digest } from './contracts';
import type { ControlledRecoveryJournalSnapshot } from './journal';

export interface ControlledRecoveryReportV3 {
  format: 'darshan-controlled-recovery-report-v3';
  operation: { operationId: string; siteId: string; state: string; sourceRunId: string; sourceManifestSha256: string; releaseId: string };
  evidence: Array<{ phase: string; code: string; evidenceSha256: string | null; recordedAt: string }>;
  aggregates: Record<string, string>;
  timingsMs: Record<string, string>;
  reportSha256: string;
}

export interface ControlledRecoveryReportV4 {
  format: 'darshan-controlled-recovery-report-v4';
  operation: ControlledRecoveryReportV3['operation'] & { generation: string | null; writeFreezeRequired: true };
  evidence: ControlledRecoveryReportV3['evidence'];
  aggregates: Record<string, string>;
  timingsMs: Record<string, string>;
  unexecutedGates: string[];
  reportSha256: string;
}

const forbidden = /(password|secret|token|private.?key|credential|database.?url|raw.?sql|object.?key|user.?content)/i;

function packet2ReportReleaseId(snapshot: ControlledRecoveryJournalSnapshot): string {
  // Historical Packet 2 extends an immutable release-01/0055 operation into the
  // separately approved release-02/0056 application target. Current controlled
  // operations carry their approved target release directly in durable identity.
  return snapshot.identity.approvedReleaseId === 'release-01'
    ? CONTROLLED_RECOVERY_PACKET2_TARGET.releaseId
    : snapshot.identity.approvedReleaseId;
}

export function buildControlledRecoveryReport(input: {
  snapshot: ControlledRecoveryJournalSnapshot; aggregates: Record<string, string>; timingsMs: Record<string, string>;
}): ControlledRecoveryReportV3 {
  if (input.snapshot.state !== 'DATA_VALIDATED') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_REPORT_NOT_READY', 'Packet 1 report requires DATA_VALIDATED state.');
  for (const record of [input.aggregates, input.timingsMs]) {
    if (Object.entries(record).some(([key, value]) => forbidden.test(key) || !/^(0|[1-9][0-9]*)$/.test(value))) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_REPORT_UNSAFE', 'Report aggregates/timings contain unsafe names or values.');
    }
  }
  const unsigned = { format: 'darshan-controlled-recovery-report-v3' as const,
    operation: { operationId: input.snapshot.identity.operationId, siteId: input.snapshot.identity.siteId,
      state: input.snapshot.state, sourceRunId: input.snapshot.identity.source.runId,
      sourceManifestSha256: input.snapshot.identity.source.manifestSha256, releaseId: input.snapshot.identity.approvedReleaseId },
    evidence: input.snapshot.events.map((event) => ({ phase: event.phase, code: event.code,
      evidenceSha256: event.evidenceSha256, recordedAt: event.recordedAt })), aggregates: input.aggregates, timingsMs: input.timingsMs };
  const bytes = canonicalJson(unsigned);
  if (bytes.byteLength > 512 * 1024 || forbidden.test(bytes.toString('utf8'))) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_REPORT_UNSAFE', 'Report contains forbidden secret/content fields or exceeds its bound.');
  }
  return { ...unsigned, reportSha256: digest(unsigned) };
}

export function buildControlledRecoveryPacket2Report(input: {
  snapshot: ControlledRecoveryJournalSnapshot; aggregates: Record<string, string>; timingsMs: Record<string, string>;
  generation?: string | null; unexecutedGates?: string[];
}): ControlledRecoveryReportV4 {
  const allowed = ['APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION', 'PROMOTED_PENDING_ACCEPTANCE', 'ACCEPTED', 'ROLLED_BACK'];
  if (!allowed.includes(input.snapshot.state)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_REPORT_NOT_READY', 'Packet 2 report requires a reconciled or later state.');
  for (const record of [input.aggregates, input.timingsMs]) {
    if (Object.entries(record).some(([key, value]) => forbidden.test(key) || !/^(0|[1-9][0-9]*)$/.test(value))) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_REPORT_UNSAFE', 'Report aggregates/timings contain unsafe names or values.');
    }
  }
  const unexecutedGates = input.unexecutedGates ?? ['DOCKER_E2E', 'PRODUCTION_SPLIT_TOPOLOGY', 'PRODUCTION_RTO'];
  if (unexecutedGates.some((value) => !/^[A-Z][A-Z0-9_]{0,63}$/.test(value))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_REPORT_UNSAFE', 'Unexecuted gate names are unsafe.');
  const unsigned = { format: 'darshan-controlled-recovery-report-v4' as const,
    operation: { operationId: input.snapshot.identity.operationId, siteId: input.snapshot.identity.siteId,
      state: input.snapshot.state, sourceRunId: input.snapshot.identity.source.runId,
      sourceManifestSha256: input.snapshot.identity.source.manifestSha256, releaseId: packet2ReportReleaseId(input.snapshot),
      generation: input.generation ?? null, writeFreezeRequired: true as const },
    evidence: input.snapshot.events.map((event) => ({ phase: event.phase, code: event.code,
      evidenceSha256: event.evidenceSha256, recordedAt: event.recordedAt })),
    aggregates: input.aggregates, timingsMs: input.timingsMs, unexecutedGates };
  const bytes = canonicalJson(unsigned);
  if (bytes.byteLength > 512 * 1024 || forbidden.test(bytes.toString('utf8'))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_REPORT_UNSAFE', 'Report is unsafe.');
  return { ...unsigned, reportSha256: digest(unsigned) };
}

