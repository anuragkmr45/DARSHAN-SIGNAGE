import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { attachAbortTermination } from './abortable-process';

describe('abortable backup processes', () => {
  it('terminates a detached child process group in bounded time', async () => {
    const child = spawn(process.execPath, ['-e', [
      "const { spawn } = require('node:child_process');",
      "const nested = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)\"], { stdio: ['ignore', 'pipe', 'ignore'] });",
      'nested.stdout.once(\'data\', () => console.log(nested.pid));',
      'setInterval(() => {}, 1000);',
    ].join(' ')], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const nestedPid = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.stdout!.once('data', (chunk) => resolve(Number(String(chunk).trim())));
    });
    const controller = new AbortController();
    const termination = attachAbortTermination(child, controller.signal);
    controller.abort(new Error('deadline expired'));
    await termination.wait();
    termination.dispose();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    if (process.platform !== 'win32') {
      expect(() => process.kill(nestedPid, 0)).toThrow();
    }
  });
});
