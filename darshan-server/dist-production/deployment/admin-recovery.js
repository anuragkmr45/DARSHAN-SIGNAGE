import { eq, lt, sql } from 'drizzle-orm';
import { hashPassword, validatePasswordStrength } from '../auth/password.js';
import { schema } from '../db/index.js';
import { acquireTransactionAdvisoryLock } from './bounded-advisory-lock.js';
function normalizeEmail(value) {
    return value.trim().toLowerCase();
}
function requireEmail(value) {
    const email = normalizeEmail(value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('A valid administrator email is required.');
    }
    return email;
}
function requireTicket(value) {
    const ticket = value.trim();
    if (!ticket)
        throw new Error('A change ticket is required for administrator maintenance.');
    if (ticket.length > 128 || /[\r\n\0]/.test(ticket)) {
        throw new Error('The change ticket must be a single line of at most 128 characters.');
    }
    return ticket;
}
function nullableName(value, label) {
    const normalized = value?.trim();
    if (!normalized)
        return null;
    if (normalized.length > 100)
        throw new Error(`${label} must be at most 100 characters.`);
    return normalized;
}
async function findAccountsByEmail(db, email) {
    return db
        .select({
        id: schema.users.id,
        email: schema.users.email,
        isActive: schema.users.is_active,
        roleName: schema.roles.name,
    })
        .from(schema.users)
        .leftJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
        .where(sql `lower(${schema.users.email}) = ${email}`);
}
export async function inspectAdministrator(db, email) {
    const normalized = normalizeEmail(email);
    if (!normalized)
        return [];
    return findAccountsByEmail(db, normalized);
}
/**
 * Create an administrator with an existing, named RBAC role. This deliberately
 * does not manufacture roles: a missing role means the deployment has not been
 * initialized or adopted correctly and must be repaired first.
 */
export async function createAdministrator(db, input) {
    const email = requireEmail(input.email);
    const ticket = requireTicket(input.ticket);
    const roleName = input.roleName?.trim() || 'ADMIN';
    if (roleName.length > 100)
        throw new Error('Role name must be at most 100 characters.');
    const firstName = nullableName(input.firstName, 'First name');
    const lastName = nullableName(input.lastName, 'Last name');
    validatePasswordStrength(input.password);
    const passwordHash = await hashPassword(input.password);
    return db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL lock_timeout = '30s'"));
        await acquireTransactionAdvisoryLock(tx, 'darshan:administrator-maintenance', input.lockOptions);
        const existing = await findAccountsByEmail(tx, email);
        if (existing.length > 0) {
            return { status: 'conflict', reason: 'An account already exists with this normalized email address.' };
        }
        const [role] = await tx
            .select({ id: schema.roles.id, name: schema.roles.name })
            .from(schema.roles)
            .where(eq(schema.roles.name, roleName));
        if (!role) {
            return { status: 'conflict', reason: `The ${roleName} role does not exist; complete bootstrap or adoption first.` };
        }
        const [account] = await tx
            .insert(schema.users)
            .values({
            email,
            password_hash: passwordHash,
            first_name: firstName,
            last_name: lastName,
            role_id: role.id,
            is_active: true,
        })
            .returning({ id: schema.users.id, email: schema.users.email, isActive: schema.users.is_active });
        await tx.insert(schema.auditLogs).values({
            user_id: account.id,
            action: 'ADMIN_ACCOUNT_CREATED',
            entity_type: 'USER',
            entity_id: account.id,
        });
        await tx.insert(schema.systemLogs).values({
            level: 'info',
            message: 'Administrator account created',
            context: { ticket, target_user_id: account.id, role: role.name },
        });
        return { status: 'created', account: { ...account, roleName: role.name } };
    });
}
/**
 * Password recovery is intentionally explicit. It never activates an account
 * or changes its role unless the caller requests those separate actions.
 */
export async function recoverAdministrator(db, input) {
    const email = requireEmail(input.email);
    const ticket = requireTicket(input.ticket);
    validatePasswordStrength(input.password);
    const passwordHash = await hashPassword(input.password);
    return db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL lock_timeout = '30s'"));
        await acquireTransactionAdvisoryLock(tx, 'darshan:administrator-recovery', input.lockOptions);
        const accounts = await findAccountsByEmail(tx, email);
        if (accounts.length === 0)
            return { status: 'not_found' };
        if (accounts.length > 1) {
            return {
                status: 'conflict',
                reason: 'Multiple accounts share this email when normalized; resolve the duplicate accounts before recovery.',
            };
        }
        const account = accounts[0];
        let roleId;
        let roleName = account.roleName;
        if (input.grantSuperAdmin) {
            const [superAdmin] = await tx
                .select({ id: schema.roles.id, name: schema.roles.name })
                .from(schema.roles)
                .where(eq(schema.roles.name, 'SUPER_ADMIN'));
            if (!superAdmin) {
                return { status: 'conflict', reason: 'SUPER_ADMIN role does not exist; complete production bootstrap or adoption first.' };
            }
            roleId = superAdmin.id;
            roleName = superAdmin.name;
        }
        const [updated] = await tx
            .update(schema.users)
            .set({
            password_hash: passwordHash,
            ...(input.reactivate ? { is_active: true } : {}),
            ...(roleId ? { role_id: roleId } : {}),
            updated_at: new Date(),
        })
            .where(eq(schema.users.id, account.id))
            .returning({ id: schema.users.id, email: schema.users.email, isActive: schema.users.is_active });
        await tx.delete(schema.sessions).where(eq(schema.sessions.user_id, account.id));
        await tx.insert(schema.auditLogs).values({
            user_id: account.id,
            action: 'ADMIN_PASSWORD_RECOVERED',
            entity_type: 'USER',
            entity_id: account.id,
        });
        await tx.insert(schema.systemLogs).values({
            level: 'info',
            message: 'Administrator recovery completed',
            context: {
                ticket,
                target_user_id: account.id,
                reactivated: Boolean(input.reactivate),
                super_admin_granted: Boolean(input.grantSuperAdmin),
            },
        });
        return {
            status: 'recovered',
            account: {
                id: updated.id,
                email: updated.email,
                isActive: updated.isActive,
                roleName,
            },
        };
    });
}
/**
 * Prevent lockout by refusing to deactivate the last active SUPER_ADMIN. The
 * operation is idempotent and always revokes active sessions when it changes a
 * live account.
 */
export async function deactivateAdministrator(db, input) {
    const email = requireEmail(input.email);
    const ticket = requireTicket(input.ticket);
    return db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL lock_timeout = '30s'"));
        await acquireTransactionAdvisoryLock(tx, 'darshan:administrator-maintenance', input.lockOptions);
        const accounts = await findAccountsByEmail(tx, email);
        if (accounts.length === 0)
            return { status: 'not_found' };
        if (accounts.length > 1) {
            return { status: 'conflict', reason: 'Multiple accounts share this email when normalized; resolve the duplicate accounts first.' };
        }
        const account = accounts[0];
        if (!account.isActive)
            return { status: 'already_deactivated', account };
        if (account.roleName === 'SUPER_ADMIN') {
            const activeSuperAdmins = await tx
                .select({ count: sql `count(*)` })
                .from(schema.users)
                .innerJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
                .where(sql `${schema.users.is_active} = true AND ${schema.roles.name} = 'SUPER_ADMIN'`);
            if (Number(activeSuperAdmins[0]?.count ?? 0) <= 1) {
                return { status: 'conflict', reason: 'Refusing to deactivate the last active SUPER_ADMIN account.' };
            }
        }
        const [updated] = await tx
            .update(schema.users)
            .set({ is_active: false, updated_at: new Date() })
            .where(eq(schema.users.id, account.id))
            .returning({ id: schema.users.id, email: schema.users.email, isActive: schema.users.is_active });
        await tx.delete(schema.sessions).where(eq(schema.sessions.user_id, account.id));
        await tx.insert(schema.auditLogs).values({
            user_id: account.id,
            action: 'ADMIN_ACCOUNT_DEACTIVATED',
            entity_type: 'USER',
            entity_id: account.id,
        });
        await tx.insert(schema.systemLogs).values({
            level: 'info',
            message: 'Administrator account deactivated',
            context: { ticket, target_user_id: account.id },
        });
        return { status: 'deactivated', account: { ...updated, roleName: account.roleName } };
    });
}
export async function cleanupExpiredSessions(db) {
    const deleted = await db
        .delete(schema.sessions)
        .where(lt(schema.sessions.expires_at, new Date()))
        .returning({ id: schema.sessions.id });
    return { deleted: deleted.length };
}
