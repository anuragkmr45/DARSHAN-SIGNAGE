#!/usr/bin/env tsx
/**
 * Build Verification Script
 * Verifies that the codebase can be imported and basic functionality works
 */

console.log('🔍 Verifying DARSHAN Backend Build\n');
console.log('='.repeat(50));

let errors = 0;
let warnings = 0;

// Load config first (required by some modules)
console.log('\n⚙️  Loading configuration...');
try {
  const { getRedactedRuntimeConfigSummary } = await import('../src/config/index.js');
  const summary = getRedactedRuntimeConfigSummary();
  console.log(`   ✅ Configuration loaded for ${summary.env.NODE_ENV} / ${summary.env.SIGNHEX_ENVIRONMENT_NAME}`);
} catch (error: any) {
  console.log('   ⚠️  Configuration not loaded (expected if .env is missing)');
  warnings++;
}

// Test 1: Import core modules
console.log('\n📦 Test 1: Importing core modules...');
try {
  await import('../src/config/index.js');
  console.log('   ✅ Config module');
} catch (error: any) {
  console.error('   ❌ Config module:', error.message);
  errors++;
}

try {
  await import('../src/utils/logger.js');
  console.log('   ✅ Logger module');
} catch (error: any) {
  console.error('   ❌ Logger module:', error.message);
  errors++;
}

try {
  await import('../src/rbac/index.js');
  console.log('   ✅ RBAC module');
} catch (error: any) {
  console.error('   ❌ RBAC module:', error.message);
  errors++;
}

try {
  await import('../src/auth/jwt.js');
  console.log('   ✅ JWT module');
} catch (error: any) {
  console.error('   ❌ JWT module:', error.message);
  errors++;
}

// Test 2: Import database schema
console.log('\n📊 Test 2: Importing database schema...');
try {
  const schema = await import('../src/db/schema.js');
  const tables = [
    'users', 'departments', 'media', 'presentations', 'schedules',
    'screens', 'requests', 'requestMessages', 'notifications',
    'auditLogs', 'deviceCertificates', 'devicePairings', 'emergencies'
  ];
  
  for (const table of tables) {
    if (schema[table]) {
      console.log(`   ✅ Table: ${table}`);
    } else {
      console.error(`   ❌ Table missing: ${table}`);
      errors++;
    }
  }
} catch (error: any) {
  console.error('   ❌ Schema import failed:', error.message);
  errors++;
}

// Test 3: Import repositories
console.log('\n🗄️  Test 3: Importing repositories...');
const repos = [
  'audit-log', 'department', 'device-certificate', 'device-pairing',
  'emergency', 'media', 'notification', 'presentation',
  'request-message', 'request', 'schedule', 'screen', 'user'
];

for (const repo of repos) {
  try {
    await import(`../src/db/repositories/${repo}.js`);
    console.log(`   ✅ Repository: ${repo}`);
  } catch (error: any) {
    console.error(`   ❌ Repository ${repo}:`, error.message);
    errors++;
  }
}

// Test 4: Import routes
console.log('\n🛣️  Test 4: Importing routes...');
const routes = [
  'auth', 'users', 'departments', 'media', 'presentations',
  'schedules', 'screens', 'requests', 'notifications',
  'audit-logs', 'device-pairing', 'device-telemetry', 'emergency'
];

for (const route of routes) {
  try {
    await import(`../src/routes/${route}.js`);
    console.log(`   ✅ Route: ${route}`);
  } catch (error: any) {
    console.error(`   ❌ Route ${route}:`, error.message);
    errors++;
  }
}

// Test 5: RBAC functionality
console.log('\n🔐 Test 5: Testing RBAC...');
try {
  const { createMongoAbility } = await import('@casl/ability');
  const { checkAbility } = await import('../src/rbac/index.js');
  const { SYSTEM_ROLE_DEFAULTS } = await import('../src/rbac/system-roles.js');

  const adminAbility = createMongoAbility(SYSTEM_ROLE_DEFAULTS.ADMIN.grants);
  if (checkAbility(adminAbility, 'manage', 'all')) console.log('   ✅ Admin can manage all');
  else {
    console.error('   ❌ Admin cannot manage all');
    errors++;
  }

  const operatorAbility = createMongoAbility(SYSTEM_ROLE_DEFAULTS.OPERATOR.grants);
  if (checkAbility(operatorAbility, 'create', 'Media')) console.log('   ✅ Operator can create media');
  else {
    console.error('   ❌ Operator cannot create media');
    errors++;
  }

  const departmentAbility = createMongoAbility(SYSTEM_ROLE_DEFAULTS.DEPARTMENT.grants);
  if (checkAbility(departmentAbility, 'read', 'ScheduleRequest')) console.log('   ✅ Department can read schedule requests');
  else {
    console.error('   ❌ Department cannot read schedule requests');
    errors++;
  }
} catch (error: any) {
  console.error('   ❌ RBAC test failed:', error.message);
  errors++;
}

// Test 6: Logger functionality
console.log('\n📝 Test 6: Testing logger...');
try {
  const { createLogger } = await import('../src/utils/logger.js');
  const logger = createLogger('test');
  
  if (logger && typeof logger.info === 'function') {
    console.log('   ✅ Logger created successfully');
  } else {
    console.error('   ❌ Logger creation failed');
    errors++;
  }
} catch (error: any) {
  console.error('   ❌ Logger test failed:', error.message);
  errors++;
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('\n📊 Verification Summary:');
console.log(`   Errors:   ${errors}`);
console.log(`   Warnings: ${warnings}`);

if (errors === 0) {
  console.log('\n✅ All verification tests passed!');
  console.log('\n💡 Next steps:');
  console.log('   Development:');
  console.log('     1. Start services: docker compose up -d postgres minio');
  console.log('     2. Check services: npm run check');
  console.log('     3. Initialize local DB only: npm run db:push && npm run seed:demo');
  console.log('     4. Start server: npm run dev');
  console.log('   Production:');
  console.log('     Use the generated source-free role bundle: ./deploy.sh');
  console.log('     Never initialize production with npm run db:push or npm run seed.');
  process.exit(0);
} else {
  console.log('\n❌ Verification failed with errors');
  console.log('\n💡 Fix the errors above and run: npm run verify');
  process.exit(1);
}
