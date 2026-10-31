import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';

export const D3_PLAYER_BOOTSTRAP = Object.freeze({ packageManifest: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player/node_modules/electron/package.json', packageVersion: '33.4.11',
  executable: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player/node_modules/electron/dist/electron', executableVersion: 'v33.4.11',
  application: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player', display: ':0', userDataDir: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/player/user-data',
  configRoot: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/player/config', flags: ['--no-sandbox', '--disable-gpu-sandbox'],
  supportedSelectors: { runtimeRoot: 'DARSHAN_RUNTIME_ROOT', configPath: 'DARSHAN_CONFIG_PATH', playerConfigFile: 'DARSHAN_PLAYER_CONFIG_FILE', cachePath: 'DARSHAN_CACHE_PATH', certDir: 'DARSHAN_MTLS_CERT_DIR',
    autostart: 'DARSHAN_AUTOSTART_ENABLED', dpms: 'DARSHAN_POWER_DPMS_ENABLED', preventBlanking: 'DARSHAN_POWER_PREVENT_BLANKING', powerSchedule: 'DARSHAN_POWER_SCHEDULE_ENABLED' },
  disableEffects: ['autostart', 'dpms', 'power-management', 'screen-blanking'] });
export interface D3PlayerBoundary { displayAvailable(display: ':0'): Promise<boolean>; executableIdentity(path: string): Promise<{ sha256: string; executable: boolean } | null>;
  runIsolated(input: typeof D3_PLAYER_BOOTSTRAP): Promise<{ exitCode: number; cases: readonly string[]; evidenceSha256: string }> }
export async function runD3Player(boundary: D3PlayerBoundary, expectedExecutableSha256: string) { if (!await boundary.displayAvailable(':0')) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PLAYER_DISPLAY_UNAVAILABLE', 'DISPLAY=:0 is unavailable.');
  const identity = await boundary.executableIdentity(D3_PLAYER_BOOTSTRAP.executable); if (!identity?.executable || identity.sha256 !== expectedExecutableSha256)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PLAYER_UNAVAILABLE', 'Exact Electron player is unavailable.');
  const result = await boundary.runIsolated(D3_PLAYER_BOOTSTRAP); const required = ['IMAGE', 'VIDEO_LOOP', 'PDF_PAGE_2', 'LAYOUT_PRESENTATION', 'SCHEDULE_DEFAULT', 'EMERGENCY_LOOP', 'OFFLINE_WEBPAGE'];
  if (result.exitCode !== 0 || required.some((value) => !result.cases.includes(value))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PLAYER_VALIDATION_FAILED', 'Actual isolated Electron validation failed.'); return { ...result, bootstrapSha256: digest(D3_PLAYER_BOOTSTRAP) }; }
