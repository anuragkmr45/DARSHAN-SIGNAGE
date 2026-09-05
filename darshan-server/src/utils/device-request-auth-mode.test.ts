import { afterEach, describe, expect, it, vi } from 'vitest';

const mockedConfig = vi.hoisted(() => ({
  NODE_ENV: 'production',
  DEVICE_AUTH_MODE: 'signature',
  DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT: '2000-01-01T00:00:00.000Z',
  DEVICE_AUTH_SIGNATURE_MAX_SKEW_SECONDS: 300,
}));

vi.mock('@/config', () => ({ config: mockedConfig }));

import {
  isDeviceLegacyAuthCompatibilityActive,
  resolveDeviceAuthMode,
} from './device-request-auth';

const overrideNames = [
  'DARSHAN_DEVICE_AUTH_MODE',
  'HEXMON_DEVICE_AUTH_MODE',
  'DEVICE_AUTH_MODE',
] as const;
const originalEnvironment = Object.fromEntries(overrideNames.map((name) => [name, process.env[name]]));

function restoreEnvironment() {
  for (const name of overrideNames) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

describe('device authentication compatibility deadline', () => {
  afterEach(() => {
    restoreEnvironment();
    mockedConfig.NODE_ENV = 'production';
    mockedConfig.DEVICE_AUTH_MODE = 'signature';
    mockedConfig.DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT = '2000-01-01T00:00:00.000Z';
  });

  it('does not let a legacy alias keep a dual production rollout active after its deadline', () => {
    process.env.DARSHAN_DEVICE_AUTH_MODE = 'dual';

    expect(isDeviceLegacyAuthCompatibilityActive()).toBe(false);
    expect(resolveDeviceAuthMode()).toBe('signature');
  });

  it('keeps a dual rollout active only before its configured deadline', () => {
    mockedConfig.DEVICE_AUTH_MODE = 'dual';
    mockedConfig.DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT = '2099-01-01T00:00:00.000Z';

    expect(isDeviceLegacyAuthCompatibilityActive(Date.parse('2098-12-31T23:59:59.000Z'))).toBe(true);
    expect(isDeviceLegacyAuthCompatibilityActive(Date.parse('2099-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('never honors production legacy-only aliases', () => {
    process.env.HEXMON_DEVICE_AUTH_MODE = 'legacy';

    expect(resolveDeviceAuthMode()).toBe('signature');
  });
});
