import { spawnSync } from 'node:child_process';
import { stdin, stderr } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { readProtectedSecretFile } from './protected-secret.js';
export class AdminSecretInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AdminSecretInputError';
    }
}
function normalizeOperatorSecret(value) {
    if (!value || /[\r\n\0]/.test(value)) {
        throw new AdminSecretInputError('Password input must contain one non-empty line.');
    }
    return value;
}
export async function readPasswordFromTty(prompt = 'Administrator password: ') {
    if (!stdin.isTTY || !stderr.isTTY) {
        throw new AdminSecretInputError('TTY password input requires an interactive terminal; use --password-file for automation.');
    }
    if (process.platform === 'win32') {
        throw new AdminSecretInputError('Non-echoing TTY password input is not supported on this platform; use --password-file.');
    }
    const disableEcho = spawnSync('sh', ['-c', 'stty -echo < /dev/tty'], { stdio: 'ignore' });
    if (disableEcho.status !== 0) {
        throw new AdminSecretInputError('Unable to disable terminal echo; use --password-file.');
    }
    const readline = createInterface({ input: stdin, output: stderr });
    try {
        const password = await readline.question(prompt);
        stderr.write('\n');
        return normalizeOperatorSecret(password);
    }
    finally {
        readline.close();
        spawnSync('sh', ['-c', 'stty echo < /dev/tty'], { stdio: 'ignore' });
    }
}
export async function resolveAdminPasswordInput(options, readers = {}) {
    const passwordFile = options.passwordFile?.trim();
    const promptPassword = Boolean(options.promptPassword);
    if (Boolean(passwordFile) === promptPassword) {
        throw new AdminSecretInputError('Provide exactly one password source: --password-file or --prompt-password.');
    }
    if (passwordFile) {
        return (readers.readFile ?? readProtectedSecretFile)(passwordFile);
    }
    return readers.readTty
        ? normalizeOperatorSecret(await readers.readTty(options.prompt ?? 'Administrator password: '))
        : readPasswordFromTty(options.prompt);
}
