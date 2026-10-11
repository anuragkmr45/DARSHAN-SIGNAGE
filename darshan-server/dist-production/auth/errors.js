export class AuthError extends Error {
    constructor(message = 'Unauthorized') {
        super(message);
        this.name = 'AuthError';
    }
}
export function isAuthError(error) {
    return error instanceof AuthError || (typeof error === 'object' && error !== null && error.name === 'AuthError');
}
