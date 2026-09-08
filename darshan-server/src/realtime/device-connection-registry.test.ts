import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { DeviceConnectionRegistry } from '@/realtime/device-connection-registry';

describe('DeviceConnectionRegistry fleet notification', () => {
  it('creates a separate device-bound wake payload for every local connection', () => {
    const registry = new DeviceConnectionRegistry();
    const firstEmit = vi.fn();
    const secondEmit = vi.fn();
    const thirdEmit = vi.fn();
    registry.register({ id: 'first', emit: firstEmit } as unknown as Socket, {
      deviceId: 'device-a', sessionId: null, protocolVersion: '1.1', appVersion: null, platformFamily: null,
    });
    registry.register({ id: 'second', emit: secondEmit } as unknown as Socket, {
      deviceId: 'device-a', sessionId: null, protocolVersion: '1.1', appVersion: null, platformFamily: null,
    });
    registry.register({ id: 'third', emit: thirdEmit } as unknown as Socket, {
      deviceId: 'device-b', sessionId: null, protocolVersion: '1.1', appVersion: null, platformFamily: null,
    });

    expect(registry.emitToAll('RESYNC_REQUIRED', (deviceId) => ({ type: 'RESYNC_REQUIRED', device_id: deviceId }))).toBe(3);
    expect(firstEmit).toHaveBeenCalledWith('RESYNC_REQUIRED', { type: 'RESYNC_REQUIRED', device_id: 'device-a' });
    expect(secondEmit).toHaveBeenCalledWith('RESYNC_REQUIRED', { type: 'RESYNC_REQUIRED', device_id: 'device-a' });
    expect(thirdEmit).toHaveBeenCalledWith('RESYNC_REQUIRED', { type: 'RESYNC_REQUIRED', device_id: 'device-b' });
  });
});
