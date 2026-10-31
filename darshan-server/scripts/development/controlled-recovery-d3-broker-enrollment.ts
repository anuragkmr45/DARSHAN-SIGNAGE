import { constants, createReadStream } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';

export const D3_BROKER_SERVER = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server';
export const D3_BROKER_NODE = '/home/hexmon/.nvm/versions/node/v20.20.2/bin/node';
export const D3_BROKER_ACTIVATOR = '/usr/bin/systemd-socket-activate';
export const D3_BROKER_ENTRY = `${D3_BROKER_SERVER}/dist/backups/backup-broker-main.js`;
export const D3_BROKER_INVENTORY = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-d3.broker-dependencies.json';
export const D3_BROKER_MODULES = Object.freeze(['backup-broker-journal', 'backup-broker-main', 'backup-broker-protocol', 'backup-broker-repository-adapter', 'backup-broker-service', 'configuration-capsule-inventory', 'configuration-capsule-policy', 'ed25519-public-keyring', 'errors', 'local-repository', 'manifest', 'repository-mutation-authority', 'repository-publication', 'repository-retention-adapter'].map((name) => `${D3_BROKER_SERVER}/dist/backups/${name}.js`));
const sha = z.string().regex(/^[a-f0-9]{64}$/), file = z.object({ path: z.string().startsWith('/'), sha256: sha, uid: z.number().int().nonnegative(), gid: z.number().int().nonnegative(), mode: z.string().regex(/^0[0-7]{3}$/), bytes: z.number().int().positive().max(134217728) }).strict();
const resolution = z.object({ importer: z.string(), specifier: z.literal('zod'), packageRoot: z.string(), resolvedPath: z.string(), packageJsonSha256: sha, resolvedSha256: sha }).strict();
export const d3BrokerInventorySchema = z.object({ format: z.literal('darshan-d3-broker-dependencies-v1'), activatorPackage: z.literal('259.9-0ubuntu0.1'), nodeVersion: z.literal('v20.20.2'), zodVersion: z.literal('3.25.76'), files: z.array(file).min(20).max(1024), modulePaths: z.array(z.string()), builtins: z.array(z.string()), bare: z.tuple([z.literal('zod')]), bareResolutions: z.array(resolution).min(1).max(14), inventorySha256: sha }).strict();
export type D3BrokerInventory = z.infer<typeof d3BrokerInventorySchema>;
const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BROKER_DEPENDENCY_CHANGED', 'The exact root-owned activator, Node, built broker closure or complete dependency inventory differs.');
const same = (a: Awaited<ReturnType<typeof lstat>>, b: Awaited<ReturnType<typeof lstat>>) => ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeMs', 'ctimeMs'].every((key) => a[key as keyof typeof a] === b[key as keyof typeof b]);
async function identity(path: string) {
  const before = await lstat(path); if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > 134217728 || await realpath(path) !== path) throw failed();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { if (!same(before, await handle.stat())) throw failed(); const hash = createHash('sha256'); let bytes = 0;
    for await (const part of createReadStream(path, { fd: handle.fd, autoClose: false, highWaterMark: 65536 })) { bytes += part.length; if (bytes > before.size) throw failed(); hash.update(part); }
    if (bytes !== before.size || !same(before, await handle.stat()) || !same(before, await lstat(path))) throw failed(); return { path, sha256: hash.digest('hex'), uid: before.uid, gid: before.gid, mode: `0${(before.mode & 0o7777).toString(8)}`, bytes };
  } finally { await handle.close(); }
}
async function zodPaths() { const root = `${D3_BROKER_SERVER}/node_modules/zod`, paths: string[] = []; const visit = async (path: string) => { const s = await lstat(path); if (await realpath(path) !== path || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 0o002)) throw failed();
    if (s.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(`${path}/${name}`); else if (s.isFile()) paths.push(path); else throw failed(); if (paths.length > 1000) throw failed(); }; await visit(root); return paths; }
function validate(value: unknown) { const result = d3BrokerInventorySchema.parse(value), { inventorySha256, ...unsigned } = result;
  if (digest(unsigned) !== inventorySha256 || digest(result.modulePaths) !== digest(D3_BROKER_MODULES) || digest(result.builtins) !== digest(['node:crypto', 'node:fs', 'node:net', 'node:path']) || new Set(result.files.map(({ path }) => path)).size !== result.files.length) throw failed(); return result; }
/** AST text only, including export-from imports; no broker/package code is evaluated. */
export async function readD3BrokerStaticImports(modulePaths: readonly string[], serverRoot = D3_BROKER_SERVER) {
  if (modulePaths.length < 1 || modulePaths.length > 14 || new Set(modulePaths).size !== modulePaths.length) throw failed();
  const ts = await import('typescript'), builtins = new Set<string>(), bare = new Set<string>(), imports: Array<{ importer: string; specifier: 'zod' }> = [];
  for (const path of modulePaths) { if (dirname(path) !== `${serverRoot}/dist/backups` || !/^[A-Za-z0-9-]+\.js$/.test(path.slice(dirname(path).length + 1))) throw failed(); const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); let source: string; try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 131072) throw failed(); source = await handle.readFile('utf8'); if (Buffer.byteLength(source) !== stat.size) throw failed(); } finally { await handle.close(); }
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS); const inspect = (node: import('typescript').Node) => {
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) throw failed();
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) { if (!ts.isStringLiteral(node.moduleSpecifier)) throw failed(); const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith('node:')) builtins.add(specifier); else if (specifier === 'zod') { bare.add(specifier); if (!imports.some((value) => value.importer === path)) imports.push({ importer: path, specifier }); } else if (!specifier.startsWith('./') || !modulePaths.includes(`${serverRoot}/dist/backups/${specifier.slice(2)}`)) throw failed(); }
      ts.forEachChild(node, inspect); }; inspect(parsed);
  }
  if (digest([...bare]) !== digest(['zod'])) throw failed(); return { builtins: [...builtins].sort(), bare: ['zod'] as ['zod'], imports: imports.sort((a, b) => a.importer.localeCompare(b.importer)) };
}
/** Bounded Node20 ESM subset: package self scope, nearest node_modules and ordered import exports.
 * Unsupported shapes fail closed. This never uses require.resolve (which selects require exports),
 * imports package code, consults ambient loaders/conditions, or searches beyond the enrolled package. */
export async function resolveD3BrokerBareImports(input: { serverRoot: string; modulePaths: readonly string[]; imports: ReadonlyArray<{ importer: string; specifier: string }>; files: ReadonlyArray<{ path: string; sha256: string }> }) {
  try {
  const { serverRoot, modulePaths, imports, files } = input, root = resolve(serverRoot), packageRoot = `${root}/node_modules/zod`, entries = new Map(files.map((value) => [value.path, value.sha256]));
  if (serverRoot !== root || modulePaths.length < 1 || modulePaths.length > 14 || imports.length < 1 || imports.length > 14 || files.length > 1024 || entries.size !== files.length || new Set(modulePaths).size !== modulePaths.length || new Set(imports.map((value) => `${value.importer}:${value.specifier}`)).size !== imports.length) throw failed();
  const directory = async (path: string, optional = false) => { try { const s = await lstat(path); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 0o002) || await realpath(path) !== path) throw failed(); return true; } catch (cause) { if (optional && (cause as NodeJS.ErrnoException).code === 'ENOENT') return false; throw cause; } };
  const json = async (path: string) => { const expected = entries.get(path), before = await identity(path); if (!expected || before.sha256 !== expected || before.bytes > 65536 || before.uid !== process.getuid?.() || before.gid !== process.getgid?.() || (Number.parseInt(before.mode, 8) & 0o002)) throw failed(); const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); let bytes: Buffer; try { bytes = await h.readFile(); } finally { await h.close(); } if (createHash('sha256').update(bytes).digest('hex') !== expected || digest(await identity(path)) !== digest(before)) throw failed(); const value: unknown = parseStrictJson(bytes, 65536); if (!value || typeof value !== 'object' || Array.isArray(value)) throw failed(); return value as Record<string, unknown>; };
  await directory(root); const scope = await json(`${root}/package.json`); if (scope.type !== 'module' || scope.name === 'zod' || Object.hasOwn(scope, 'imports') || Object.hasOwn(scope, 'exports')) throw failed();
  // Node's nearest package scope controls self references and JS format. Reject every new scope,
  // even one which appears harmless, instead of silently adopting un-enrolled package metadata.
  for (const importer of modulePaths) { if (dirname(importer) !== `${root}/dist/backups` || await realpath(importer) !== importer) throw failed(); for (let parent = dirname(importer), steps = 0; parent !== root; parent = dirname(parent)) { if (++steps > 2) throw failed(); await directory(parent); try { await lstat(`${parent}/package.json`); throw failed(); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; } } }
  const select = (value: unknown, depth = 0): string => { if (depth > 8) throw failed(); if (typeof value === 'string') return value; if (!value || typeof value !== 'object' || Array.isArray(value)) throw failed(); const conditions = Object.entries(value); if (conditions.length > 32 || conditions.some(([key]) => !['node', 'node-addons', 'import', 'require', 'default', 'types', '@zod/source'].includes(key))) throw failed(); for (const [condition, target] of conditions) if (['node', 'node-addons', 'import', 'default'].includes(condition)) return select(target, depth + 1); throw failed(); };
  const results: Array<z.infer<typeof resolution>> = [];
  for (const { importer, specifier } of imports) { if (!modulePaths.includes(importer) || specifier !== 'zod') throw failed(); let found = false;
    for (let parent = dirname(importer), steps = 0; ; parent = dirname(parent)) { if (++steps > 3) throw failed(); const nodeModules = `${parent}/node_modules`; if (await directory(nodeModules, true)) { const candidate = `${nodeModules}/zod`; let present = false; try { await lstat(candidate); present = true; } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; } if (present) { if (candidate !== packageRoot) throw failed(); await directory(candidate); found = true; break; } } if (parent === root) break; }
    if (!found) throw failed(); const pkg = await json(`${packageRoot}/package.json`); if (pkg.name !== 'zod' || pkg.type !== 'module' || Object.hasOwn(pkg, 'imports')) throw failed(); const exports = pkg.exports; if (!exports || typeof exports !== 'object' || Array.isArray(exports) || !Object.hasOwn(exports, '.') || Object.keys(exports).some((key) => !key.startsWith('.'))) throw failed();
    const target = select((exports as Record<string, unknown>)['.']); if (target !== './index.js') throw failed(); const resolvedPath = resolve(packageRoot, target), resolved = await identity(resolvedPath); if (await realpath(resolvedPath) !== resolvedPath || resolved.sha256 !== entries.get(resolvedPath) || resolved.uid !== process.getuid?.() || resolved.gid !== process.getgid?.() || (Number.parseInt(resolved.mode, 8) & 0o002)) throw failed();
    results.push({ importer, specifier, packageRoot, resolvedPath, packageJsonSha256: entries.get(`${packageRoot}/package.json`)!, resolvedSha256: resolved.sha256 });
  }
  return results.sort((a, b) => a.importer.localeCompare(b.importer));
  } catch { throw failed(); }
}
/** Static enrollment only: reads JS as AST text; never imports/executes broker modules. */
export async function observeD3BrokerInventory(): Promise<D3BrokerInventory> {
  const imports = await readD3BrokerStaticImports(D3_BROKER_MODULES), paths = [D3_BROKER_ACTIVATOR, D3_BROKER_NODE, `${D3_BROKER_SERVER}/package.json`, `${D3_BROKER_SERVER}/package-lock.json`, ...D3_BROKER_MODULES, ...await zodPaths()].sort();
  const files = []; for (const path of paths) files.push(await identity(path));
  const bareResolutions = await resolveD3BrokerBareImports({ serverRoot: D3_BROKER_SERVER, modulePaths: D3_BROKER_MODULES, imports: imports.imports, files });
  const unsigned = { format: 'darshan-d3-broker-dependencies-v1' as const, activatorPackage: '259.9-0ubuntu0.1' as const, nodeVersion: 'v20.20.2' as const, zodVersion: '3.25.76' as const, files, modulePaths: [...D3_BROKER_MODULES], builtins: imports.builtins, bare: imports.bare, bareResolutions };
  return validate({ ...unsigned, inventorySha256: digest(unsigned) });
}
/** Complete file/path inventory, metadata and byte verification; no version command or module import. */
export async function verifyD3BrokerInventory(expectedSha256: string) {
  try { const own = await identity(D3_BROKER_INVENTORY); if (own.sha256 !== expectedSha256 || own.uid !== process.getuid?.() || own.bytes > 524288 || (Number.parseInt(own.mode, 8) & 0o002)) throw failed(); const h = await open(D3_BROKER_INVENTORY, constants.O_RDONLY | constants.O_NOFOLLOW); let bytes: Buffer; try { bytes = await h.readFile(); } finally { await h.close(); } const inventory = validate(parseStrictJson(bytes, 524288)); if (!bytes.equals(canonicalJson(inventory))) throw failed();
    const paths = [D3_BROKER_ACTIVATOR, D3_BROKER_NODE, `${D3_BROKER_SERVER}/package.json`, `${D3_BROKER_SERVER}/package-lock.json`, ...D3_BROKER_MODULES, ...await zodPaths()].sort(); if (digest(paths) !== digest(inventory.files.map(({ path }) => path))) throw failed();
    for (const expected of inventory.files) { if (digest(await identity(expected.path)) !== digest(expected)) throw failed(); if (expected.path === D3_BROKER_ACTIVATOR ? expected.uid !== 0 || expected.gid !== 0 || expected.mode !== '0755' || expected.sha256 !== '233891550408117482cf5e6fac4a8cb13c99df62eb8849b14dbd76f8b2f2b7de' : expected.uid !== process.getuid?.() || expected.gid !== process.getgid?.() || (Number.parseInt(expected.mode, 8) & 0o002)) throw failed(); }
    const node = inventory.files.find(({ path }) => path === D3_BROKER_NODE), pkg = inventory.files.find(({ path }) => path === `${D3_BROKER_SERVER}/node_modules/zod/package.json`); if (node?.sha256 !== '6295488653f0d93b0a157841746fef7e72cc4328cfb60c4bbe0ca2668a836ffd' || pkg?.sha256 !== '70eedbe34fd52385a4ae2f3e5759b19682189f0118ea73a6e7c32c677f61668e') throw failed();
    const imports = await readD3BrokerStaticImports(inventory.modulePaths); if (digest(imports.builtins) !== digest(inventory.builtins) || digest(imports.bare) !== digest(inventory.bare) || digest(await resolveD3BrokerBareImports({ serverRoot: D3_BROKER_SERVER, modulePaths: inventory.modulePaths, imports: imports.imports, files: inventory.files })) !== digest(inventory.bareResolutions)) throw failed();
    return inventory;
  } catch { throw failed(); }
}
