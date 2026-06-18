import { randomUUID } from 'crypto';
import { Socket } from 'socket.io';

export type DeviceConnectionInfo = {
  connectionId: string;
  deviceId: string;
  sessionId: string | null;
  protocolVersion: string;
  connectedAt: Date;
  lastHelloAt: Date;
  appVersion: string | null;
  platformFamily: string | null;
};

type RegistryEntry = DeviceConnectionInfo & {
  socket: Socket;
};

export class DeviceConnectionRegistry {
  private readonly byDevice = new Map<string, Map<string, RegistryEntry>>();
  private readonly bySocket = new Map<string, RegistryEntry>();

  register(socket: Socket, input: Omit<DeviceConnectionInfo, 'connectionId' | 'connectedAt' | 'lastHelloAt'>) {
    this.unregisterSocket(socket.id);

    const now = new Date();
    const entry: RegistryEntry = {
      ...input,
      connectionId: randomUUID(),
      connectedAt: now,
      lastHelloAt: now,
      socket,
    };

    const deviceConnections = this.byDevice.get(input.deviceId) ?? new Map<string, RegistryEntry>();
    deviceConnections.set(entry.connectionId, entry);
    this.byDevice.set(input.deviceId, deviceConnections);
    this.bySocket.set(socket.id, entry);

    return entry;
  }

  unregisterSocket(socketId: string) {
    const entry = this.bySocket.get(socketId);
    if (!entry) return false;

    this.bySocket.delete(socketId);
    const deviceConnections = this.byDevice.get(entry.deviceId);
    if (deviceConnections) {
      deviceConnections.delete(entry.connectionId);
      if (deviceConnections.size === 0) {
        this.byDevice.delete(entry.deviceId);
      }
    }
    return true;
  }

  getConnections(deviceId: string): DeviceConnectionInfo[] {
    return Array.from(this.byDevice.get(deviceId)?.values() ?? []).map(({ socket: _socket, ...info }) => info);
  }

  getConnectedDeviceIds() {
    return Array.from(this.byDevice.keys());
  }

  emitToDevice(deviceId: string, event: string, payload: unknown) {
    const deviceConnections = this.byDevice.get(deviceId);
    if (!deviceConnections || deviceConnections.size === 0) {
      return 0;
    }

    let sent = 0;
    for (const entry of deviceConnections.values()) {
      entry.socket.emit(event, payload);
      sent += 1;
    }
    return sent;
  }

  stats() {
    let connectionCount = 0;
    for (const entries of this.byDevice.values()) {
      connectionCount += entries.size;
    }

    return {
      connected_devices: this.byDevice.size,
      active_connections: connectionCount,
    };
  }

  clear() {
    this.byDevice.clear();
    this.bySocket.clear();
  }
}

export const deviceConnectionRegistry = new DeviceConnectionRegistry();
