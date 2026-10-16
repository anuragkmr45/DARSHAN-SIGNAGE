import { SignJWT, jwtVerify, type JWTPayload as JoseJWTPayload } from 'jose';
import { config as appConfig } from '@/config';
import { randomUUID } from 'crypto';
import { AuthError } from '@/auth/errors';
import { getDatabase, schema } from '@/db';
import { and, eq, gt, isNull } from 'drizzle-orm';

export interface JWTPayload extends JoseJWTPayload {
  sub: string; // user ID
  email: string;
  role_id: string;
  role: string;
  department_id?: string;
  jti: string; // JWT ID for revocation
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();
const secret = encoder.encode(appConfig.JWT_SECRET);

export async function generateAccessToken(
  userId: string,
  email: string,
  roleId: string,
  roleName: string,
  departmentId?: string | null,
  options?: { jti?: string; expiresInSeconds?: number }
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = options?.jti ?? randomUUID();
  const expiresInSeconds = options?.expiresInSeconds ?? appConfig.JWT_EXPIRY;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  const token = await new SignJWT({
    sub: userId,
    email,
    role_id: roleId,
    role: roleName,
    department_id: departmentId ?? undefined,
    jti,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);

  return { token, jti, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const secret = new TextEncoder().encode(appConfig.JWT_SECRET);

  try {
    const verified = await jwtVerify(token, secret);
    const payload = verified.payload as JWTPayload;
    if (!payload.sub || !payload.jti) {
      throw new AuthError('Invalid or expired token');
    }

    const db = getDatabase();
    const [authenticated] = await db
      .select({ user_id: schema.sessions.user_id })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.user_id))
      .where(
        and(
          eq(schema.sessions.access_jti, payload.jti),
          eq(schema.sessions.user_id, payload.sub),
          gt(schema.sessions.expires_at, new Date()),
          eq(schema.users.is_active, true),
          isNull(schema.users.deleted_at)
        )
      )
      .limit(1);
    if (!authenticated) {
      throw new AuthError('Token has been revoked');
    }
    return payload;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('Invalid or expired token');
  }
}

export async function refreshAccessToken(payload: Pick<JWTPayload, 'sub' | 'email' | 'role_id' | 'role' | 'department_id' | 'jti'>, expiresInSeconds: number) {
  return generateAccessToken(
    payload.sub,
    payload.email,
    payload.role_id,
    payload.role,
    payload.department_id,
    { jti: payload.jti, expiresInSeconds }
  );
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}
