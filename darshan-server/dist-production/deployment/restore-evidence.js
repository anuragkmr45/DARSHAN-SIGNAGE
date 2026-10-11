import { createVerify } from 'node:crypto';
export function verifyRestoreEvidence(document, publicKey, expected, now = Date.now()) {
    const { attestation_signature: signature, attestation_algorithm: algorithm, ...evidence } = document;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(JSON.stringify(evidence));
    verifier.end();
    if (algorithm !== 'RSA-SHA256' || typeof signature !== 'string' ||
        !verifier.verify(publicKey, signature, 'base64')) {
        throw new Error('Restore evidence attestation signature is invalid.');
    }
    if (!Number.isSafeInteger(expected.intervalHours) || expected.intervalHours < 1) {
        throw new Error('Restore evidence interval policy is invalid.');
    }
    if (!Number.isSafeInteger(expected.retentionDays) || expected.retentionDays < 1) {
        throw new Error('Restore evidence retention policy is invalid.');
    }
    const destination = new URL(expected.destination);
    const prefix = `${destination.pathname.split('/').filter(Boolean).map(decodeURIComponent).join('/')}/runs/`;
    const verifiedAt = Date.parse(evidence.verified_at);
    const maxAgeMs = Math.max(24, expected.intervalHours) * 60 * 60 * 1000;
    if (evidence.evidence_version !== 2 || evidence.restore_verified !== true || evidence.site_name !== expected.site ||
        typeof evidence.target_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(evidence.target_id) ||
        evidence.off_host_uri !== expected.destination || evidence.off_host_endpoint !== expected.endpoint ||
        Number(evidence.backup_interval_hours) !== expected.intervalHours ||
        Number(evidence.retention_days) !== expected.retentionDays || typeof evidence.manifest_key !== 'string' ||
        !evidence.manifest_key.startsWith(prefix) || !evidence.manifest_key.endsWith('/manifest.json') ||
        !/^[a-f0-9]{64}$/.test(evidence.manifest_sha256 ?? '') ||
        typeof evidence.restored_from_run_id !== 'string' || evidence.restored_from_run_id.trim().length === 0 ||
        !Number.isSafeInteger(evidence.object_restore?.object_count) || evidence.object_restore.object_count < 0 ||
        !Number.isSafeInteger(evidence.object_restore?.total_bytes) || evidence.object_restore.total_bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(evidence.object_restore?.inventory_sha256 ?? '') ||
        Number(evidence.application_checks?.unfinished_backups) !== 0 ||
        Number(evidence.application_checks?.unfinished_uploads) !== 0 ||
        !Number.isFinite(verifiedAt) || verifiedAt > now + 5 * 60 * 1000 || now - verifiedAt > maxAgeMs) {
        throw new Error('Restore evidence does not satisfy the signed site backup policy.');
    }
    return { status: 'valid', runId: evidence.restored_from_run_id, targetId: evidence.target_id };
}
