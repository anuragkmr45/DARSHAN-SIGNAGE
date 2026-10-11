import { randomUUID } from 'crypto';
export class DeviceConnectionRegistry {
    byDevice = new Map();
    bySocket = new Map();
    register(socket, input) {
        this.unregisterSocket(socket.id);
        const now = new Date();
        const entry = {
            ...input,
            connectionId: randomUUID(),
            connectedAt: now,
            lastHelloAt: now,
            socket,
        };
        const deviceConnections = this.byDevice.get(input.deviceId) ?? new Map();
        deviceConnections.set(entry.connectionId, entry);
        this.byDevice.set(input.deviceId, deviceConnections);
        this.bySocket.set(socket.id, entry);
        return entry;
    }
    unregisterSocket(socketId) {
        const entry = this.bySocket.get(socketId);
        if (!entry)
            return false;
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
    getConnections(deviceId) {
        return Array.from(this.byDevice.get(deviceId)?.values() ?? []).map(({ socket: _socket, ...info }) => info);
    }
    getConnectedDeviceIds() {
        return Array.from(this.byDevice.keys());
    }
    emitToDevice(deviceId, event, payload) {
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
