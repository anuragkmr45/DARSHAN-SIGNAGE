import { lstatSync, readFileSync } from 'node:fs';
import { program } from 'commander';
import { verifyRestoreEvidence } from '../src/deployment/restore-evidence.js';

program
  .requiredOption('--evidence <path>')
  .requiredOption('--public-key <path>')
  .requiredOption('--destination <uri>')
  .requiredOption('--endpoint <url>')
  .requiredOption('--interval-hours <hours>')
  .requiredOption('--retention-days <days>')
  .requiredOption('--site <site>')
  .action((options) => {
    for (const [filePath, label] of [[options.evidence, 'evidence'], [options.publicKey, 'recovery public key']]) {
      const details = lstatSync(filePath);
      if (!details.isFile() || details.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
    }
    const result = verifyRestoreEvidence(
      JSON.parse(readFileSync(options.evidence, 'utf8')) as Record<string, any>,
      readFileSync(options.publicKey),
      {
        destination: options.destination,
        endpoint: options.endpoint,
        intervalHours: Number(options.intervalHours),
        retentionDays: Number(options.retentionDays),
        site: options.site,
      }
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  });

await program.parseAsync(process.argv);
