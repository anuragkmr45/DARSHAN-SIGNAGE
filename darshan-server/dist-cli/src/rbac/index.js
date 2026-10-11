import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { createRoleRepository } from '../db/repositories/role.js';
import { AppError } from '../utils/app-error.js';
const resolveConditionValue = (value, user) => {
    if (value === '$user.id')
        return user.id;
    if (value === '$user.department_id')
        return user.department_id ?? undefined;
    return value;
};
const resolveConditions = (conditions, user) => {
    if (!conditions)
        return undefined;
    const resolved = {};
    for (const [key, value] of Object.entries(conditions)) {
        const resolvedValue = resolveConditionValue(value, user);
        if (resolvedValue === undefined || resolvedValue === null) {
            return undefined;
        }
        resolved[key] = resolvedValue;
    }
    return resolved;
};
const parsePermissions = (permissions) => {
    if (!permissions || typeof permissions !== 'object') {
        return { grants: [] };
    }
    const grants = Array.isArray(permissions.grants) ? permissions.grants : [];
    const inherits = Array.isArray(permissions.inherits) ? permissions.inherits : [];
    return { grants, inherits };
};
const resolveRoleGrants = async (role, visited) => {
    if (visited.has(role.id))
        return [];
    visited.add(role.id);
    const roleRepo = createRoleRepository();
    const permissions = parsePermissions(role.permissions);
    const grants = [...permissions.grants];
    if (permissions.inherits && permissions.inherits.length > 0) {
        for (const inheritedId of permissions.inherits) {
            const inheritedRole = await roleRepo.findById(inheritedId);
            if (!inheritedRole)
                continue;
            const inheritedGrants = await resolveRoleGrants(inheritedRole, visited);
            grants.push(...inheritedGrants);
        }
    }
    return grants;
};
export async function defineAbilityFor(roleId, userId, departmentId) {
    const roleRepo = createRoleRepository();
    const role = await roleRepo.findById(roleId);
    if (!role) {
        throw AppError.unauthorized('Authorization context is stale. Please sign in again.');
    }
    const { can, cannot, build } = new AbilityBuilder(createMongoAbility);
    if (role.name === 'SUPER_ADMIN') {
        can('manage', 'all');
        return build();
    }
    const userContext = { id: userId, department_id: departmentId };
    const grants = await resolveRoleGrants(role, new Set());
    const hasExplicitBrandingGrant = grants.some((grant) => grant &&
        (grant.subject === 'BrandingSettings') &&
        (grant.action === 'manage' || grant.action === 'read' || grant.action === 'update'));
    grants.forEach((grant) => {
        if (!grant || !grant.action || !grant.subject)
            return;
        const conditions = resolveConditions(grant.conditions, userContext);
        if (grant.action === 'manage') {
            can('manage', grant.subject, conditions);
            return;
        }
        can(grant.action, grant.subject, conditions);
    });
    if (role.name === 'ADMIN' && !hasExplicitBrandingGrant) {
        cannot('manage', 'BrandingSettings');
    }
    return build();
}
export function checkAbility(ability, action, subject) {
    return ability.can(action, subject);
}
