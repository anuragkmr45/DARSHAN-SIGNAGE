import { hash, verify } from 'argon2';
import { AppError } from '../utils/app-error.js';
import { getPasswordPolicy } from '../utils/settings.js';
export async function hashPassword(password) {
    return hash(password, {
        type: 2, // argon2id
        memoryCost: 19 * 1024, // 19 MB
        timeCost: 2,
        parallelism: 1,
    });
}
export async function verifyPassword(password, hash) {
    try {
        return await verify(hash, password);
    }
    catch {
        return false;
    }
}
export function validatePasswordStrength(password) {
    const policy = getPasswordPolicy();
    if (password.length < policy.min_length) {
        throw AppError.validation([
            {
                field: 'password',
                message: `Password must be at least ${policy.min_length} characters long`,
            },
        ]);
    }
    const failures = [];
    if (policy.require_uppercase && !/[A-Z]/.test(password))
        failures.push('uppercase');
    if (policy.require_lowercase && !/[a-z]/.test(password))
        failures.push('lowercase');
    if (policy.require_number && !/\d/.test(password))
        failures.push('number');
    if (policy.require_special && !/[^\w\s]/.test(password))
        failures.push('special character');
    if (failures.length > 0) {
        throw AppError.validation([
            {
                field: 'password',
                message: `Password must include ${failures.join(', ')}`,
            },
        ]);
    }
}
