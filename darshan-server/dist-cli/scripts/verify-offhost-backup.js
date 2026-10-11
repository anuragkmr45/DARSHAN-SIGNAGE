import 'dotenv/config';
import { program } from 'commander';
import { config as appConfig } from '../src/config/index.js';
import { createOffHostBackupPolicy, getOffHostBackupClient, readOffHostManifest, verifyOffHostBackupManifest, } from '../src/utils/off-host-backup.js';
program
    .name('darshan-verify-offhost-backup')
    .description('Verify the checksummed archive objects in an independently operated S3 backup repository')
    .requiredOption('--manifest-key <key>', 'Full object key of the backup manifest')
    .option('--json', 'Emit compact machine-readable JSON')
    .action(async (options) => {
    const policy = createOffHostBackupPolicy({
        destination: appConfig.BACKUP_OFFHOST_DESTINATION ?? '',
        endpoint: appConfig.BACKUP_OFFHOST_ENDPOINT ?? '',
        region: appConfig.BACKUP_OFFHOST_REGION ?? '',
        accessKeyId: appConfig.BACKUP_OFFHOST_ACCESS_KEY ?? '',
        secretAccessKey: appConfig.BACKUP_OFFHOST_SECRET_KEY ?? '',
        intervalHours: appConfig.BACKUP_INTERVAL_HOURS ?? 0,
        retentionDays: appConfig.BACKUP_RETENTION_DAYS ?? 0,
    });
    const client = getOffHostBackupClient(policy);
    const manifest = await readOffHostManifest(client, policy.location, options.manifestKey);
    if (manifest.off_host_uri !== policy.location.uri ||
        manifest.off_host_endpoint !== policy.endpoint ||
        manifest.backup_interval_hours !== policy.intervalHours ||
        manifest.retention_days !== policy.retentionDays) {
        throw new Error('Backup manifest does not match the currently signed off-host destination, endpoint, interval, and retention policy.');
    }
    await verifyOffHostBackupManifest(client, policy.location, manifest);
    const result = {
        verified: true,
        verified_at: new Date().toISOString(),
        run_id: manifest.run_id,
        off_host_uri: manifest.off_host_uri,
        manifest_key: manifest.manifest_key,
        files: manifest.files.length,
    };
    process.stdout.write(`${options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
});
await program.parseAsync(process.argv);
