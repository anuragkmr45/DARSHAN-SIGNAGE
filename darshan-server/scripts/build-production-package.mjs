import fs from 'node:fs';

const source = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const scripts = Object.fromEntries(Object.entries(source.scripts).filter(([name]) => (
  name === 'start' || name === 'start:api' || name === 'start:worker' || name === 'start:backup-broker' || name.startsWith('production:')
)));
const runtimePackage = {
  name: source.name,
  version: source.version,
  private: true,
  type: source.type,
  main: source.main,
  scripts,
  dependencies: source.dependencies,
  engines: source.engines,
};
process.stdout.write(`${JSON.stringify(runtimePackage, null, 2)}\n`);
