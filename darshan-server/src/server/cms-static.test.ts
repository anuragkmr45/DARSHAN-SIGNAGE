import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerCmsStaticRoutes } from './cms-static';

function makeCmsBuild() {
  const root = mkdtempSync(path.join(tmpdir(), 'darshan-cms-static-'));
  mkdirSync(path.join(root, 'assets'));
  mkdirSync(path.join(root, 'config'));
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>DARSHAN</title>');
  writeFileSync(path.join(root, 'assets', 'app-abc123.js'), 'globalThis.loaded=true;');
  writeFileSync(path.join(root, 'config', 'app-config.json'), '{"name":"cloud"}');
  return root;
}

describe('CMS static routes', () => {
  it('serves the CMS, immutable assets, runtime config, and SPA routes', async () => {
    const app = Fastify();
    await registerCmsStaticRoutes(app, makeCmsBuild());

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('<title>DARSHAN</title>');
    expect(home.headers['cache-control']).toBe('no-cache');

    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');

    const config = await app.inject({ method: 'GET', url: '/config/app-config.json' });
    expect(config.statusCode).toBe(200);
    expect(config.headers['cache-control']).toBe('no-store');

    const spa = await app.inject({ method: 'GET', url: '/screens', headers: { accept: 'text/html' } });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('<title>DARSHAN</title>');

    await app.close();
  });

  it('does not turn missing assets or reserved API paths into the SPA shell', async () => {
    const app = Fastify();
    await registerCmsStaticRoutes(app, makeCmsBuild());

    expect((await app.inject({ method: 'GET', url: '/assets/missing.js', headers: { accept: 'text/html' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/missing', headers: { accept: 'text/html' } })).statusCode).toBe(404);

    await app.close();
  });
});
