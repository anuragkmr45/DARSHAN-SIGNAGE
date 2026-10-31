import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const tlsEnabled = process.env.DATABASE_TLS_ENABLED === 'true';
  const caPath = process.env.DATABASE_CA_CERT_PATH;
  if (tlsEnabled && !caPath) throw new Error('DATABASE_CA_CERT_PATH is required for TLS');
  const pool = new Pool({
    connectionString,
    ...(tlsEnabled ? { ssl: { ca: readFileSync(caPath!), rejectUnauthorized: true } } : {}),
  });
  try {
    const result = await pool.query<{
      configurations: string; active_configurations: string; stored_secrets: string;
    }>(`SELECT count(*)::text AS configurations,
        count(*) FILTER (WHERE is_active)::text AS active_configurations,
        count(*) FILTER (WHERE length(client_secret) > 0)::text AS stored_secrets
      FROM sso_configs`);
    const counts = result.rows[0];
    const safe = Number(counts.active_configurations) === 0 && Number(counts.stored_secrets) === 0;
    process.stdout.write(`${JSON.stringify({
      status: safe ? 'pass' : 'blocked',
      configurations: Number(counts.configurations),
      active_configurations: Number(counts.active_configurations),
      stored_secrets: Number(counts.stored_secrets),
    })}\n`);
    if (!safe) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : 'Preflight failed' })}\n`);
  process.exitCode = 1;
});
