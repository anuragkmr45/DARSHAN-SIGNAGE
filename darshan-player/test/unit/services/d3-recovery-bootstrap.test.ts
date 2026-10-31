const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')

const original = { ...process.env }; const roots = [];
afterEach(() => { process.env = { ...original }; while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); Object.keys(require.cache).filter((key) => key.includes('/src/common/')).forEach((key) => delete require.cache[key]) });

describe('D3 isolated player bootstrap contract', () => {
  it('resolves supported runtime/cache/cert/config selectors and disables autostart and every power effect', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-player-d3-')); roots.push(root); fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    const playerFile = path.join(root, 'config/player.json'); fs.writeFileSync(playerFile, JSON.stringify({ player: { runtime: { mode: 'production' }, backend: { baseUrl: 'https://127.0.0.1:18441', socketIoUrl: 'wss://127.0.0.1:18441' }, cache: { maxBytes: 104857600 } } }));
    Object.assign(process.env, { NODE_ENV: 'production', DARSHAN_RUNTIME_ROOT: root, DARSHAN_CONFIG_PATH: path.join(root, 'config/runtime.json'), DARSHAN_PLAYER_CONFIG_FILE: playerFile,
      DARSHAN_CACHE_PATH: path.join(root, 'cache'), DARSHAN_MTLS_CERT_DIR: path.join(root, 'certs'), DARSHAN_AUTOSTART_ENABLED: 'false', DARSHAN_POWER_DPMS_ENABLED: 'false',
      DARSHAN_POWER_PREVENT_BLANKING: 'false', DARSHAN_POWER_SCHEDULE_ENABLED: 'false', DARSHAN_API_BASE_URL: 'https://127.0.0.1:18441' });
    const { ConfigManager } = require('../../../src/common/config.ts'); const manager = new ConfigManager(process.env.DARSHAN_CONFIG_PATH); expect(manager.getRuntimePaths()).to.include({ runtimeRoot: root, cachePath: path.join(root, 'cache'), certDir: path.join(root, 'certs') });
    expect(manager.getConfig().apiBase).to.equal('https://127.0.0.1:18441'); expect(manager.getConfig().runtime.mode).to.equal('production'); expect(manager.getConfig().power).to.include({ dpmsEnabled: false, preventBlanking: false, scheduleEnabled: false });
    expect(process.env.DARSHAN_AUTOSTART_ENABLED).to.equal('false');
  });
});
