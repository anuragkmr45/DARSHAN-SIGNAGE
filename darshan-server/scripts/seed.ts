import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { config as appConfig } from '../src/config/index.js';
import { initializeDatabase, getDatabase, schema } from '../src/db/index.js';
import { hashPassword } from '../src/auth/password.js';
import { createLogger } from '../src/utils/logger.js';
import { SYSTEM_ROLE_DEFAULTS, SYSTEM_ROLE_NAMES } from '../src/rbac/system-roles.js';

const logger = createLogger('seed');

async function seed() {
  try {
    if (!appConfig.ADMIN_EMAIL || !appConfig.ADMIN_PASSWORD) {
      throw new Error('Development/demo seed requires ADMIN_EMAIL and ADMIN_PASSWORD. Production must use npm run bootstrap:production.');
    }
    const adminEmail = appConfig.ADMIN_EMAIL.trim().toLowerCase();
    const adminPassword = appConfig.ADMIN_PASSWORD;
    logger.info('Initializing database...');
    await initializeDatabase();
    const db = getDatabase();

    // Create system roles
    logger.info('Creating system roles...');
    const systemRoles = SYSTEM_ROLE_NAMES;
    const roleIdByName = new Map<string, string>();

    for (const name of systemRoles) {
      const [existingRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, name));
      const role = existingRole
        ? (
            await db
              .update(schema.roles)
              .set({
                description: `${name} role`,
                is_system: true,
                permissions: SYSTEM_ROLE_DEFAULTS[name],
                updated_at: new Date(),
              })
              .where(eq(schema.roles.id, existingRole.id))
              .returning()
          )[0]
        : (
            await db
              .insert(schema.roles)
              .values({
                name,
                description: `${name} role`,
                is_system: true,
                permissions: SYSTEM_ROLE_DEFAULTS[name],
              })
              .returning()
          )[0];
      roleIdByName.set(name, role.id);
    }

    // Create admin user
    logger.info('Creating admin user...');
    const adminPasswordHash = await hashPassword(adminPassword);

    const existingAdmin = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, adminEmail));

    if (existingAdmin.length === 0) {
      await db.insert(schema.users).values({
        email: adminEmail,
        password_hash: adminPasswordHash,
        first_name: 'Admin',
        last_name: 'User',
        role_id: roleIdByName.get('SUPER_ADMIN') ?? roleIdByName.get('ADMIN')!,
        is_active: true,
      });
      logger.info(`Admin user created: ${adminEmail}`);
    } else {
      logger.info(`Admin user already exists: ${adminEmail}`);
    }

    // Create sample departments
    logger.info('Creating sample departments...');
    const departments = [
      { name: 'Marketing', description: 'Marketing Department' },
      { name: 'Sales', description: 'Sales Department' },
      { name: 'Operations', description: 'Operations Department' },
    ];

    for (const dept of departments) {
      const existing = await db
        .select()
        .from(schema.departments)
        .where(eq(schema.departments.name, dept.name));

      if (existing.length === 0) {
        await db.insert(schema.departments).values(dept);
        logger.info(`Department created: ${dept.name}`);
      } else {
        logger.info(`Department already exists: ${dept.name}`);
      }
    }

    // Create emergency status record
    logger.info('Creating emergency status record...');
    const existingEmergency = await db.select().from(schema.emergencyStatus);
    if (existingEmergency.length === 0) {
      await db.insert(schema.emergencyStatus).values({
        is_active: false,
      });
      logger.info('Emergency status record created');
    }

    logger.info('Seed completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error(error, 'Seed failed');
    process.exit(1);
  }
}

seed();
