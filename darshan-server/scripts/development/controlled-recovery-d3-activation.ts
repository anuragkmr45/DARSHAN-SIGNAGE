import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const asset = z.object({ role: z.enum(['packet-b-adapter', 'packet-c-adapter', 'checked-in-mp4', 'd3-runtime-profile', 'd3-runtime-schema',
  'd3-source-profile', 'd3-source-state', 'd3-source-services', 'd3-source-backup', 'd3-source-docker',
  'd3-source-process', 'd3-source-enrollment', 'd3-source-crypto', 'd3-source-layout', 'd3-source-volumes', 'd3-source-executor', 'd3-source-health',
  'd3-source-installed', 'd3-source-cli',
  'd3-source-data-profile', 'd3-source-data-profile-json', 'd3-source-data-schema', 'd3-source-data', 'd3-source-data-clients', 'd3-source-data-fixtures', 'd3-source-seal', 'd3-fixtures',
  'd3-capsule-profile', 'd3-capsule-profile-json', 'd3-capsule-schema', 'd3-capsule-files', 'd3-capsule-material', 'd3-capsule-crypto', 'd3-capsule-render', 'd3-capsule', 'd3-age-staging', 'd3-age-legacy-handoff', 'd3-capsule-installed', 'd3-capsule-activation-json', 'd3-capsule-activation-schema',
  'd3-reservation-contract', 'd3-reservation-control', 'd3-reservation-profile', 'd3-reservation-profile-json', 'd3-reservation-schema', 'd3-reservation-ddl', 'd3-reservation-prerequisites', 'd3-reservation', 'backup-coordination', 'backup-coordination-transaction',
  'd3-broker-enrollment', 'd3-broker-profile', 'd3-broker-profile-json', 'd3-broker-schema', 'd3-broker-dependencies', 'd3-broker-prerequisites', 'd3-broker-process', 'd3-broker-host', 'd3-broker-storage', 'd3-broker',
  'd3-recovery-prefix-contract', 'd3-recovery-prefix-clients', 'd3-recovery-prefix', 'd3-recovery-prefix-enrollment', 'd3-recovery-prefix-schema',
  'd3-capture-profile', 'd3-capture-profile-json', 'd3-capture-schema', 'd3-capture-spool', 'd3-capture-tools', 'd3-capture-objects', 'd3-capture-package', 'd3-capture',
  'd3-backup-profile', 'd3-backup-state', 'd3-backup-capabilities', 'd3-backup-scope', 'd3-backup-sql', 'd3-backup-evidence', 'd3-backup-installed', 'd3-backup-scoped', 'd3-backup-cli', 'backup-coordination-attempt', 'backup-brokered-orchestrator', 'backup-publication-store', 'backup-consistent-capture', 'backup-maintenance-store', 'd3-backup-profile-json', 'd3-backup-profile-schema', 'd3-backup-capabilities-activation-json', 'd3-backup-capabilities-activation-schema', 'd3-backup-publication-activation-json', 'd3-backup-publication-activation-schema',
  'd3-foundation', 'd3-operation-authority', 'd3-age-identity', 'd3-execution', 'd3-publication', 'd3-protected-files', 'd3-backup', 'd3-activation', 'd3-process', 'd3-effects',
  'd3-composition', 'd3-cms-launcher', 'd3-browser-launcher', 'd3-player-launcher', 'd3-controller-launcher', 'd3-controller-runtime', 'd4-container-tool-runner', 'd4-tools-image-command']),
  path: z.string().startsWith('/').refine((value) => !value.includes('.example')), sha256: sha }).strict();
const toolRole = z.enum(['node20', 'playwright-package', 'playwright-api', 'playwright-cli', 'playwright-browser-catalog', 'playwright-chromium', 'electron-package', 'electron-player']);
const toolBase = z.object({ role: toolRole, path: z.string().startsWith('/').max(512), resolved_path: z.string().startsWith('/').max(512), executable: z.boolean() });
const tool = z.discriminatedUnion('enrolled', [
  toolBase.extend({ enrolled: z.literal(true), sha256: sha, version: z.string().min(1).max(128) }).strict(),
  toolBase.extend({ enrolled: z.literal(false), sha256: z.null(), version: z.null() }).strict(),
]);
const containerToolsBase = z.object({ lock_path: z.literal('/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tools/tool-image.lock.json'), lock_sha256: sha,
  dockerfile_path: z.literal('/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tools/Dockerfile'), dockerfile_sha256: sha,
  base_reference: z.literal('postgres:16-alpine'), base_repo_digest: z.literal('postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'),
  wrapper_path: z.literal('/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tools/darshan-d3-tool.c'), wrapper_sha256: sha,
  wrapper_binary_path: z.literal('/usr/local/bin/darshan-d3-tool'), build_base_apk_version: z.literal('0.5-r4'),
  image_reference: z.literal('darshan-d3-tools:packet-d4') });
const containerTools = z.discriminatedUnion('enrolled', [
  containerToolsBase.extend({ enrolled: z.literal(false), image_id: z.null(), repo_digest: z.null(), config_sha256: z.null(), wrapper_binary_sha256: z.null(),
    age_package_version: z.string().regex(/^[A-Za-z0-9.+_~-]+-r[0-9]+$/).nullable(), ffmpeg_package_version: z.string().regex(/^[A-Za-z0-9.+_~-]+-r[0-9]+$/).nullable() }).strict(),
  containerToolsBase.extend({ enrolled: z.literal(true), image_id: z.string().regex(/^sha256:[a-f0-9]{64}$/), repo_digest: z.string().regex(/^darshan-d3-tools@sha256:[a-f0-9]{64}$/), config_sha256: sha,
    age_package_version: z.string().regex(/^[A-Za-z0-9.+_~-]+-r[0-9]+$/), ffmpeg_package_version: z.string().regex(/^[A-Za-z0-9.+_~-]+-r[0-9]+$/), wrapper_binary_sha256: sha }).strict(),
]);
export const developmentD3ActivationSchema = z.object({
  format: z.literal('darshan-controlled-recovery-development-d3-v1'), enabled: z.boolean(), non_production: z.literal(true),
  d1_activation_sha256: sha, d2_activation_sha256: sha, packet_assets: z.array(asset).length(111), tools: z.array(tool).length(8), container_tools: containerTools,
  loopback_ports: z.object({ api: z.literal(18441), device: z.literal(18442), cms: z.literal(18443) }).strict(), firefox_untouched: z.literal(true),
}).strict();
export type DevelopmentD3Activation = z.infer<typeof developmentD3ActivationSchema>;
export const DEVELOPMENT_D3_ACTIVATION_PATH = fileURLToPath(new URL('../../../deploy/development/controlled-recovery/tiny-e2e-d3.activation.json', import.meta.url));
export const DEVELOPMENT_D3_TOOL_CONTRACTS = Object.freeze({
  node20: { path: '/home/hexmon/.nvm/versions/node/v20.20.2/bin/node', executable: true, enrolled: true, version: 'v20.20.2' },
  'playwright-package': { path: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/node_modules/playwright/package.json', executable: false, enrolled: true, version: '1.58.2' },
  'playwright-api': { path: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/node_modules/playwright/index.mjs', executable: false, enrolled: true, version: '1.58.2' },
  'playwright-cli': { path: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/node_modules/playwright/cli.js', executable: true, enrolled: true, version: '1.58.2' },
  'playwright-browser-catalog': { path: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-cms/node_modules/playwright-core/browsers.json', executable: false, enrolled: true, version: 'chromium-headless-shell@1208/145.0.7632.6' },
  'playwright-chromium': { path: '/home/hexmon/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell', executable: true, enrolled: true, version: 'Google Chrome for Testing 145.0.7632.6' },
  'electron-package': { path: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player/node_modules/electron/package.json', executable: false, enrolled: true, version: '33.4.11' },
  'electron-player': { path: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player/node_modules/electron/dist/electron', executable: true, enrolled: true, version: 'v33.4.11' },
} satisfies Record<z.infer<typeof toolRole>, { path: string; executable: boolean; enrolled: boolean; version: string | null }>);

export async function loadDevelopmentD3Activation(): Promise<DevelopmentD3Activation> {
  const handle = await open(DEVELOPMENT_D3_ACTIVATION_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o664 || stat.size > 128 * 1024)
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_ACTIVATION_UNSAFE', 'Fixed D3 activation identity differs.');
    const bytes = await handle.readFile(); const value = developmentD3ActivationSchema.parse(parseStrictJson(bytes, 128 * 1024));
    if (!canonicalJson(value).equals(bytes)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_ACTIVATION_INVALID', 'D3 activation is not canonical JSON.'); return value;
  } finally { await handle.close(); }
}

async function hashHandle(handle: Awaited<ReturnType<typeof open>>): Promise<string> { const hash = createHash('sha256');
  for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); return hash.digest('hex'); }

export async function verifyDevelopmentD3Tools(value: DevelopmentD3Activation): Promise<string> {
  if (new Set(value.tools.map(({ role }) => role)).size !== Object.keys(DEVELOPMENT_D3_TOOL_CONTRACTS).length)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE', 'D3 tool roles are incomplete or duplicated.');
  for (const item of value.tools) { const expected = DEVELOPMENT_D3_TOOL_CONTRACTS[item.role];
    if (item.path !== expected.path || item.resolved_path !== expected.path || item.executable !== expected.executable || item.enrolled !== expected.enrolled || item.version !== expected.version)
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE', 'A D3 tool contract differs from the reviewed fixed identity.');
    if (!item.enrolled) continue;
    let handle; try { handle = await open(item.path, constants.O_RDONLY | constants.O_NOFOLLOW); const stat = await handle.stat(); const resolved = await realpath(item.path);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || resolved !== item.resolved_path || (stat.mode & 0o002) !== 0 || item.executable !== ((stat.mode & 0o111) !== 0) || stat.size > 256 * 1024 * 1024 || await hashHandle(handle) !== item.sha256)
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE', 'An enrolled D3 tool file identity changed.');
    } catch (cause) { if (cause instanceof ControlledRecoveryError) throw cause; throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE', 'An enrolled D3 tool is unavailable.', { cause }); }
    finally { await handle?.close(); } }
  const byRole = Object.fromEntries(value.tools.map((item) => [item.role, item]));
  const playwrightPackage = JSON.parse(await readFile(byRole['playwright-package']!.path, 'utf8')) as { name?: string; version?: string };
  const browserCatalog = JSON.parse(await readFile(byRole['playwright-browser-catalog']!.path, 'utf8')) as { browsers?: Array<{ name?: string; revision?: string; browserVersion?: string }> };
  const electronPackage = JSON.parse(await readFile(byRole['electron-package']!.path, 'utf8')) as { name?: string; version?: string };
  const browser = browserCatalog.browsers?.find(({ name }) => name === 'chromium-headless-shell');
  if (playwrightPackage.name !== 'playwright' || playwrightPackage.version !== '1.58.2' || browser?.revision !== '1208' || browser?.browserVersion !== '145.0.7632.6' ||
      electronPackage.name !== 'electron' || electronPackage.version !== '33.4.11') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE', 'An enrolled D3 package/version contract changed.');
  return digest(value.tools.map(({ role, resolved_path, sha256: valueSha256, version }) => ({ role, resolved_path, sha256: valueSha256, version })));
}

async function verifyDevelopmentD3ContainerTools(value: DevelopmentD3Activation): Promise<void> { const authority = value.container_tools;
  for (const [path, expected] of [[authority.dockerfile_path, authority.dockerfile_sha256], [authority.lock_path, authority.lock_sha256], [authority.wrapper_path, authority.wrapper_sha256]] as const) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || sha256(await handle.readFile()) !== expected) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_UNAVAILABLE', 'A fixed D4 tools-image source identity changed.'); }
    finally { await handle.close(); } }
  const lockBytes = await readFile(authority.lock_path); const lock = parseStrictJson(lockBytes, 128 * 1024) as Record<string, unknown>;
  if (!canonicalJson(lock).equals(lockBytes)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_UNAVAILABLE', 'The fixed D4 tools-image lock is not canonical.');
  const expectedLock = { base: { reference: authority.base_reference, repo_digest: authority.base_repo_digest }, dockerfile: { path: authority.dockerfile_path, sha256: authority.dockerfile_sha256 },
    enrolled: authority.enrolled, format: 'darshan-controlled-recovery-d4-tools-lock-v1', image: { config_sha256: authority.config_sha256, image_id: authority.image_id, reference: authority.image_reference, repo_digest: authority.repo_digest },
    wrapper: { source_path: authority.wrapper_path, source_sha256: authority.wrapper_sha256, binary_path: authority.wrapper_binary_path, binary_sha256: authority.wrapper_binary_sha256, umask: '0077' },
    build_dependencies: { apk: 'build-base', version: authority.build_base_apk_version },
    packages: { age: { apk: 'age', version: authority.age_package_version }, ffmpeg: { apk: 'ffmpeg', version: authority.ffmpeg_package_version } } };
  if (!canonicalJson(lock).equals(canonicalJson(expectedLock))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D4_TOOLS_IMAGE_UNAVAILABLE', 'The D3 activation and D4 tools-image lock differ.');
}

export async function verifyDevelopmentD3PacketAssets(value: DevelopmentD3Activation) {
  if (new Set(value.packet_assets.map(({ role }) => role)).size !== 111) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PACKET_ASSET_CHANGED', 'D3 foundation asset roles are duplicated.');
  for (const [path, expected] of [['/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-readiness.activation.json', value.d1_activation_sha256],
    ['/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-e2e-d2.activation.json', value.d2_activation_sha256]] as const) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || sha256(await handle.readFile()) !== expected) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_ACTIVATION_INVALID', 'A prior development activation identity changed.'); }
    finally { await handle.close(); } }
  await verifyDevelopmentD3Tools(value);
  await verifyDevelopmentD3ContainerTools(value);
  for (const item of value.packet_assets) { const handle = await open(item.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024 * 1024 || sha256(await handle.readFile()) !== item.sha256)
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PACKET_ASSET_CHANGED', 'A fixed Packet A/B/C development asset changed.'); } finally { await handle.close(); } }
  const byRole = Object.fromEntries(value.packet_assets.map((item) => [item.role, item.sha256]));
  // These are foundation enrollment receipts, not claims that Packet A/B/C workflow dependencies exist.
  const evidence = { developmentProfileSha256: byRole['d3-runtime-profile'], developmentProfileSchemaSha256: byRole['d3-runtime-schema'],
    packetBAdapterSha256: byRole['packet-b-adapter'], packetCAdapterSha256: byRole['packet-c-adapter'] };
  return { profileSha256: digest(evidence), evidence };
}

