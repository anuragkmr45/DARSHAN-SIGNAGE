import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBackendRuntimeEnv,
  buildRedactedRuntimeConfigSummary,
  loadBackendFileConfigEnv,
  resolveBackendConfigFileSelector,
  resolveBackendProfileSelector,
} from './file-config';

function makeTempConfigFile(contents: unknown, name = 'backend-config.json') {
  const dir = mkdtempSync(path.join(tmpdir(), 'darshan-backend-config-'));
  const filePath = path.join(dir, name);
  writeFileSync(filePath, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  return filePath;
}

describe('backend file config loader', () => {
  it('keeps env behavior when no config file is selected', () => {
    const runtime = buildBackendRuntimeEnv({
      DATABASE_URL: 'postgresql://user:pass@example.local:5432/darshan',
      SIGNHEX_ENVIRONMENT_NAME: 'env-value',
    });

    expect(runtime.diagnostics.configFile.configured).toBe(false);
    expect(runtime.diagnostics.configFile.loaded).toBe(false);
    expect(runtime.env.DATABASE_URL).toBe('postgresql://user:pass@example.local:5432/darshan');
    expect(runtime.env.SIGNHEX_ENVIRONMENT_NAME).toBe('env-value');
  });

  it('loads DARSHAN_CONFIG_FILE JSON config', () => {
    const configFile = makeTempConfigFile({
      environment: {
        name: 'onprem-qa',
        deploymentId: 'qa-lab-1',
        serverId: 'backend-a',
      },
      realtime: {
        busProvider: 'valkey',
        socketTransport: 'websocket',
        socketAllowPolling: false,
      },
      duplicateIdentity: {
        enabled: true,
        enforcement: 'warn',
        sessionLeaseMs: 300000,
        restartGraceMs: 120000,
      },
      valkey: {
        mode: 'standalone',
        tlsEnabled: false,
        namespace: 'darshan:qa',
      },
    });

    const loaded = loadBackendFileConfigEnv({ DARSHAN_CONFIG_FILE: configFile });

    expect(loaded.diagnostics.configFile.loaded).toBe(true);
    expect(loaded.diagnostics.configFile.source).toBe('DARSHAN_CONFIG_FILE');
    expect(loaded.env.SIGNHEX_ENVIRONMENT_NAME).toBe('onprem-qa');
    expect(loaded.env.SIGNHEX_DEPLOYMENT_ID).toBe('qa-lab-1');
    expect(loaded.env.SIGNHEX_SERVER_ID).toBe('backend-a');
    expect(loaded.env.REALTIME_BUS_PROVIDER).toBe('valkey');
    expect(loaded.env.REALTIME_SOCKET_ALLOW_POLLING).toBe('false');
    expect(loaded.env.DUPLICATE_IDENTITY_ENFORCEMENT).toBe('warn');
    expect(loaded.env.VALKEY_NAMESPACE).toBe('darshan:qa');
  });

  it('loads SIGNHEX_CONFIG_FILE when DARSHAN_CONFIG_FILE is absent', () => {
    const configFile = makeTempConfigFile({
      environment: {
        name: 'qa',
      },
    });

    const loaded = loadBackendFileConfigEnv({ SIGNHEX_CONFIG_FILE: configFile });

    expect(loaded.diagnostics.configFile.source).toBe('SIGNHEX_CONFIG_FILE');
    expect(loaded.env.SIGNHEX_ENVIRONMENT_NAME).toBe('qa');
  });

  it('allows both selectors when they point to the same resolved path', () => {
    const configFile = makeTempConfigFile({
      environment: {
        name: 'qa',
      },
    });

    const selector = resolveBackendConfigFileSelector({
      DARSHAN_CONFIG_FILE: configFile,
      SIGNHEX_CONFIG_FILE: path.relative(process.cwd(), configFile),
    });

    expect(selector.source).toBe('both');
    expect(selector.path).toBe(path.resolve(configFile));
  });

  it('fails fast when selectors point to different files', () => {
    expect(() =>
      resolveBackendConfigFileSelector({
        DARSHAN_CONFIG_FILE: '/tmp/backend-a.json',
        SIGNHEX_CONFIG_FILE: '/tmp/backend-b.json',
      })
    ).toThrow(/different backend config files/);
  });

  it('uses DARSHAN_ENV or SIGNHEX_ENV for labels without changing NODE_ENV', () => {
    expect(resolveBackendProfileSelector({ DARSHAN_ENV: 'qa', NODE_ENV: 'production' })).toEqual({
      name: 'qa',
      source: 'DARSHAN_ENV',
    });
    expect(resolveBackendProfileSelector({ SIGNHEX_ENV: 'staging', NODE_ENV: 'production' })).toEqual({
      name: 'staging',
      source: 'SIGNHEX_ENV',
    });
    expect(resolveBackendProfileSelector({ NODE_ENV: 'production' })).toEqual({
      name: 'production',
      source: 'NODE_ENV',
    });
  });

  it('fails fast when environment aliases select different profiles', () => {
    expect(() => resolveBackendProfileSelector({ DARSHAN_ENV: 'qa', SIGNHEX_ENV: 'prod' })).toThrow(
      /select different backend environments/
    );
  });

  it('lets env vars override config file values', () => {
    const configFile = makeTempConfigFile({
      environment: {
        name: 'from-file',
      },
      duplicateIdentity: {
        enforcement: 'block',
      },
    });

    const runtime = buildBackendRuntimeEnv({
      DARSHAN_CONFIG_FILE: configFile,
      SIGNHEX_ENVIRONMENT_NAME: 'from-env',
      DUPLICATE_IDENTITY_ENFORCEMENT: 'warn',
    });

    expect(runtime.env.SIGNHEX_ENVIRONMENT_NAME).toBe('from-env');
    expect(runtime.env.DUPLICATE_IDENTITY_ENFORCEMENT).toBe('warn');
  });

  it('fails clearly on invalid JSON', () => {
    const configFile = makeTempConfigFile('{ not json');

    expect(() => loadBackendFileConfigEnv({ DARSHAN_CONFIG_FILE: configFile })).toThrow(
      /Invalid backend config JSON/
    );
  });

  it('rejects unknown keys', () => {
    const configFile = makeTempConfigFile({
      unknown: true,
    });

    expect(() => loadBackendFileConfigEnv({ DARSHAN_CONFIG_FILE: configFile })).toThrow(
      /Invalid backend config file/
    );
  });

  it('rejects secret-looking keys in config files before validation', () => {
    const configFile = makeTempConfigFile({
      environment: {
        name: 'qa',
      },
      jwtSecret: 'must-not-be-here',
    });

    expect(() => loadBackendFileConfigEnv({ DARSHAN_CONFIG_FILE: configFile })).toThrow(
      /secret-like key "jwtSecret"/
    );
  });

  it('rejects credentialed URLs in non-secret config fields', () => {
    const configFile = makeTempConfigFile({
      observability: {
        prometheusUrl: 'http://user:pass@prometheus.local:9090',
      },
    });

    expect(() => loadBackendFileConfigEnv({ DARSHAN_CONFIG_FILE: configFile })).toThrow(
      /must not include credentials/
    );
  });

  it('maps media endpoint into existing MinIO env-compatible keys', () => {
    const configFile = makeTempConfigFile({
      media: {
        endpoint: 'https://minio.local:9443',
        region: 'us-east-1',
      },
    });

    const loaded = loadBackendFileConfigEnv({ DARSHAN_CONFIG_FILE: configFile });

    expect(loaded.env.MINIO_ENDPOINT).toBe('minio.local');
    expect(loaded.env.MINIO_PORT).toBe('9443');
    expect(loaded.env.MINIO_USE_SSL).toBe('true');
    expect(loaded.env.MINIO_REGION).toBe('us-east-1');
  });

  it('builds a redacted diagnostics summary without secret values', () => {
    const summary = buildRedactedRuntimeConfigSummary(
      {
        DATABASE_URL: 'postgresql://user:secret@localhost:5432/darshan',
        JWT_SECRET: 'super-secret-token-value',
        VALKEY_URL: 'redis://:secret@valkey.local:6379',
        SIGNHEX_ENVIRONMENT_NAME: 'qa',
        SIGNHEX_DEPLOYMENT_ID: 'qa-lab-1',
        SIGNHEX_SERVER_ID: 'backend-a',
        DUPLICATE_IDENTITY_DETECTION_ENABLED: true,
        DUPLICATE_IDENTITY_ENFORCEMENT: 'warn',
        DEVICE_SESSION_LEASE_MS: 300000,
        DEVICE_SESSION_RESTART_GRACE_MS: 120000,
        REALTIME_BUS_PROVIDER: 'valkey',
        REALTIME_SOCKET_TRANSPORT: 'websocket',
        REALTIME_WS_PATH: '/socket.io/',
        VALKEY_MODE: 'standalone',
        VALKEY_TLS_ENABLED: false,
        VALKEY_AUTH_REQUIRED: true,
        VALKEY_NAMESPACE: 'darshan:qa',
        OBSERVABILITY_PROMETHEUS_BASE_URL: 'http://prometheus.local:9090',
      },
      {
        configFile: {
          configured: true,
          loaded: true,
          source: 'DARSHAN_CONFIG_FILE',
          path: '/etc/darshan/server/config.qa.json',
          format: 'json',
        },
        profile: {
          name: 'qa',
          source: 'DARSHAN_ENV',
        },
        mappedEnvKeys: ['SIGNHEX_ENVIRONMENT_NAME'],
      }
    );

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('super-secret-token-value');
    expect(serialized).not.toContain('user:secret');
    expect(serialized).not.toContain('redis://:secret');
    expect(summary.valkey.urlConfigured).toBe(true);
    expect(summary.redaction.secretValuesIncluded).toBe(false);
  });

  it('rejects YAML in CONFIG-1 because no YAML parser is bundled', () => {
    const configFile = makeTempConfigFile('environment:\n  name: qa\n', 'backend-config.yaml');

    expect(() => loadBackendFileConfigEnv({ DARSHAN_CONFIG_FILE: configFile })).toThrow(
      /supports JSON files only/
    );
  });
});
