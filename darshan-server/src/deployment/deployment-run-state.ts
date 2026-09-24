import type { PoolClient } from 'pg';
import { acquireSessionAdvisoryLock, releaseSessionAdvisoryLock } from './bounded-advisory-lock';

const TABLE = 'darshan_deployment_runs';
const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SITE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const STEP_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const TRANSITIONS: Record<DeploymentMode, Readonly<Record<string, string>>> = {
  INSTALL: {
    BEGIN: 'MIGRATIONS_APPLIED',
    MIGRATIONS_APPLIED: 'BOOTSTRAP_COMPLETE',
    BOOTSTRAP_COMPLETE: 'BACKEND_READY',
    BACKEND_READY: 'BACKEND_ACCEPTED',
    BACKEND_ACCEPTED: 'FULL_ACCEPTANCE_COMPLETE',
  },
  UPGRADE: {
    BEGIN: 'MAINTENANCE_STARTED',
    MAINTENANCE_STARTED: 'MIGRATIONS_APPLIED',
    MIGRATIONS_APPLIED: 'BACKEND_READY',
  },
  ADOPT: {
    BEGIN: 'DATABASE_ADOPTED',
    DATABASE_ADOPTED: 'MIGRATIONS_APPLIED',
    MIGRATIONS_APPLIED: 'BOOTSTRAP_ADOPTED',
    BOOTSTRAP_ADOPTED: 'BACKEND_READY',
  },
};

export function expectedDeploymentStep(mode: DeploymentMode, currentStep: string): string | null {
  return TRANSITIONS[mode]?.[currentStep] ?? null;
}

export type DeploymentMode = 'INSTALL' | 'UPGRADE' | 'ADOPT';
export type DeploymentRun = {
  release_id: string;
  site_name: string;
  role_manifest_sha256: string;
  mode: DeploymentMode;
  status: 'RUNNING' | 'COMPLETE' | 'FAILED';
  last_step: string;
  approval_ticket: string | null;
  started_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

export class DeploymentRunError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DeploymentRunError';
  }
}

function validateIdentity(input: { releaseId: string; siteName: string; manifestSha256: string }) {
  if (!RELEASE_PATTERN.test(input.releaseId)) throw new DeploymentRunError('DEPLOYMENT_RELEASE_INVALID', 'Invalid release identifier.');
  if (!SITE_PATTERN.test(input.siteName)) throw new DeploymentRunError('DEPLOYMENT_SITE_INVALID', 'Invalid site identifier.');
  if (!HASH_PATTERN.test(input.manifestSha256)) throw new DeploymentRunError('DEPLOYMENT_MANIFEST_INVALID', 'Invalid signed role-manifest fingerprint.');
}

function validateTicket(ticket?: string) {
  const normalized = ticket?.trim() || null;
  if (normalized && (normalized.length > 128 || /[\r\n\0]/.test(normalized))) {
    throw new DeploymentRunError('DEPLOYMENT_TICKET_INVALID', 'Approval ticket must be one line of at most 128 characters.');
  }
  return normalized;
}

export async function deploymentRunTableExists(client: PoolClient) {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass(format('%I.%I', current_schema(), $1::text)) IS NOT NULL AS exists`,
    [TABLE]
  );
  return result.rows[0]?.exists === true;
}

export async function ensureDeploymentRunTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${TABLE}" (
      "release_id" varchar(128) PRIMARY KEY NOT NULL,
      "site_name" varchar(128) NOT NULL,
      "role_manifest_sha256" varchar(64) NOT NULL,
      "mode" varchar(16) NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'RUNNING',
      "last_step" varchar(64) NOT NULL DEFAULT 'BEGIN',
      "approval_ticket" varchar(128),
      "started_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now(),
      "completed_at" timestamp,
      CONSTRAINT "darshan_deployment_runs_mode_check" CHECK ("mode" IN ('INSTALL', 'UPGRADE', 'ADOPT')),
      CONSTRAINT "darshan_deployment_runs_status_check" CHECK ("status" IN ('RUNNING', 'COMPLETE', 'FAILED'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "darshan_deployment_runs_one_running_idx"
      ON "${TABLE}" ((status)) WHERE "status" = 'RUNNING';
  `);
}

async function readRun(client: PoolClient, releaseId: string): Promise<DeploymentRun | null> {
  if (!await deploymentRunTableExists(client)) return null;
  const result = await client.query<DeploymentRun>(`SELECT * FROM "${TABLE}" WHERE release_id = $1`, [releaseId]);
  return result.rows[0] ?? null;
}

export async function inspectDeploymentRun(client: PoolClient, releaseId: string) {
  if (!RELEASE_PATTERN.test(releaseId)) throw new DeploymentRunError('DEPLOYMENT_RELEASE_INVALID', 'Invalid release identifier.');
  return readRun(client, releaseId);
}

export async function beginDeploymentRun(client: PoolClient, input: {
  releaseId: string; siteName: string; manifestSha256: string; mode: DeploymentMode; ticket?: string;
}) {
  validateIdentity(input);
  if (!['INSTALL', 'UPGRADE', 'ADOPT'].includes(input.mode)) {
    throw new DeploymentRunError('DEPLOYMENT_MODE_INVALID', 'Deployment mode must be INSTALL, UPGRADE, or ADOPT.');
  }
  const ticket = validateTicket(input.ticket);
  await acquireSessionAdvisoryLock(client, 'darshan:deployment-run-state');
  await client.query('BEGIN');
  try {
    await ensureDeploymentRunTable(client);
    const active = await client.query<DeploymentRun>(`SELECT * FROM "${TABLE}" WHERE status = 'RUNNING' FOR UPDATE`);
    const current = active.rows[0];
    if (current && (
      current.release_id !== input.releaseId || current.site_name !== input.siteName ||
      current.role_manifest_sha256 !== input.manifestSha256 || current.mode !== input.mode
    )) {
      throw new DeploymentRunError('DEPLOYMENT_RUN_CONFLICT', `A different deployment is still RUNNING: ${current.release_id}.`);
    }
    const existing = await readRun(client, input.releaseId);
    if (existing) {
      if (existing.site_name !== input.siteName || existing.role_manifest_sha256 !== input.manifestSha256 || existing.mode !== input.mode) {
        throw new DeploymentRunError('DEPLOYMENT_IDENTITY_MISMATCH', 'Existing release state does not match this signed artifact or deployment mode.');
      }
      if (existing.status === 'COMPLETE') throw new DeploymentRunError('DEPLOYMENT_ALREADY_COMPLETE', 'This release deployment is already complete.');
      await client.query('COMMIT');
      return existing;
    }
    const inserted = await client.query<DeploymentRun>(
      `INSERT INTO "${TABLE}" (release_id, site_name, role_manifest_sha256, mode, approval_ticket)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.releaseId, input.siteName, input.manifestSha256, input.mode, ticket]
    );
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await releaseSessionAdvisoryLock(client, 'darshan:deployment-run-state').catch(() => undefined);
  }
}

export async function markDeploymentStep(client: PoolClient, input: {
  releaseId: string; siteName: string; manifestSha256: string; step: string; complete?: boolean;
}) {
  validateIdentity(input);
  if (!STEP_PATTERN.test(input.step)) throw new DeploymentRunError('DEPLOYMENT_STEP_INVALID', 'Invalid deployment step.');
  await acquireSessionAdvisoryLock(client, 'darshan:deployment-run-state');
  await client.query('BEGIN');
  try {
    const currentResult = await client.query<DeploymentRun>(
      `SELECT * FROM "${TABLE}"
        WHERE release_id = $1 AND site_name = $2 AND role_manifest_sha256 = $3
        FOR UPDATE`,
      [input.releaseId, input.siteName, input.manifestSha256]
    );
    const current = currentResult.rows[0];
    if (!current || current.status !== 'RUNNING') {
      throw new DeploymentRunError('DEPLOYMENT_RUN_NOT_RUNNING', 'No matching RUNNING deployment exists.');
    }
    const expected = expectedDeploymentStep(current.mode, current.last_step);
    if (expected !== input.step) {
      throw new DeploymentRunError(
        'DEPLOYMENT_STEP_OUT_OF_ORDER',
        `Deployment step ${input.step} is not allowed after ${current.last_step}; expected ${expected ?? 'no further step'}.`
      );
    }
    const terminalStep = expectedDeploymentStep(current.mode, input.step) === null;
    if (Boolean(input.complete) !== terminalStep) {
      throw new DeploymentRunError(
        'DEPLOYMENT_COMPLETION_INVALID',
        terminalStep ? `${input.step} must complete the deployment.` : `${input.step} is not the terminal deployment step.`
      );
    }
    const status = input.complete ? 'COMPLETE' : 'RUNNING';
    const result = await client.query<DeploymentRun>(
      `UPDATE "${TABLE}"
          SET last_step = $4, status = $5, updated_at = now(), completed_at = CASE WHEN $5 = 'COMPLETE' THEN now() ELSE NULL END
        WHERE release_id = $1 AND site_name = $2 AND role_manifest_sha256 = $3 AND status = 'RUNNING'
        RETURNING *`,
      [input.releaseId, input.siteName, input.manifestSha256, input.step, status]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await releaseSessionAdvisoryLock(client, 'darshan:deployment-run-state').catch(() => undefined);
  }
}
