import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRecoveryRuntimeManifest } from './recovery-runtime-manifest-lib.mjs';

export async function verifyManifest(root = process.cwd()) {
  return verifyRecoveryRuntimeManifest(path.resolve(root));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await verifyManifest(process.argv[2]);
  process.stdout.write('recovery-runtime-manifest-ok\n');
}
