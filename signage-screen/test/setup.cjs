/**
 * Test setup and global configuration (CJS)
 */

const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'development';
process.env.HEXMON_CONFIG_PATH = path.join(__dirname, 'fixtures', 'test-config.json');

const testDirs = [
  path.join(__dirname, 'fixtures'),
  path.join(__dirname, 'fixtures', 'cache'),
  path.join(__dirname, 'fixtures', 'certs'),
  path.join(__dirname, 'fixtures', 'logs'),
];

for (const dir of testDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

if (process.env.SUPPRESS_LOGS === 'true') {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
}

const DEFAULT_TIMEOUT = 5000;
if (typeof global.setTimeout !== 'undefined') {
  global.testTimeout = DEFAULT_TIMEOUT;
}
