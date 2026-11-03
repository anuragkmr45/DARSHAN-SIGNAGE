import { describe, expect, it } from 'vitest';
import { applyMediaRuntimeStatus, getMachineDefinitions } from './prometheus-summary';

describe('getMachineDefinitions', () => {
  it('uses the machine label emitted by the development Prometheus configuration', () => {
    expect(getMachineDefinitions('development')[0].id).toBe('vm2');
  });
  it('matches the production bundle topology and does not expect undeployed cAdvisor jobs', () => {
    const machines = getMachineDefinitions('production', false);

    expect(machines.map((machine) => machine.id)).toEqual(['vm1', 'valkey', 'vm2', 'vm3', 'vm4']);
    expect(machines.find((machine) => machine.id === 'vm1')?.expectedJobs).toEqual([
      'vm1-node',
      'vm1-postgres',
      'vm1-minio',
    ]);
    expect(machines.find((machine) => machine.id === 'valkey')?.expectedJobs).toEqual(['vm-valkey-node']);
    expect(machines.find((machine) => machine.id === 'vm2')?.expectedJobs).toEqual([
      'darshan-server',
      'vm2-node',
    ]);
    expect(machines.find((machine) => machine.id === 'vm3')?.expectedJobs).toEqual(['vm3-node', 'vm3-nginx']);
    expect(machines.find((machine) => machine.id === 'vm4')?.expectedJobs).toEqual([
      'prometheus',
      'vm4-alertmanager',
      'vm4-node',
      'vm4-grafana',
    ]);
    expect(machines.flatMap((machine) => machine.expectedJobs)).not.toContain('vm1-cadvisor');
    expect(machines.flatMap((machine) => machine.expectedJobs)).not.toContain('vm2-cadvisor');
  });
  it('adds the sixth Media VM only when live runtime is enabled', () => {
    expect(getMachineDefinitions('production', false).map((machine) => machine.id)).not.toContain('media');
    const media = getMachineDefinitions('production', true).find((machine) => machine.id === 'media');
    expect(media).toMatchObject({
      role: 'media',
      dashboardUid: 'darshan-vm-media',
      expectedJobs: ['vm-media-node'],
      services: [
        { id: 'runtime', label: 'Live Runtime', job: 'darshan-live-media-runtime' },
        { id: 'node', label: 'Host Exporter', job: 'vm-media-node' },
      ],
    });
  });
  it('does not report a healthy Media VM when runtime readiness is down or missing', () => {
    expect(applyMediaRuntimeStatus('media', 'healthy', 0)).toBe('critical');
    expect(applyMediaRuntimeStatus('media', 'healthy', null)).toBe('degraded');
    expect(applyMediaRuntimeStatus('media', 'healthy', 1)).toBe('healthy');
    expect(applyMediaRuntimeStatus('media', 'unknown', 0)).toBe('unknown');
    expect(applyMediaRuntimeStatus('backend', 'healthy', 0)).toBe('healthy');
  });
});
