import { AppError } from '../utils/app-error.js';
import { extractTokenFromHeader, verifyAccessToken } from './jwt.js';
import { createSessionRepository } from '../db/repositories/session.js';
import { defineAbilityFor } from '../rbac/index.js';
const REQUEST_AUTH_KEY = Symbol.for('darshan.requestAuth');
function isSessionActive(session, userId) {
    if (!session)
        return false;
    if (session.user_id !== userId)
        return false;
    return session.expires_at.getTime() > Date.now();
}
export async function chatAuthPreHandler(request) {
    const token = extractTokenFromHeader(request.headers.authorization);
    if (!token) {
        throw AppError.unauthorized('Missing authorization header');
    }
    const payload = await verifyAccessToken(token);
    const sessionRepo = createSessionRepository();
    const session = await sessionRepo.findByJti(payload.jti);
    if (!isSessionActive(session, payload.sub)) {
        throw AppError.unauthorized('Token has been revoked');
    }
    const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
    request[REQUEST_AUTH_KEY] = { payload, ability };
}
export function getRequestAuthContext(request) {
    const auth = request[REQUEST_AUTH_KEY];
    if (!auth)
        throw AppError.unauthorized('Unauthorized');
    return auth;
}
