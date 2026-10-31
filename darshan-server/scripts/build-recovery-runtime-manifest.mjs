import path from 'node:path';
import { writeRecoveryRuntimeManifest } from './recovery-runtime-manifest-lib.mjs';

const root = path.resolve(process.argv[2] ?? process.cwd());
const output = await writeRecoveryRuntimeManifest(root);
process.stdout.write(`${path.relative(root, output)}\n`);
