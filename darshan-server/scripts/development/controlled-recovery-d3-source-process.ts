import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { ControlledRecoveryError } from '../../src/recovery/controlled-docker/contracts';
import { z } from 'zod';

export type D3SourceSpawn = (executable: string, argv: readonly string[], options: SpawnOptions) => ChildProcess;
export const D3_SOURCE_PROCESS_ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', OPENSSL_CONF: '/dev/null', OPENSSL_MODULES: '/usr/lib/x86_64-linux-gnu/ossl-modules' });
const operation = z.enum(['OPENSSL', 'DOCKER_CONTEXT_INSPECT', 'DOCKER_INFO', 'DOCKER_IMAGE_INSPECT', 'DOCKER_NETWORK_LS', 'DOCKER_NETWORK_INSPECT', 'DOCKER_NETWORK_CREATE',
  'DOCKER_VOLUME_LS', 'DOCKER_VOLUME_INSPECT', 'DOCKER_VOLUME_CREATE', 'DOCKER_CONTAINER_LS', 'DOCKER_CONTAINER_INSPECT', 'DOCKER_CONTAINER_CREATE', 'DOCKER_CONTAINER_START',
  'DOCKER_CONTAINER_STOP', 'DOCKER_CONTAINER_WAIT', 'DOCKER_CONTAINER_RM', 'DOCKER_CONTAINER_RUN', 'DOCKER_UNKNOWN']);
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const diagnosticSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('process'), operation, timeoutMs: z.number().int().min(1).max(120000), category: z.enum(['NONZERO', 'TIMEOUT', 'OUTPUT_LIMIT', 'SPAWN_FAILED', 'CANCELLED', 'SETTLEMENT_UNCERTAIN', 'UNKNOWN', 'REJECTED']), exitCode: z.number().int().min(0).max(255).nullable() }).strict(),
  z.object({ kind: z.literal('headroom'), resource: z.enum(['MEMORY_BYTES', 'SWAP_BYTES', 'PRESSURE_MICROS', 'WORKSPACE_BYTES', 'WORKSPACE_INODES', 'TARGET_BYTES', 'TARGET_INODES']), observed: decimal, threshold: decimal, comparison: z.enum(['MINIMUM', 'MAXIMUM']) }).strict(),
  z.object({ kind: z.literal('authority'), phase: z.enum(['ENROLLMENT', 'SOCKET', 'CAPABILITY', 'CONFIGURATION', 'CONTEXT', 'DAEMON', 'IMAGES', 'HEADROOM', 'FILESYSTEM']), category: z.enum(['MISMATCH', 'MALFORMED', 'UNKNOWN']) }).strict(),
]);
export type D3SourceDiagnostic = z.infer<typeof diagnosticSchema>;
class D3SourceDiagnosticError extends ControlledRecoveryError {
  constructor(code: string, readonly diagnostic: D3SourceDiagnostic | undefined) { super(code, 'The enrolled fixed source operation or admission failed; retained authority requires review.'); }
}
/** Only fixed enums and bounded canonical numbers cross the public error boundary. */
export function d3SourceFailure(code: string, diagnostic?: unknown): ControlledRecoveryError {
  try { const parsed = diagnosticSchema.safeParse(diagnostic); return new D3SourceDiagnosticError(code, parsed.success ? Object.freeze(parsed.data) : undefined); } catch { return new D3SourceDiagnosticError(code, undefined); }
}
export function d3SourceFailureDetails(cause: unknown): { diagnostics?: [D3SourceDiagnostic] } {
  try { if (cause instanceof D3SourceDiagnosticError) { const parsed = diagnosticSchema.safeParse(cause.diagnostic); if (parsed.success) return { diagnostics: [parsed.data] }; } } catch { /* Untrusted/mutated diagnostic properties never cross the boundary. */ }
  return {};
}
export function d3ProcessDiagnostic(input: Pick<D3SourceProcessRequest, 'executable' | 'argv' | 'timeoutMs'>, category: Extract<D3SourceDiagnostic, { kind: 'process' }>['category'], exitCode: number | null = null): Extract<D3SourceDiagnostic, { kind: 'process' }> {
  const args = input.argv[0] === '--config' ? input.argv.slice(4) : input.argv; const name = input.executable === '/usr/bin/openssl' ? 'OPENSSL' : args[0] === 'info' ? 'DOCKER_INFO' : `DOCKER_${args[0]?.toUpperCase()}_${args[1]?.toUpperCase()}`;
  const admitted = operation.safeParse(name); return { kind: 'process', operation: admitted.success ? admitted.data : 'DOCKER_UNKNOWN', timeoutMs: input.timeoutMs, category, exitCode: Number.isInteger(exitCode) && Number(exitCode) >= 0 && Number(exitCode) <= 255 ? exitCode : null };
}
export function assertD3SourceProcessSuccess(input: Pick<D3SourceProcessRequest, 'executable' | 'argv' | 'timeoutMs' | 'maximumOutputBytes'>, result: { exitCode: number; stdout: Uint8Array; stderr: Uint8Array }) {
  if (result.stdout.byteLength + result.stderr.byteLength > input.maximumOutputBytes) throw d3SourceFailure('CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_OUTPUT_LIMIT', d3ProcessDiagnostic(input, 'OUTPUT_LIMIT'));
  if (!Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255) throw d3SourceFailure('CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_FAILED', d3ProcessDiagnostic(input, 'UNKNOWN'));
  if (result.exitCode !== 0) throw d3SourceFailure('CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_NONZERO', d3ProcessDiagnostic(input, 'NONZERO', result.exitCode)); return result;
}
const failed = (code: string) => d3SourceFailure(code);
export interface D3SourceProcessRequest { executable: '/usr/bin/openssl' | '/usr/bin/docker'; argv: readonly string[]; cwd: string; timeoutMs: number; maximumOutputBytes: number; signal?: AbortSignal; }

/** Low-level process transport. Public callers must first reconstruct and compare an enrolled operation plan. */
export class BoundedD3SourceProcess {
  constructor(private readonly spawnProcess: D3SourceSpawn = spawn) {}
  run(input: D3SourceProcessRequest): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
    if (!['/usr/bin/openssl', '/usr/bin/docker'].includes(input.executable) || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 120000 ||
        !Number.isSafeInteger(input.maximumOutputBytes) || input.maximumOutputBytes < 1 || input.maximumOutputBytes > 2 * 1024 * 1024 || !input.cwd.startsWith('/')) return Promise.reject(failed('CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_INPUT_INVALID'));
    if (input.signal?.aborted) return Promise.reject(failed('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED'));
    const failure = (code: string, exitCode: number | null = null) => d3SourceFailure(code, d3ProcessDiagnostic(input,
      code.endsWith('TIMEOUT') ? 'TIMEOUT' : code.endsWith('OUTPUT_LIMIT') ? 'OUTPUT_LIMIT' : code.endsWith('SPAWN_FAILED') ? 'SPAWN_FAILED' : code.endsWith('SETTLEMENT_UNCERTAIN') ? 'SETTLEMENT_UNCERTAIN' : code.endsWith('CANCELLED') ? 'CANCELLED' : 'UNKNOWN', exitCode));
    return new Promise((resolve, reject) => {
      let child: ChildProcess; let reason: string | undefined; let done = false; let count = 0; let kill: ReturnType<typeof setTimeout> | undefined; let join: ReturnType<typeof setTimeout> | undefined;
      const stdout: Buffer[] = []; const stderr: Buffer[] = [];
      const finish = (exitCode: number | null) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(kill); clearTimeout(join); input.signal?.removeEventListener('abort', abort);
        if (reason) reject(failure(reason, exitCode)); else resolve({ exitCode: exitCode ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); };
      const stop = (code: string) => { if (reason) return; reason = code; child.kill('SIGTERM'); kill = setTimeout(() => child.kill('SIGKILL'), 250);
        join = setTimeout(() => { reason = 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN'; finish(null); }, 2250); };
      const abort = () => stop('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED'); const old = process.umask(0o077);
      try { child = this.spawnProcess(input.executable, input.argv, { cwd: input.cwd, shell: false, env: D3_SOURCE_PROCESS_ENV, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
      catch { reject(failure('CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SPAWN_FAILED')); return; } finally { process.umask(old); }
      const timer = setTimeout(() => stop('CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_TIMEOUT'), input.timeoutMs);
      const collect = (destination: Buffer[]) => (chunk: Buffer) => { count += chunk.length; if (count > input.maximumOutputBytes) stop('CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_OUTPUT_LIMIT'); else if (!reason) destination.push(Buffer.from(chunk)); };
      child.stdout!.on('data', collect(stdout)); child.stderr!.on('data', collect(stderr)); child.once('error', () => stop('CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SPAWN_FAILED')); child.once('close', finish);
      input.signal?.addEventListener('abort', abort, { once: true }); if (input.signal?.aborted) abort();
    });
  }
}
