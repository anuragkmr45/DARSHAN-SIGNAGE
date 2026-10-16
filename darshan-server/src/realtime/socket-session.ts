import type { Socket } from 'socket.io';
import { verifyAccessToken, type JWTPayload } from '@/auth/jwt';

export function storeSocketSession(socket: Socket, token: string, payload: JWTPayload): void {
  (socket.data as any).authToken = token;
  (socket.data as any).user = payload;
}

export async function requireCurrentSocketSession(socket: Socket): Promise<JWTPayload> {
  const token = (socket.data as any).authToken;
  if (typeof token !== 'string' || token.length === 0) {
    socket.disconnect(true);
    throw new Error('Socket session is unavailable');
  }

  try {
    const payload = await verifyAccessToken(token);
    (socket.data as any).user = payload;
    return payload;
  } catch (error) {
    socket.disconnect(true);
    throw error;
  }
}
