import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { manifestFingerprint, loadMigrationManifest, type MigrationManifestEntry } from '../../src/deployment/migration-manifest';
import type { D3AgeReceipt } from './controlled-recovery-d3-age-identity';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import type { ProtectedD3Capsule } from './controlled-recovery-d3-capsule';
import type { DurableD3SourceData } from './controlled-recovery-d3-source-data';
import { D3_MIGRATIONS_PATH } from './controlled-recovery-d3-source-data-profile';
import { d3SourceSealSchema, type D3SourceSeal } from './controlled-recovery-d3-source-seal';
import type { D3SourceLayoutBoundary } from './controlled-recovery-d3-source-services';
import type { DurableD3SourceState } from './controlled-recovery-d3-source-state';
import { d3ReservationAuthoritySchema, type D3ReservationAuthority } from './controlled-recovery-d3-reservation-contract';
import { D3_CONTROL_DDL_SHA256 } from './controlled-recovery-d3-reservation-control';
import { d3ReservationProfileSchema, type D3ReservationProfile } from './controlled-recovery-d3-reservation-profile';

const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RESERVATION_PREREQUISITES_MISSING', 'Reservation requires reverified retained seed, seal, source, public key and signed capsule receipts.');
export interface D3ReservationInputs { authority: D3ReservationAuthority; seal: D3SourceSeal; manifest: MigrationManifestEntry[]; resources: unknown[]; }
export interface D3ReservationPrerequisiteReader { read(signal?: AbortSignal): Promise<D3ReservationInputs>; }
export interface D3ReservationPrerequisiteDependencies { authority: D3OperationAuthority; profile: D3ReservationProfile; profileSha256: string;
  state: DurableD3SourceState; data: DurableD3SourceData; layout: Pick<D3SourceLayoutBoundary, 'verify'>; capsule: Pick<ProtectedD3Capsule, 'status'>; publicAgeReceipt(): Promise<D3AgeReceipt>; assertOwnedOperation?(): Promise<void>; }

/** Reuses the capsule's complete read-only signature/inventory/data verification; never prepares anything. */
export class ProtectedD3ReservationPrerequisites implements D3ReservationPrerequisiteReader {
  constructor(private readonly d: D3ReservationPrerequisiteDependencies) {}
  async read(signal?: AbortSignal): Promise<D3ReservationInputs> {
    const d = this.d, p = d3ReservationProfileSchema.parse(d.profile);
    if (signal?.aborted || digest(p) !== d.profileSha256 || d.state.profileSha256 !== p.source_profile_sha256 || d.data.sourceProfileSha256 !== p.source_profile_sha256 || d.data.dataProfileSha256 !== p.data_profile_sha256 || digest(d.state.authority) !== digest(d.authority) || digest(d.data.authority) !== digest(d.authority)) throw failed();
    const state = d.state.readOnlyView(), stages = await state.stages(), resources = await state.resources();
    if (stages.length < 4 || stages.length > 5 || stages[3]?.stage !== 'SEEDED_AND_SEALED' || stages.length === 5 && stages[4]?.stage !== 'CAPSULE_READY' || resources.pendingRoles.length || await state.stopReceipt() || digest(stages[3].resources) !== digest(resources.resources)) throw failed();
    if (await state.commandInProgress()) { if (!d.assertOwnedOperation) throw failed(); await d.assertOwnedOperation(); }
    const data = d.data.readOnlyView(), intent = await data.read('intent'), schema = await data.read('schema'), retained = await data.read('seal');
    if (!intent || !schema || !retained || stages[2]?.evidenceSha256 !== schema.receiptSha256 || stages[3].evidenceSha256 !== retained.receiptSha256 || retained.payload.intentSha256 !== intent.receiptSha256 || intent.payload.manifestSha256 !== schema.payload.manifestSha256 || schema.payload.terminal !== '0057_controlled_recovery_report_projection.sql') throw failed();
    const seal = d3SourceSealSchema.parse(retained.payload.seal), layout = await d.layout.verify(), age = await d.publicAgeReceipt(), capsule = await d.capsule.status(signal);
    if (seal.sealSha256 !== digest({ physicalIdentitySha256: seal.physicalIdentitySha256, businessContentSha256: seal.businessContentSha256, migrationFingerprint: seal.migrationFingerprint, configurationSha256: seal.configurationSha256 }) || seal.businessContentSha256 !== digest({ tables: seal.tables, objectInventory: seal.objectInventory, configurationSha256: seal.configurationSha256, migrationFingerprint: seal.migrationFingerprint, schemaCatalogSha256: seal.schemaCatalogSha256 }) || schema.payload.migrationFingerprint !== seal.migrationFingerprint || intent.payload.layoutSha256 !== digest(layout) || intent.payload.resourcesSha256 !== digest(resources.resources)) throw failed();
    const expected = { operationId: d.authority.operationId, siteId: d.authority.siteId, repositoryId: d.authority.repositoryId, sourceProfileSha256: p.source_profile_sha256, dataProfileSha256: p.data_profile_sha256, capsuleProfileSha256: p.capsule_profile_sha256, sourceIntentSha256: intent.receiptSha256, schemaReceiptSha256: schema.receiptSha256, sourceSealSha256: retained.receiptSha256, layoutSha256: digest(layout), resourcesSha256: digest(resources.resources), ageReceiptSha256: age.receiptSha256 };
    if (Object.entries(expected).some(([key, value]) => capsule[key as keyof typeof capsule] !== value) || stages[4] && stages[4].evidenceSha256 !== capsule.receiptSha256 || age.operationId !== d.authority.operationId || age.siteId !== d.authority.siteId || age.repositoryId !== d.authority.repositoryId || age.keyPath !== d.authority.keyPath || age.keyId !== digest(age.recipient)) throw failed();
    const manifest = await loadMigrationManifest(D3_MIGRATIONS_PATH);
    if (manifestFingerprint(manifest) !== schema.payload.manifestSha256) throw failed();
    const authority = d3ReservationAuthoritySchema.parse({ format: 'darshan-d3-backup-reservation-authority-v1', ...expected, sourceSealReceiptSha256: retained.receiptSha256, sourceSealSha256: seal.sealSha256, reservationProfileSha256: d.profileSha256,
      sqlSeedReceiptSha256: retained.payload.sqlReceiptSha256, physicalIdentitySha256: seal.physicalIdentitySha256, businessContentSha256: seal.businessContentSha256, migrationFingerprint: seal.migrationFingerprint, configurationSha256: seal.configurationSha256,
      keyId: age.keyId, recipientSha256: digest(age.recipient), capsuleReceiptSha256: capsule.receiptSha256, capsuleSha256: capsule.ciphertextSha256, capsulePolicySha256: capsule.policySha256, capsuleInventorySha256: capsule.inventorySha256, controlDdlSha256: D3_CONTROL_DDL_SHA256 });
    if (signal?.aborted || digest(await d.layout.verify()) !== digest(layout)) throw failed();
    return { authority, seal, manifest, resources: resources.resources };
  }
}
