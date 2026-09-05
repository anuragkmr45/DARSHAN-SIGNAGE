import { describe, expect, it } from 'vitest';
import { getMachineDefinitions } from './prometheus-summary';

describe('getMachineDefinitions', () => {
  it('matches the production bundle topology and does not expect undeployed cAdvisor jobs', () => {
    const machines = getMachineDefinitions('production');

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
});
