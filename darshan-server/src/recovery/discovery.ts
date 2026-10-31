import type {
  BrokerJournalState,
  BrokerPublicationRecord,
} from '../backups/backup-broker-journal';
import { assertBrokerJournalStateMapIdentities } from '../backups/backup-broker-journal';
import { recoveryDigest, recoveryUuid } from './contracts';
import { RecoveryError } from './errors';

export const RECOVERY_DISCOVERY_MAX_LIMIT = 100;

export interface RecoveryCandidate {
  candidateOnly: true;
  siteId: string;
  repositoryId: string;
  runId: string;
  attemptId: string;
  captureId: string;
  captureGeneration: number;
  signedManifestSha256: string;
  publicationStatus: 'COMMITTED';
  retentionState: 'AVAILABLE' | 'HELD' | 'HOLD_UNCERTAIN' | 'DELETION_CLAIMED' | 'TOMBSTONED' | 'JOURNAL_CONFLICT';
  activeHolds: number;
  uncertainHolds: number;
}

function samePublicationTuple(record: {
  site_id: string; repository_id: string; run_id: string; attempt_id: string; capture_id: string;
  capture_generation: number; manifest_sha256: string;
},
  publication: BrokerPublicationRecord): boolean {
  return record.site_id === publication.site_id && record.repository_id === publication.repository_id &&
    record.run_id === publication.run_id && record.attempt_id === publication.attempt_id &&
    record.capture_id === publication.capture_id && record.capture_generation === publication.capture_generation &&
    record.manifest_sha256 === publication.signed_manifest_sha256;
}

function candidate(state: BrokerJournalState, publication: BrokerPublicationRecord): RecoveryCandidate {
  const runHolds = Object.values(state.holds).filter((record) => record.run_id === publication.run_id);
  const runDeletions = Object.values(state.deletions).filter((record) => record.run_id === publication.run_id);
  const runTombstones = Object.values(state.tombstones).filter((record) => record.run_id === publication.run_id);
  const conflict = runHolds.some((record) => !samePublicationTuple(record, publication)) ||
    runDeletions.some((record) => !samePublicationTuple(record, publication)) ||
    runTombstones.some((record) => !samePublicationTuple(record, publication));
  const exactHolds = runHolds.filter((record) => samePublicationTuple(record, publication));
  const activeHolds = exactHolds.filter((record) => record.status === 'ACTIVE').length;
  const uncertainHolds = exactHolds.filter((record) => record.status === 'UNCERTAIN').length;
  const retentionState = conflict ? 'JOURNAL_CONFLICT' : runTombstones.length > 0 ? 'TOMBSTONED' :
    runDeletions.length > 0 ? 'DELETION_CLAIMED' : uncertainHolds > 0 ? 'HOLD_UNCERTAIN' :
    activeHolds > 0 ? 'HELD' : 'AVAILABLE';
  return {
    candidateOnly: true, siteId: publication.site_id, repositoryId: publication.repository_id,
    runId: publication.run_id, attemptId: publication.attempt_id, captureId: publication.capture_id,
    captureGeneration: publication.capture_generation, signedManifestSha256: publication.signed_manifest_sha256,
    publicationStatus: 'COMMITTED', retentionState, activeHolds, uncertainHolds,
  };
}

export function discoverRecoveryCandidates(input: {
  state: BrokerJournalState;
  siteId: string;
  repositoryId: string;
  limit?: number;
  afterRunId?: string;
}): { candidates: RecoveryCandidate[]; nextAfterRunId: string | null; journalRevision: number } {
  assertBrokerJournalStateMapIdentities(input.state);
  const limit = input.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RECOVERY_DISCOVERY_MAX_LIMIT) {
    throw new RecoveryError('RECOVERY_INPUT_INVALID', `Discovery limit must be between 1 and ${RECOVERY_DISCOVERY_MAX_LIMIT}.`);
  }
  const after = input.afterRunId === undefined ? undefined : recoveryUuid(input.afterRunId, 'afterRunId');
  const publications = Object.values(input.state.publications)
    .filter((record) => record.status === 'COMMITTED' && record.site_id === input.siteId &&
      record.repository_id === input.repositoryId && (after === undefined || record.run_id > after))
    .sort((left, right) => left.run_id.localeCompare(right.run_id));
  const selected = publications.slice(0, limit);
  return {
    candidates: selected.map((record) => candidate(input.state, record)),
    nextAfterRunId: publications.length > limit ? selected.at(-1)?.run_id ?? null : null,
    journalRevision: input.state.revision,
  };
}

export function findExactRecoveryPublication(input: {
  state: BrokerJournalState;
  siteId: string;
  repositoryId: string;
  runId: string;
  manifestSha256: string;
}): BrokerPublicationRecord {
  assertBrokerJournalStateMapIdentities(input.state);
  const runId = recoveryUuid(input.runId, 'runId');
  const digest = recoveryDigest(input.manifestSha256, 'manifestSha256');
  const matches = Object.values(input.state.publications).filter((record) => record.run_id === runId);
  if (matches.length !== 1 || matches[0].status !== 'COMMITTED') {
    throw new RecoveryError(matches.length > 1 ? 'RECOVERY_SOURCE_CHANGED' : 'RECOVERY_SOURCE_NOT_FOUND',
      matches.length > 1 ? 'Broker journal contains conflicting publication evidence.' : 'Exact committed recovery publication is absent.');
  }
  const publication = matches[0];
  if (publication.site_id !== input.siteId || publication.repository_id !== input.repositoryId ||
      publication.signed_manifest_sha256 !== digest) {
    throw new RecoveryError('RECOVERY_SOURCE_IDENTITY_MISMATCH', 'Exact recovery run does not match the requested site, repository, and manifest digest.');
  }
  const view = candidate(input.state, publication);
  if (view.retentionState === 'TOMBSTONED') throw new RecoveryError('RECOVERY_SOURCE_TOMBSTONED', 'Recovery source has durable tombstone evidence.');
  if (view.retentionState === 'DELETION_CLAIMED') throw new RecoveryError('RECOVERY_SOURCE_DELETION_CLAIMED', 'Recovery source has a durable deletion claim.');
  if (view.retentionState === 'JOURNAL_CONFLICT') throw new RecoveryError('RECOVERY_SOURCE_CHANGED', 'Recovery source lifecycle evidence conflicts with its publication tuple.');
  return publication;
}
