import type { ChildProcess } from 'node:child_process';

function processGroupExists(processGroupId: number) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function waitForTreeExit(child: ChildProcess, processGroupId: number, timeoutMs: number) {
  if (process.platform === 'win32' && (child.exitCode !== null || child.signalCode !== null)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const exited = process.platform === 'win32'
        ? child.exitCode !== null || child.signalCode !== null
        : !processGroupExists(processGroupId);
      if (exited) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      const timer = setTimeout(poll, 25);
      timer.unref();
    };
    poll();
  });
}

function signalProcessTree(child: ChildProcess, processGroupId: number, signal: NodeJS.Signals) {
  try {
    // Keep addressing the original process group after its leader exits; a
    // descendant may deliberately ignore SIGTERM and keep the group alive.
    if (process.platform !== 'win32') process.kill(-processGroupId, signal);
    else if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

export async function terminateProcessTree(child: ChildProcess, termGraceMs = 2_000, killGraceMs = 2_000) {
  if (!child.pid) return;
  const processGroupId = child.pid;
  signalProcessTree(child, processGroupId, 'SIGTERM');
  if (await waitForTreeExit(child, processGroupId, termGraceMs)) return;
  signalProcessTree(child, processGroupId, 'SIGKILL');
  await waitForTreeExit(child, processGroupId, killGraceMs);
}

export function attachAbortTermination(child: ChildProcess, signal: AbortSignal) {
  let termination: Promise<void> | null = null;
  const abort = () => { termination ??= terminateProcessTree(child); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return {
    dispose: () => signal.removeEventListener('abort', abort),
    wait: async () => { if (termination) await termination; },
  };
}
