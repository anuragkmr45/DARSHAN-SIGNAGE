import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const RUNTIME_ENTRYPOINT = 'dist-cli/scripts/recovery-runtime.js';
export const RUNTIME_MANIFEST = 'dist-cli/recovery-runtime-manifest.json';
const ALLOWED_BARE = new Set(['zod']);
const ALLOWED_BUILTINS = new Set(['node:crypto', 'node:fs', 'node:fs/promises', 'node:net', 'node:path', 'node:url']);
const EXPECTED_MIGRATION_META = Object.freeze(['0000_snapshot.json', '0001_snapshot.json', '0002_snapshot.json', '0003_snapshot.json', '_journal.json']);
const EXPECTED_PACKAGE_LOCK_SHA256 = '23bd7e38efe5c0a9ecc4589e4a539e88990d082f2998341fa1d2cd78dcb944e0';
const EXPECTED_DEPENDENCIES = Object.freeze({ zod: Object.freeze({ version: '3.25.76',
  packageJsonSha256: '70eedbe34fd52385a4ae2f3e5759b19682189f0118ea73a6e7c32c677f61668e',
  treeSha256: 'c1344564f8fbccf01dc59eeedd4f175e094319197af44b51c4ec47681b7e9124', fileCount: 596 }) });
const EXPECTED_ZOD_LOCK_ENTRY = Object.freeze({ funding: Object.freeze({ url: 'https://github.com/sponsors/colinhacks' }),
  license: 'MIT', version: '3.25.76' });
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const EXPECTED_TARGET = Object.freeze({ targetId: 'darshan-server-release-01', releaseId: 'release-01',
  terminalMigrationId: '0055_backup_deletion_idempotency_bindings.sql',
  migrationManifestSha256: 'fb7b1204029c2a4a3fac754845fff3723732ae8b0de6df54a5460c41b9a3f167' });
const EXPECTED_COMMANDS = Object.freeze(['discover', 'plan', 'hold', 'verify-source', 'resume', 'status', 'release', 'abandon']);
const EXPECTED_RUNTIME = Object.freeze({ format: 'darshan-recovery-runtime-v1', targetId: EXPECTED_TARGET.targetId,
  releaseId: EXPECTED_TARGET.releaseId, compatibilityGeneration: 1, platform: 'linux', architecture: 'x64', nodeMajor: 20,
  uid: 1000, gid: 1000, scratchPath: '/var/tmp/darshan-recovery-runtime',
  homePath: '/var/tmp/darshan-recovery-runtime/home', temporaryPath: '/var/tmp/darshan-recovery-runtime/tmp',
  scratchMode: 0o700, minimumScratchAvailableBytes: 1024 * 1024, signalGraceMs: 5_000, commands: EXPECTED_COMMANDS });

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

function safeRelative(relative) {
  if (typeof relative !== 'string' || relative.length < 1 || path.isAbsolute(relative) || relative.includes('\\') ||
      path.posix.normalize(relative) !== relative || relative === '..' || relative.startsWith('../')) {
    throw new Error(`Unsafe runtime asset path: ${String(relative)}`);
  }
  return relative;
}

async function canonicalRoot(root) {
  const absolute = path.resolve(root);
  if (await fs.realpath(absolute) !== absolute) throw new Error('Recovery manifest root must be canonical.');
  return absolute;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink &&
    left.uid === right.uid && left.gid === right.gid && left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

export async function readStableRegularFile(root, relative, maximumBytes = MAX_FILE_BYTES) {
  const base = await canonicalRoot(root); safeRelative(relative);
  const full = path.join(base, ...relative.split('/'));
  if (!full.startsWith(`${base}${path.sep}`)) throw new Error(`Runtime asset escaped root: ${relative}`);
  const pathBefore = await fs.lstat(full, { bigint: true });
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile() || pathBefore.nlink !== 1n || pathBefore.size > BigInt(maximumBytes) ||
      await fs.realpath(full) !== full) throw new Error(`Runtime asset is not a stable regular file: ${relative}`);
  const handle = await fs.open(full, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximumBytes) || !sameFileIdentity(pathBefore, before)) {
      throw new Error(`Runtime asset descriptor identity differs: ${relative}`);
    }
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) throw new Error(`Runtime asset ended during bounded read: ${relative}`);
      offset += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true }); const pathAfter = await fs.lstat(full, { bigint: true });
    if (!sameFileIdentity(before, after) || pathAfter.isSymbolicLink() || !pathAfter.isFile() ||
        !sameFileIdentity(after, pathAfter) || await fs.realpath(full) !== full) {
      throw new Error(`Runtime asset changed during stable read: ${relative}`);
    }
    return bytes;
  } finally { await handle.close(); }
}

function rejectForbiddenRelative(relative) {
  const forbidden = [
    /(?:^|\/)migration-ledger\.js$/,
    /(?:^|\/)bounded-advisory-lock\.js$/,
    /^dist-cli\/src\/(?:config|db|s3|server|routes|jobs|realtime)\//,
  ];
  if (forbidden.some((pattern) => pattern.test(relative)) ||
      (/^dist-cli\/src\/deployment\//.test(relative) && relative !== 'dist-cli/src/deployment/migration-manifest.js')) {
    throw new Error(`Forbidden application/effect module in recovery runtime closure: ${relative}`);
  }
}

function moduleSpecifiers(source, relative) {
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`Compiled runtime JavaScript failed AST parse: ${relative}`);
  const specifiers = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error(`Nonliteral module specifier: ${relative}`);
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
        throw new Error(`Nonliteral dynamic import is forbidden: ${relative}`);
      }
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file); return specifiers;
}

export async function computeImportClosure(root, entrypoint = RUNTIME_ENTRYPOINT) {
  if (!safeRelative(entrypoint).startsWith('dist-cli/')) throw new Error('Recovery runtime entrypoint escaped compiled output.');
  const pending = [entrypoint]; const visited = new Map(); const bare = new Set(); const builtins = new Set();
  while (pending.length) {
    const relative = pending.pop();
    if (visited.has(relative)) continue;
    rejectForbiddenRelative(relative);
    if (!relative.endsWith('.js')) throw new Error(`Runtime closure contains non-JavaScript: ${relative}`);
    const bytes = await readStableRegularFile(root, relative); visited.set(relative, sha256(bytes));
    for (const specifier of moduleSpecifiers(bytes.toString('utf8'), relative)) {
      if (specifier.startsWith('node:')) {
        if (!ALLOWED_BUILTINS.has(specifier)) throw new Error(`Unreviewed recovery runtime builtin: ${specifier}`);
        builtins.add(specifier); continue;
      }
      if (!specifier.startsWith('.')) {
        if (!ALLOWED_BARE.has(specifier)) throw new Error(`Unreviewed recovery runtime dependency: ${specifier}`);
        bare.add(specifier); continue;
      }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
      safeRelative(resolved);
      if (!resolved.startsWith('dist-cli/')) throw new Error(`Recovery runtime relative import escaped compiled output: ${relative}`);
      rejectForbiddenRelative(resolved); pending.push(resolved);
    }
  }
  const files = [...visited].sort(([left], [right]) => left.localeCompare(right))
    .map(([file, digest]) => ({ path: file, sha256: digest }));
  const bareDependencies = [...bare].sort();
  const builtinDependencies = [...builtins].sort();
  if (canonicalJson(bareDependencies) !== canonicalJson([...ALLOWED_BARE].sort())) {
    throw new Error('Recovery runtime dependency set is missing or changed.');
  }
  if (canonicalJson(builtinDependencies) !== canonicalJson([...ALLOWED_BUILTINS].sort())) {
    throw new Error('Recovery runtime builtin set is missing or changed.');
  }
  return { files, bareDependencies, builtinDependencies };
}

function evaluateConst(source, relative, requested) {
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`Compiled identity failed AST parse: ${relative}`);
  const declarations = new Map();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) declarations.set(declaration.name.text, declaration.initializer);
    }
  }
  const active = new Set();
  const evaluate = (node) => {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(evaluate);
    if (ts.isObjectLiteralExpression(node)) {
      const value = {};
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) {
          throw new Error(`Unsupported compiled identity property: ${relative}`);
        }
        value[property.name.text] = evaluate(property.initializer);
      }
      return value;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(file) === 'Object' && node.expression.name.text === 'freeze' && node.arguments.length === 1) {
      return evaluate(node.arguments[0]);
    }
    if (ts.isBinaryExpression(node)) {
      const left = evaluate(node.left); const right = evaluate(node.right);
      if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`Unsupported compiled identity arithmetic: ${relative}`);
      if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
      throw new Error(`Unsupported compiled identity arithmetic: ${relative}`);
    }
    if (ts.isIdentifier(node)) {
      if (active.has(node.text) || !declarations.has(node.text)) throw new Error(`Unsupported compiled identity reference: ${relative}`);
      active.add(node.text); const value = evaluate(declarations.get(node.text)); active.delete(node.text); return value;
    }
    throw new Error(`Unsupported compiled identity expression: ${relative}`);
  };
  if (!declarations.has(requested)) throw new Error(`Compiled identity export is missing: ${requested}`);
  return evaluate(declarations.get(requested));
}

async function assertCompiledIdentity(root) {
  const targetPath = 'dist-cli/src/recovery/release-target.js';
  const runtimePath = 'dist-cli/src/recovery/runtime-contract.js';
  const target = evaluateConst((await readStableRegularFile(root, targetPath)).toString('utf8'), targetPath, 'RELEASE_RECOVERY_TARGET');
  const runtimeSource = (await readStableRegularFile(root, runtimePath)).toString('utf8');
  const commands = evaluateConst(runtimeSource, runtimePath, 'RECOVERY_RUNTIME_COMMANDS');
  const runtime = evaluateConst(runtimeSource, runtimePath, 'RECOVERY_RUNTIME_METADATA');
  if (canonicalJson(target) !== canonicalJson(EXPECTED_TARGET) || canonicalJson(commands) !== canonicalJson(EXPECTED_COMMANDS) ||
      canonicalJson(runtime) !== canonicalJson(EXPECTED_RUNTIME)) throw new Error('Compiled recovery target/runtime identity changed.');
}

async function directoryTreeDigest(root, relative) {
  const base = await canonicalRoot(root); safeRelative(relative);
  const start = path.join(base, ...relative.split('/')); const stat = await fs.lstat(start, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || await fs.realpath(start) !== start) throw new Error(`Dependency tree is unsafe: ${relative}`);
  const files = [];
  const walk = async (directory, prefix) => {
    const entries = await fs.readdir(directory, { withFileTypes: true }); entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name; const child = path.join(directory, entry.name);
      const childStat = await fs.lstat(child, { bigint: true });
      if (childStat.isSymbolicLink()) throw new Error(`Dependency tree contains symlink: ${relative}/${childPrefix}`);
      if (childStat.isDirectory()) {
        if (await fs.realpath(child) !== child) throw new Error(`Dependency directory is noncanonical: ${relative}/${childPrefix}`);
        await walk(child, childPrefix);
      } else if (childStat.isFile()) {
        const bytes = await readStableRegularFile(base, `${relative}/${childPrefix}`, 16 * 1024 * 1024);
        files.push({ path: childPrefix, size: bytes.byteLength, sha256: sha256(bytes) });
      } else throw new Error(`Dependency tree contains special entry: ${relative}/${childPrefix}`);
    }
  };
  await walk(start, ''); const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path.length}:${file.path}:${file.size}:${file.sha256};`);
  return { treeSha256: hash.digest('hex'), fileCount: files.length };
}

async function dependencyEvidence(root, names) {
  return Promise.all(names.map(async (name) => {
    const packageBytes = await readStableRegularFile(root, `node_modules/${name}/package.json`, 1024 * 1024);
    const parsed = JSON.parse(packageBytes.toString('utf8'));
    if (parsed.name !== name || typeof parsed.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(parsed.version)) {
      throw new Error(`Runtime dependency package identity is invalid: ${name}`);
    }
    const tree = await directoryTreeDigest(root, `node_modules/${name}`);
    const evidence = { name, version: parsed.version, packageJsonSha256: sha256(packageBytes),
      treeSha256: tree.treeSha256, fileCount: tree.fileCount };
    const reviewed = EXPECTED_DEPENDENCIES[name];
    if (!reviewed || canonicalJson(evidence) !== canonicalJson({ name, ...reviewed })) {
      throw new Error(`Runtime dependency differs from reviewed release bytes: ${name}`);
    }
    return evidence;
  }));
}

function validatePackageLock(packageLock) {
  if (sha256(packageLock) !== EXPECTED_PACKAGE_LOCK_SHA256) throw new Error('Package lock differs from reviewed release bytes.');
  let parsed;
  try { parsed = JSON.parse(packageLock.toString('utf8')); } catch (cause) { throw new Error('Package lock is invalid JSON.', { cause }); }
  if (parsed?.lockfileVersion !== 3 || parsed?.packages?.['']?.dependencies?.zod !== '^3.22.4' ||
      canonicalJson(parsed?.packages?.['node_modules/zod']) !== canonicalJson(EXPECTED_ZOD_LOCK_ENTRY)) {
    throw new Error('Package lock dependency provenance differs from reviewed release identity.');
  }
}

async function migrationEvidence(root) {
  const directory = path.join(await canonicalRoot(root), 'drizzle/migrations'); const stat = await fs.lstat(directory, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || await fs.realpath(directory) !== directory) throw new Error('Migration directory is unsafe.');
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !(entry.isFile() && /^\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/.test(entry.name)) &&
      !(entry.name === 'meta' && entry.isDirectory()))) {
    throw new Error('Migration directory contains unknown or unsafe assets.');
  }
  if (!entries.some((entry) => entry.name === 'meta' && entry.isDirectory())) throw new Error('Migration metadata directory is missing.');
  const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const terminalIndex = names.indexOf(EXPECTED_TARGET.terminalMigrationId);
  if (terminalIndex < 0) throw new Error('Terminal migration identity changed.');
  // The frozen release-01 runtime contains only its reviewed migration prefix.
  // Newer approved application releases may add migrations without silently
  // widening this runtime's immutable target or bundled schema authority.
  const reviewedNames = names.slice(0, terminalIndex + 1);
  const migrations = []; const fingerprint = createHash('sha256');
  for (const name of reviewedNames) {
    const bytes = await readStableRegularFile(root, `drizzle/migrations/${name}`); const digest = sha256(bytes);
    migrations.push({ path: `drizzle/migrations/${name}`, sha256: digest }); fingerprint.update(`${name.length}:${name}:${digest};`);
  }
  if (fingerprint.digest('hex') !== EXPECTED_TARGET.migrationManifestSha256) throw new Error('Migration fingerprint changed.');
  const metaDirectory = `${directory}/meta`; const metaStat = await fs.lstat(metaDirectory, { bigint: true });
  if (metaStat.isSymbolicLink() || !metaStat.isDirectory() || await fs.realpath(metaDirectory) !== metaDirectory) {
    throw new Error('Migration metadata directory is unsafe.');
  }
  const metaEntries = await fs.readdir(metaDirectory, { withFileTypes: true });
  if (metaEntries.some((entry) => !entry.isFile()) ||
      canonicalJson(metaEntries.map((entry) => entry.name).sort()) !== canonicalJson(EXPECTED_MIGRATION_META)) {
    throw new Error('Migration metadata assets changed or contain unsafe entries.');
  }
  const metadata = [];
  for (const name of EXPECTED_MIGRATION_META) {
    const bytes = await readStableRegularFile(root, `drizzle/migrations/meta/${name}`);
    metadata.push({ path: `drizzle/migrations/meta/${name}`, sha256: sha256(bytes) });
  }
  return { migrations, metadata };
}

export async function buildExpectedRecoveryRuntimeManifest(root) {
  await assertCompiledIdentity(root);
  const closure = await computeImportClosure(root); const dependencies = await dependencyEvidence(root, closure.bareDependencies);
  const migrationAssets = await migrationEvidence(root); const packageLock = await readStableRegularFile(root, 'package-lock.json', 32 * 1024 * 1024);
  validatePackageLock(packageLock);
  return { format: 'darshan-recovery-runtime-v1',
    identity: { target_id: EXPECTED_TARGET.targetId, release_id: EXPECTED_TARGET.releaseId, compatibility_generation: 1,
      terminal_migration_id: EXPECTED_TARGET.terminalMigrationId, migration_manifest_sha256: EXPECTED_TARGET.migrationManifestSha256 },
    contract: { platform: 'linux', architecture: 'x64', node_major: 20, uid: 1000, gid: 1000,
      scratch_path: EXPECTED_RUNTIME.scratchPath, entrypoint: RUNTIME_ENTRYPOINT },
    entrypoint_sha256: closure.files.find((item) => item.path === RUNTIME_ENTRYPOINT)?.sha256,
    import_closure: closure, dependencies,
    assets: { package_lock: { path: 'package-lock.json', sha256: sha256(packageLock) },
      migrations: migrationAssets.migrations, migration_metadata: migrationAssets.metadata },
    deferred_to_packet_5a2c2: ['backend-host launcher', 'recovery-only broker listener', 'generated Compose mount profile'] };
}

export async function writeRecoveryRuntimeManifest(root) {
  const expected = await buildExpectedRecoveryRuntimeManifest(root); const base = await canonicalRoot(root);
  const output = path.join(base, RUNTIME_MANIFEST); const parent = path.dirname(output); const basename = path.basename(output);
  if (await fs.realpath(parent) !== parent) throw new Error('Recovery runtime manifest parent is noncanonical.');
  const parentBefore = await fs.lstat(parent, { bigint: true });
  if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory()) throw new Error('Recovery runtime manifest parent is unsafe.');
  const parentHandle = await fs.open(parent, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  const temporaryName = `.${basename}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`;
  const temporary = `/proc/self/fd/${parentHandle.fd}/${temporaryName}`; let temporaryIdentity;
  try {
    const parentFd = await parentHandle.stat({ bigint: true });
    if (parentFd.dev !== parentBefore.dev || parentFd.ino !== parentBefore.ino) throw new Error('Recovery runtime manifest parent changed.');
    try {
      const destination = await fs.lstat(output, { bigint: true });
      if (destination.isSymbolicLink() || !destination.isFile() || destination.nlink !== 1n || await fs.realpath(output) !== output) {
        throw new Error('Existing recovery runtime manifest output is unsafe.');
      }
    } catch (cause) { if (cause?.code !== 'ENOENT') throw cause; }
    const bytes = Buffer.from(`${canonicalJson(expected)}\n`);
    const handle = await fs.open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(bytes); await handle.sync(); temporaryIdentity = await handle.stat({ bigint: true });
      if (!temporaryIdentity.isFile() || temporaryIdentity.nlink !== 1n || temporaryIdentity.size !== BigInt(bytes.byteLength)) {
        throw new Error('Recovery runtime manifest temporary output is unsafe.');
      }
    } finally { await handle.close(); }
    const temporaryPathIdentity = await fs.lstat(temporary, { bigint: true });
    if (!sameFileIdentity(temporaryIdentity, temporaryPathIdentity)) throw new Error('Recovery runtime manifest temporary output changed.');
    await fs.rename(temporary, `/proc/self/fd/${parentHandle.fd}/${basename}`); temporaryIdentity = undefined;
    await parentHandle.sync();
    if (!(await readStableRegularFile(base, RUNTIME_MANIFEST, 4 * 1024 * 1024)).equals(bytes)) {
      throw new Error('Recovery runtime manifest readback differed.');
    }
    return output;
  } finally {
    if (temporaryIdentity) {
      try {
        const current = await fs.lstat(temporary, { bigint: true });
        if (sameFileIdentity(temporaryIdentity, current)) await fs.unlink(temporary);
      } catch (cause) { if (cause?.code !== 'ENOENT') throw cause; }
    }
    await parentHandle.close();
  }
}

export async function verifyRecoveryRuntimeManifest(root) {
  const bytes = await readStableRegularFile(root, RUNTIME_MANIFEST, 4 * 1024 * 1024); let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch (cause) { throw new Error('Recovery runtime manifest is invalid JSON.', { cause }); }
  if (!Buffer.from(`${canonicalJson(parsed)}\n`).equals(bytes)) throw new Error('Recovery runtime manifest is not strict canonical JSON.');
  const expected = await buildExpectedRecoveryRuntimeManifest(root);
  if (canonicalJson(parsed) !== canonicalJson(expected)) throw new Error('Recovery runtime manifest differs from independently recomputed assets.');
  return expected;
}
