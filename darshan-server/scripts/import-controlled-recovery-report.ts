import { closeDatabase, getDatabase, initializeDatabase } from '@/db';
import { importControlledRecoveryProjection, verifyControlledRecoveryProjection } from '@/deployment/controlled-recovery-report';
import { loadRecoveryPublicKeyring, readProtectedOperatorFile } from '@/recovery/operator-inputs';

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing required ${name}.`);
  return value;
}

async function main() {
  const allowed = new Set(['--envelope', '--keyring', '--site-id']);
  for (let index = 2; index < process.argv.length; index += 2) {
    if (!allowed.has(process.argv[index]) || !process.argv[index + 1]) throw new Error('Unsupported recovery report import option.');
  }
  const envelopePath = option('--envelope');
  const keyringPath = option('--keyring');
  const siteId = option('--site-id');
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(siteId)) throw new Error('Invalid --site-id.');
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) throw new Error('Recovery report import requires a POSIX deployment identity.');
  const [bytes, keyring] = await Promise.all([
    readProtectedOperatorFile({ path: envelopePath, maximumBytes: 256 * 1024,
      expectedUid: uid, expectedGid: gid }),
    loadRecoveryPublicKeyring(keyringPath),
  ]);
  const verified = verifyControlledRecoveryProjection({ bytes, trustedKeys: keyring.keys, expectedSiteId: siteId });
  await initializeDatabase();
  const result = await getDatabase().transaction((executor) => importControlledRecoveryProjection({ executor, verified }));
  process.stdout.write(`${JSON.stringify({ format: 'darshan-controlled-recovery-projection-import-receipt-v1',
    operation_id: result.operation_id, status: result.status, envelope_sha256: verified.envelopeSha256 })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ code: (error as { code?: string }).code ?? 'RECOVERY_REPORT_IMPORT_FAILED',
    message: 'Recovery report import failed.' })}\n`);
  process.exitCode = 1;
}).finally(() => closeDatabase().catch(() => undefined));
