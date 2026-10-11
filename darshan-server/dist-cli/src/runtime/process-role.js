export const PROCESS_ROLES = ['all', 'api', 'worker'];
function isProcessRole(value) {
    return PROCESS_ROLES.includes(value);
}
export function resolveProcessRole(args = process.argv.slice(2), env = process.env) {
    const cliRole = args.find((arg) => arg.startsWith('--role='))?.slice('--role='.length)?.trim();
    if (cliRole) {
        if (!isProcessRole(cliRole)) {
            throw new Error(`Unsupported process role: ${cliRole}`);
        }
        return cliRole;
    }
    const envRole = env.DARSHAN_PROCESS_ROLE?.trim() || env.HEXMON_PROCESS_ROLE?.trim();
    if (envRole) {
        if (!isProcessRole(envRole)) {
            throw new Error(`Unsupported process role: ${envRole}`);
        }
        return envRole;
    }
    return 'all';
}
