import { z } from 'zod';
import { digest, ControlledRecoveryError } from '../../src/recovery/controlled-docker/contracts';
import { D3_OPERATION_ID, D3_REPOSITORY_ID, D3_SITE_ID } from './controlled-recovery-d3-authority';
export const D3_RESERVATION_CONTROL_SCHEMA = 'darshan_d3_control';
export const D3_RESERVATION_CONTROL_TABLE = 'operation_backup_bindings';
export const D3_RESERVATION_SOURCE_PROFILE = '1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632';
export const D3_RESERVATION_DATA_PROFILE = '33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b';
export const D3_RESERVATION_CAPSULE_PROFILE = '5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7';
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const d3ReservationAuthoritySchema = z.object({ format: z.literal('darshan-d3-backup-reservation-authority-v1'), operationId: z.literal(D3_OPERATION_ID), siteId: z.literal(D3_SITE_ID), repositoryId: z.literal(D3_REPOSITORY_ID),
  sourceProfileSha256: z.literal(D3_RESERVATION_SOURCE_PROFILE), dataProfileSha256: z.literal(D3_RESERVATION_DATA_PROFILE), capsuleProfileSha256: z.literal(D3_RESERVATION_CAPSULE_PROFILE), reservationProfileSha256: sha,
  sourceIntentSha256: sha, schemaReceiptSha256: sha, sourceSealReceiptSha256: sha, sqlSeedReceiptSha256: sha, sourceSealSha256: sha, physicalIdentitySha256: sha, businessContentSha256: sha, migrationFingerprint: sha, configurationSha256: sha,
  layoutSha256: sha, resourcesSha256: sha, keyId: sha, recipientSha256: sha, ageReceiptSha256: sha, capsuleReceiptSha256: sha, capsuleSha256: sha, capsulePolicySha256: sha, capsuleInventorySha256: sha, controlDdlSha256: sha }).strict();
export type D3ReservationAuthority = z.infer<typeof d3ReservationAuthoritySchema>;
export const d3ReservationBindingSchema = d3ReservationAuthoritySchema.extend({ runId: z.string().uuid(), bindingSha256: sha }).strict();
export type D3ReservationBinding = z.infer<typeof d3ReservationBindingSchema>;
export function validateD3ReservationBinding(value: unknown): D3ReservationBinding { try { const binding = d3ReservationBindingSchema.parse(value); const { bindingSha256, ...unsigned } = binding; if (digest(unsigned) !== bindingSha256) throw new Error('digest'); return binding; } catch { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RESERVATION_BINDING_CHANGED', 'The immutable operation backup binding differs.'); } }
