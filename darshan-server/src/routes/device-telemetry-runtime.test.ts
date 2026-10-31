import { describe, expect, it } from 'vitest';
import { classifyWorkerQueue } from '@/maintenance/worker-admission';

describe('device telemetry runtime mode', () => {
  it('gates every telemetry persistence worker behind maintenance admission', () => {
    expect(classifyWorkerQueue('telemetry:heartbeat')).toBe('gated');
    expect(classifyWorkerQueue('telemetry:proof-of-play')).toBe('gated');
    expect(classifyWorkerQueue('telemetry:screenshot')).toBe('gated');
    expect(classifyWorkerQueue('telemetry:device-observation')).toBe('gated');
    expect(classifyWorkerQueue('telemetry:media-cache-report')).toBe('gated');
  });
});
