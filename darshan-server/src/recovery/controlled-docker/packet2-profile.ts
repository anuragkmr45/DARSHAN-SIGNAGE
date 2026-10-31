import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const privateAddress = z.string().regex(/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)[0-9.]+$/);

/** Separately installed/signed Packet 2 profile; Packet 1 v1 stays immutable. */
export const controlledRecoveryPacket2ProfileSchema = z.object({
  format: z.literal('darshan-controlled-docker-recovery-packet2-profile-v1'),
  profile_id: z.literal('darshan-release-02-controlled-recovery'),
  release_id: z.literal('release-02'),
  target_id: z.literal('darshan-server-release-02-controlled'),
  terminal_migration_id: z.literal('0056_recovery_runtime_authority.sql'),
  migration_manifest_sha256: z.literal('69b84a7d0bdebf17df6bec95f907791d586cc9558ec33fb18b79eb41b6e62a2b'),
  topology: z.object({
    kind: z.enum(['SINGLE_HOST_PRIVATE', 'SPLIT_HOST_PRIVATE_TLS']),
    data_host_private_address: privateAddress,
    backend_host_private_address: privateAddress,
    cms_host_private_address: privateAddress,
    data_tls_server_identity_sha256: digest,
    backend_tls_client_identity_sha256: digest,
    firewall_contract_sha256: digest,
  }).strict(),
  deployment: z.object({
    fixed_overlay_sha256: digest,
    api_image: z.string().regex(/@sha256:[a-f0-9]{64}$/),
    worker_image: z.string().regex(/@sha256:[a-f0-9]{64}$/),
    cms_image: z.string().regex(/@sha256:[a-f0-9]{64}$/),
    previous_pointer_root_sha256: digest,
  }).strict(),
}).strict();

export type ControlledRecoveryPacket2Profile = z.infer<typeof controlledRecoveryPacket2ProfileSchema>;

/** Separate current Packet C target; the historical release-02/0056 schema above remains immutable. */
export const currentControlledRecoveryPacket2ProfileSchema = z.object({
  format: z.literal('darshan-controlled-docker-recovery-packet2-profile-v2'),
  profile_id: z.literal('darshan-release-03-controlled-recovery-packet-c'),
  release_id: z.literal('release-03'),
  target_id: z.literal('darshan-server-release-03-controlled'),
  terminal_migration_id: z.literal('0057_controlled_recovery_report_projection.sql'),
  migration_manifest_sha256: z.literal('05561d3b1c8cac7fa57f6d47503835d23c2b88f7886203ab9c8207238762c438'),
  topology: controlledRecoveryPacket2ProfileSchema.shape.topology,
  deployment: controlledRecoveryPacket2ProfileSchema.shape.deployment.extend({
    packet_c_assets_sha256: digest,
    operation_store_sha256: digest,
    promotion_authority_sha256: digest,
    e2e_tiny_profile_sha256: digest,
  }).strict(),
}).strict();

export const approvedControlledRecoveryPacket2ProfileSchema = z.union([
  controlledRecoveryPacket2ProfileSchema,
  currentControlledRecoveryPacket2ProfileSchema,
]);
export type ApprovedControlledRecoveryPacket2Profile = z.infer<typeof approvedControlledRecoveryPacket2ProfileSchema>;
