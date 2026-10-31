import { describe, expect, it } from 'vitest';

import { canonicalJson } from './backup-broker-protocol';
import {
  CAPSULE_INVENTORY_FORMAT,
  CAPSULE_ROLE_ALLOWLIST,
  EMBEDDED_MANIFEST_SIGNING_KEY,
  PRODUCTION_CAPSULE_CONTRACT_ID,
  validateProductionCapsuleInventory,
} from './configuration-capsule-inventory';

function inventory() {
  const entries = Object.entries(CAPSULE_ROLE_ALLOWLIST).flatMap(([role, specifications]) => specifications.map(
    ([path, sourceMode, restoreMode, maximumBytes]) => ({
      role,
      path,
      type: 'file' as const,
      source_mode: sourceMode,
      restore_owner: { uid: 0, gid: 0 },
      restore_mode: restoreMode,
      max_bytes: String(maximumBytes),
      sha256: 'a'.repeat(64),
    }),
  ));
  entries.push({
    role: EMBEDDED_MANIFEST_SIGNING_KEY.role,
    path: EMBEDDED_MANIFEST_SIGNING_KEY.path,
    type: 'file',
    source_mode: EMBEDDED_MANIFEST_SIGNING_KEY.sourceMode,
    restore_owner: { uid: 0, gid: 0 },
    restore_mode: EMBEDDED_MANIFEST_SIGNING_KEY.restoreMode,
    max_bytes: String(EMBEDDED_MANIFEST_SIGNING_KEY.maximumBytes),
    sha256: 'b'.repeat(64),
  });
  return { format: CAPSULE_INVENTORY_FORMAT, contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, entries };
}

describe('production configuration capsule inventory', () => {
  it('accepts the canonical JSON key order used inside the encrypted capsule', () => {
    const parsed = JSON.parse(canonicalJson(inventory()).toString('utf8'));
    expect(validateProductionCapsuleInventory(parsed).entries).toHaveLength(inventory().entries.length);
  });

  it('rejects restore owners with missing or unexpected properties', () => {
    const missing = inventory();
    (missing.entries[0] as unknown as { restore_owner: unknown }).restore_owner = { uid: 0 };
    expect(() => validateProductionCapsuleInventory(missing)).toThrow(/violates the production contract/);

    const unexpected = inventory();
    (unexpected.entries[0] as unknown as { restore_owner: unknown }).restore_owner = { uid: 0, gid: 0, name: 'root' };
    expect(() => validateProductionCapsuleInventory(unexpected)).toThrow(/violates the production contract/);
  });
});
