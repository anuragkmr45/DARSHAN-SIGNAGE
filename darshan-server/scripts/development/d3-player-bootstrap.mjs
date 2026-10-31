import { spawn } from 'node:child_process';

const electron = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player/node_modules/electron/dist/electron';
const application = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-player';
const root = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/player';
const supported = { NODE_ENV: 'production', HOME: `${root}/home`, DISPLAY: ':0', DARSHAN_RUNTIME_ROOT: root, DARSHAN_CONFIG_PATH: `${root}/config/runtime.json`,
  DARSHAN_PLAYER_CONFIG_FILE: `${root}/config/player.json`, DARSHAN_CACHE_PATH: `${root}/cache`, DARSHAN_MTLS_CERT_DIR: `${root}/certs`, DARSHAN_AUTOSTART_ENABLED: 'false',
  DARSHAN_POWER_DPMS_ENABLED: 'false', DARSHAN_POWER_PREVENT_BLANKING: 'false', DARSHAN_POWER_SCHEDULE_ENABLED: 'false', DARSHAN_API_BASE_URL: 'https://127.0.0.1:18441',
  DARSHAN_REALTIME_WS_URL: 'wss://127.0.0.1:18441', DARSHAN_TRANSPORT_TLS_ENABLED: 'true', DARSHAN_TRANSPORT_TLS_CA_PATH: `${root}/certs/ca.crt` };
Object.assign(process.env, supported); const { ConfigManager } = await import('../../../darshan-player/dist/main/common/config.js'); const manager = new ConfigManager(supported.DARSHAN_CONFIG_PATH);
const resolved = manager.getConfig(); const paths = manager.getRuntimePaths(); if (paths.runtimeRoot !== root || paths.cachePath !== supported.DARSHAN_CACHE_PATH || paths.certDir !== supported.DARSHAN_MTLS_CERT_DIR ||
  resolved.power.dpmsEnabled !== false || resolved.power.preventBlanking !== false || resolved.power.scheduleEnabled !== false || resolved.apiBase !== supported.DARSHAN_API_BASE_URL) throw new Error('D3 resolved player settings differ');
const child = spawn(electron, [application, `--user-data-dir=${root}/user-data`, '--no-sandbox', '--disable-gpu-sandbox'], { cwd: root, stdio: 'inherit',
  env: { PATH: '/usr/bin:/bin', ...supported } });
const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => signal ? reject(new Error(`Electron terminated by ${signal}`)) : resolve(code ?? 1)); });
process.exitCode = Number(exitCode);
