import os from 'os';
import { config } from '@/config';

const startupStamp = Date.now().toString(36);

function sanitizeNodeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 128);
}

export function getRealtimeNodeId() {
  if (config.REALTIME_NODE_ID) {
    return sanitizeNodeId(config.REALTIME_NODE_ID);
  }

  return sanitizeNodeId(`${os.hostname()}:${process.pid}:${startupStamp}`);
}
