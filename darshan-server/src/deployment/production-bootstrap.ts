import { eq, sql } from 'drizzle-orm';
import { hashPassword, validatePasswordStrength } from '@/auth/password';
import { schema, type Database } from '@/db';
import { SYSTEM_ROLE_DEFAULTS, SYSTEM_ROLE_NAMES, type SystemRoleName } from '@/rbac/system-roles';
import { acquireTransactionAdvisoryLock, type BoundedAdvisoryLockOptions } from './bounded-advisory-lock';

const BOOTSTRAP_ID = 'production';
const DEFAULT_BOOTSTRAP_VERSION = '1';
const LOCK_TIMEOUT = '30s';
const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type ProductionBootstrapStatus = 'created' | 'already_initialized' | 'conflict';

export type ProductionBootstrapResult = {
  status: ProductionBootstrapStatus;
  code:
    | 'PRODUCTION_BOOTSTRAP_CREATED'
    | 'PRODUCTION_BOOTSTRAP_ADOPTED'
    | 'PRODUCTION_BOOTSTRAP_ALREADY_INITIALIZED'
    | 'PRODUCTION_BOOTSTRAP_CONFLICT';
  adminEmail?: string;
  reason?: string;
};

export type ProductionBootstrapInput = {
  email?: string;
  password?: string;
  releaseId?: string;
  bootstrapVersion?: string;
  lockOptions?: BoundedAdvisoryLockOptions;
};

export type ProductionBootstrapAdoptionInput = {
  email?: string;
  releaseId?: string;
  bootstrapVersion?: string;
  ticket?: string;
  lockOptions?: BoundedAdvisoryLockOptions;
};

export class ProductionBootstrapError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ProductionBootstrapError';
  }
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function requireBootstrapCredentials(email: string | undefined, password: string | undefined): { email: string; password: string } {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ProductionBootstrapError('BOOTSTRAP_EMAIL_REQUIRED', 'A valid initial administrator email is required.');
  }
  if (!password) {
    throw new ProductionBootstrapError('BOOTSTRAP_PASSWORD_REQUIRED', 'A protected password file is required for a fresh installation.');
  }
  validatePasswordStrength(password);
  return { email, password };
}

function requireBootstrapEmail(email: string | undefined): string {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ProductionBootstrapError('BOOTSTRAP_EMAIL_REQUIRED', 'A valid administrator email is required.');
  }
  return email;
}

function requireReleaseId(value: string | undefined): string {
  const releaseId = value?.trim();
  if (!releaseId || !RELEASE_PATTERN.test(releaseId)) {
    throw new ProductionBootstrapError(
      'BOOTSTRAP_RELEASE_REQUIRED',
      'A release identifier of up to 128 letters, numbers, dots, underscores, or hyphens is required.'
    );
  }
  return releaseId;
}

async function ensureEmptyApplicationState(tx: Database): Promise<string | null> {
  // A Drizzle transaction is backed by one PostgreSQL client. Run these probes
  // sequentially so bootstrap cannot issue concurrent queries on that client.
  const users = await tx.select({ count: sql<number>`count(*)` }).from(schema.users);
  const roles = await tx.select({ count: sql<number>`count(*)` }).from(schema.roles);
  const departments = await tx.select({ count: sql<number>`count(*)` }).from(schema.departments);
  const screens = await tx.select({ count: sql<number>`count(*)` }).from(schema.screens);
  const emergencies = await tx.select({ count: sql<number>`count(*)` }).from(schema.emergencyStatus);

  const populated = [
    ['users', users[0]?.count],
    ['roles', roles[0]?.count],
    ['departments', departments[0]?.count],
    ['screens', screens[0]?.count],
    ['emergency status records', emergencies[0]?.count],
  ].find(([, count]) => Number(count ?? 0) > 0);

  return populated ? `${populated[0]} already exist` : null;
}

async function readBootstrapState(tx: Database) {
  const [state] = await tx
    .select({
      adminEmail: schema.users.email,
      isActive: schema.users.is_active,
      roleName: schema.roles.name,
    })
    .from(schema.productionBootstrapStates)
    .leftJoin(schema.users, eq(schema.productionBootstrapStates.admin_user_id, schema.users.id))
    .leftJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
    .where(eq(schema.productionBootstrapStates.id, BOOTSTRAP_ID));

  return state ?? null;
}

async function reconcileSystemRoles(tx: Database): Promise<Map<SystemRoleName, string>> {
  const ids = new Map<SystemRoleName, string>();
  for (const name of SYSTEM_ROLE_NAMES) {
    const [role] = await tx
      .insert(schema.roles)
      .values({
        name,
        description: `${name} role`,
        is_system: true,
        permissions: SYSTEM_ROLE_DEFAULTS[name],
      })
      .onConflictDoUpdate({
        target: schema.roles.name,
        set: {
          description: `${name} role`,
          is_system: true,
          permissions: SYSTEM_ROLE_DEFAULTS[name],
          updated_at: new Date(),
        },
      })
      .returning({ id: schema.roles.id });
    ids.set(name, role.id);
  }
  return ids;
}

/**
 * Initialize an empty, already-migrated production database. It is deliberately
 * unable to adopt arbitrary existing data: that operation needs its own
 * reviewed reconciliation path.
 */
export async function bootstrapProductionDatabase(
  db: Database,
  input: ProductionBootstrapInput
): Promise<ProductionBootstrapResult> {
  const email = normalizeEmail(input.email);

  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`));
    await acquireTransactionAdvisoryLock(tx as Database, 'darshan:production-bootstrap', input.lockOptions);

    const existingState = await readBootstrapState(tx as Database);
    if (existingState) {
      if (existingState.adminEmail && existingState.isActive && existingState.roleName === 'SUPER_ADMIN') {
        return {
          status: 'already_initialized',
          code: 'PRODUCTION_BOOTSTRAP_ALREADY_INITIALIZED',
          adminEmail: existingState.adminEmail,
        };
      }
      return {
        status: 'conflict',
        code: 'PRODUCTION_BOOTSTRAP_CONFLICT',
        reason: 'Recorded bootstrap administrator is missing, inactive, or not a SUPER_ADMIN.',
      };
    }

    const existingData = await ensureEmptyApplicationState(tx as Database);
    if (existingData) {
      return {
        status: 'conflict',
        code: 'PRODUCTION_BOOTSTRAP_CONFLICT',
        reason: `Database is not empty (${existingData}); run the explicit adoption workflow instead.`,
      };
    }

    const releaseId = requireReleaseId(input.releaseId);
    const credentials = requireBootstrapCredentials(email, input.password);
    const passwordHash = await hashPassword(credentials.password);
    const roleIds = await reconcileSystemRoles(tx as Database);
    const [admin] = await tx
      .insert(schema.users)
      .values({
        email: credentials.email,
        password_hash: passwordHash,
        first_name: 'Administrator',
        last_name: 'Account',
        role_id: roleIds.get('SUPER_ADMIN')!,
        is_active: true,
      })
      .returning({ id: schema.users.id });

    await tx.insert(schema.emergencyStatus).values({ is_active: false });
    await tx.insert(schema.productionBootstrapStates).values({
      id: BOOTSTRAP_ID,
      bootstrap_version: input.bootstrapVersion ?? DEFAULT_BOOTSTRAP_VERSION,
      admin_user_id: admin.id,
      release_id: releaseId,
    });
    await tx.insert(schema.auditLogs).values({
      user_id: admin.id,
      action: 'PRODUCTION_BOOTSTRAP_CREATED',
      entity_type: 'USER',
      entity_id: admin.id,
    });
    await tx.insert(schema.systemLogs).values({
      level: 'info',
      message: 'Production bootstrap completed',
      context: {
        bootstrap_version: input.bootstrapVersion ?? DEFAULT_BOOTSTRAP_VERSION,
        release_id: releaseId,
        admin_user_id: admin.id,
      },
    });

    return {
      status: 'created',
      code: 'PRODUCTION_BOOTSTRAP_CREATED',
      adminEmail: credentials.email,
    };
  });
}

/**
 * A legacy database already has an administrator and must never be passed to
 * the fresh-install bootstrap.  This explicit adoption records the existing,
 * verified active SUPER_ADMIN as the bootstrap authority without modifying a
 * password, roles, sessions, or application data.
 */
export async function adoptProductionBootstrapState(
  db: Database,
  input: ProductionBootstrapAdoptionInput
): Promise<ProductionBootstrapResult> {
  const email = requireBootstrapEmail(normalizeEmail(input.email));

  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`));
    await acquireTransactionAdvisoryLock(tx as Database, 'darshan:production-bootstrap', input.lockOptions);

    const existingState = await readBootstrapState(tx as Database);
    if (existingState) {
      if (existingState.adminEmail && existingState.isActive && existingState.roleName === 'SUPER_ADMIN') {
        return {
          status: 'already_initialized',
          code: 'PRODUCTION_BOOTSTRAP_ALREADY_INITIALIZED',
          adminEmail: existingState.adminEmail,
        };
      }
      return {
        status: 'conflict',
        code: 'PRODUCTION_BOOTSTRAP_CONFLICT',
        reason: 'Recorded bootstrap administrator is missing, inactive, or not a SUPER_ADMIN.',
      };
    }

    const releaseId = requireReleaseId(input.releaseId);
    const candidates = await tx
      .select({
        id: schema.users.id,
        email: schema.users.email,
        isActive: schema.users.is_active,
        roleName: schema.roles.name,
      })
      .from(schema.users)
      .leftJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
      .where(sql`lower(btrim(${schema.users.email})) = ${email}`);

    if (candidates.length !== 1) {
      return {
        status: 'conflict',
        code: 'PRODUCTION_BOOTSTRAP_CONFLICT',
        reason: 'The requested adoption administrator is missing or ambiguous after email normalization.',
      };
    }
    const administrator = candidates[0];
    if (!administrator.isActive || administrator.roleName !== 'SUPER_ADMIN') {
      return {
        status: 'conflict',
        code: 'PRODUCTION_BOOTSTRAP_CONFLICT',
        reason: 'The requested adoption administrator must be active and hold the SUPER_ADMIN role.',
      };
    }

    await tx.insert(schema.productionBootstrapStates).values({
      id: BOOTSTRAP_ID,
      bootstrap_version: input.bootstrapVersion ?? 'adopted-v1',
      admin_user_id: administrator.id,
      release_id: releaseId,
    });
    await tx.insert(schema.auditLogs).values({
      user_id: administrator.id,
      action: 'PRODUCTION_BOOTSTRAP_ADOPTED',
      entity_type: 'USER',
      entity_id: administrator.id,
    });
    await tx.insert(schema.systemLogs).values({
      level: 'info',
      message: 'Production bootstrap state adopted',
      context: {
        bootstrap_version: input.bootstrapVersion ?? 'adopted-v1',
        release_id: releaseId,
        admin_user_id: administrator.id,
        ticket: input.ticket ?? null,
      },
    });

    return {
      status: 'created',
      code: 'PRODUCTION_BOOTSTRAP_ADOPTED',
      adminEmail: administrator.email,
    };
  });
}

export async function inspectProductionBootstrap(db: Database): Promise<ProductionBootstrapResult> {
  const state = await readBootstrapState(db);
  if (!state) {
    return {
      status: 'conflict',
      code: 'PRODUCTION_BOOTSTRAP_CONFLICT',
      reason: 'No production bootstrap state exists.',
    };
  }
  if (!state.adminEmail || !state.isActive || state.roleName !== 'SUPER_ADMIN') {
    return {
      status: 'conflict',
      code: 'PRODUCTION_BOOTSTRAP_CONFLICT',
      reason: 'Recorded bootstrap administrator is missing, inactive, or not a SUPER_ADMIN.',
    };
  }
  return {
    status: 'already_initialized',
    code: 'PRODUCTION_BOOTSTRAP_ALREADY_INITIALIZED',
    adminEmail: state.adminEmail,
  };
}
