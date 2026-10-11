import { SignJWT, jwtVerify } from 'jose';
import { config as appConfig } from '../config/index.js';
import { randomUUID } from 'crypto';
import { AuthError } from './errors.js';
const encoder = new TextEncoder();
const secret = encoder.encode(appConfig.JWT_SECRET);
export async function generateAccessToken(userId, email, roleId, roleName, departmentId, options) {
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
export async function verifyAccessToken(token) {
    const secret = new TextEncoder().encode(appConfig.JWT_SECRET);
    try {
        const verified = await jwtVerify(token, secret);
        return verified.payload;
    }
    catch (error) {
        throw new AuthError('Invalid or expired token');
    }
}
export async function refreshAccessToken(payload, expiresInSeconds) {
    return generateAccessToken(payload.sub, payload.email, payload.role_id, payload.role, payload.department_id, { jti: payload.jti, expiresInSeconds });
}
export function extractTokenFromHeader(authHeader) {
    if (!authHeader) {
        return null;
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return null;
    }
    return parts[1];
}
