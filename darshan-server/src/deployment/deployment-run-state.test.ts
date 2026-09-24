import { describe, expect, it } from 'vitest';
import { expectedDeploymentStep } from './deployment-run-state';

describe('deployment run transition contract', () => {
  it('keeps fresh installation incomplete until full CMS acceptance', () => {
    expect(expectedDeploymentStep('INSTALL', 'BEGIN')).toBe('MIGRATIONS_APPLIED');
    expect(expectedDeploymentStep('INSTALL', 'BACKEND_READY')).toBe('BACKEND_ACCEPTED');
    expect(expectedDeploymentStep('INSTALL', 'BACKEND_ACCEPTED')).toBe('FULL_ACCEPTANCE_COMPLETE');
    expect(expectedDeploymentStep('INSTALL', 'FULL_ACCEPTANCE_COMPLETE')).toBeNull();
  });

  it('models maintenance-window upgrade and explicit adoption separately', () => {
    expect(expectedDeploymentStep('UPGRADE', 'BEGIN')).toBe('MAINTENANCE_STARTED');
    expect(expectedDeploymentStep('UPGRADE', 'MAINTENANCE_STARTED')).toBe('MIGRATIONS_APPLIED');
    expect(expectedDeploymentStep('UPGRADE', 'MIGRATIONS_APPLIED')).toBe('BACKEND_READY');
    expect(expectedDeploymentStep('ADOPT', 'BEGIN')).toBe('DATABASE_ADOPTED');
    expect(expectedDeploymentStep('ADOPT', 'MIGRATIONS_APPLIED')).toBe('BOOTSTRAP_ADOPTED');
  });
});
