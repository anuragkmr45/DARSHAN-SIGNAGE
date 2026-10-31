import { Duplex } from 'node:stream';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutD3DataSession } from './controlled-recovery-d3-source-data-clients';

/** Real pg client/connection/parser/pool, with a wire-protocol socket that never connects to a service. */
class PgWireSocket extends Duplex {
  holdDestroy = false; private completeDestroy: (() => void) | null = null;
  connect() { queueMicrotask(() => this.emit('connect')); return this; }
  setNoDelay() { return this; } setKeepAlive() { return this; } ref() { return this; } unref() { return this; }
  _read() {}
  _write(bytes: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (bytes[0] === 0) queueMicrotask(() => this.push(Buffer.from([90, 0, 0, 0, 5, 73]))); // ReadyForQuery after startup.
    callback();
  }
  _final(callback: (error?: Error | null) => void) { callback(); this.destroy(); }
  _destroy(error: Error | null, callback: (error?: Error | null) => void) { if (this.holdDestroy) this.completeDestroy = () => callback(error); else callback(error); }
  finishDestroy() { this.holdDestroy = false; this.completeDestroy?.(); this.completeDestroy = null; }
}
const pools: Pool[] = []; afterEach(async () => { vi.useRealTimers(); await Promise.all(pools.splice(0).map((pool) => pool.end().catch(() => undefined))); });
function fixture() {
  const socket = new PgWireSocket(); const pool = new Pool({ stream: () => socket, ssl: false, host: 'no-network-test.invalid', user: 'unit', database: 'unit', max: 1, idleTimeoutMillis: 0, connectionTimeoutMillis: 1000 } as PoolConfig); pools.push(pool);
  const poolErrors = vi.fn(); const releases = vi.fn(); pool.on('error', poolErrors); pool.on('release', releases); let ending: Promise<void> | null = null; const end = vi.fn(() => ending ??= pool.end());
  return { socket, pool, poolErrors, releases, end };
}
function ended(client: PoolClient) { return new Promise<void>((resolve) => client.once('end', resolve)); }
const guarded = (client: PoolClient) => client.listeners('error').some((listener) => listener.name === 'onError');

describe('D3 checked-out pg client error ownership and settlement', () => {
  it('retains the real checked-out client error guard and releases/ends exactly once across concurrent close', async () => { const f = fixture(); const session = await checkoutD3DataSession(f.pool, f.end); expect(guarded(session.client)).toBe(true); const first = session.close(); expect(session.close()).toBe(first); await first; expect(f.releases).toHaveBeenCalledOnce(); expect(f.releases.mock.calls[0]![0]).toBe(false); expect(f.end).toHaveBeenCalledOnce(); expect(f.pool.totalCount).toBe(0); expect(guarded(session.client)).toBe(false); });
  it.each([true, false])('handles real socket destruction with explicitError=%s without an unhandled client error or successful settlement claim', async (explicitError) => { const f = fixture(); const session = await checkoutD3DataSession(f.pool, f.end); const terminal = ended(session.client); expect(guarded(session.client)).toBe(true); f.socket.destroy(explicitError ? new Error('private-pg-error-marker') : undefined); await terminal; await expect(session.close()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_DATA_CLIENT_UNVERIFIED', message: expect.not.stringContaining('private-pg-error-marker') }); expect(f.releases).toHaveBeenCalledOnce(); expect(f.releases.mock.calls[0]![0]).toBe(true); expect(f.end).toHaveBeenCalledOnce(); expect(f.pool.totalCount).toBe(0); });
  it('installs the guard in the checkout callback before the promise handoff error window', async () => { const f = fixture(); f.pool.once('acquire', (client) => { queueMicrotask(() => (client as unknown as { connection: { emit(name: string, error: Error): void } }).connection.emit('error', new Error('private-checkout-marker'))); }); await expect(checkoutD3DataSession(f.pool, f.end)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_DATA_CLIENT_UNVERIFIED', message: expect.not.stringContaining('private-checkout-marker') }); expect(f.releases).toHaveBeenCalledOnce(); expect(f.end).toHaveBeenCalledOnce(); });
  it('handles abort-triggered real socket errors/end and keeps exactly one release', async () => { const f = fixture(); const abort = new AbortController(); const session = await checkoutD3DataSession(f.pool, f.end, abort.signal); abort.abort(); const close = session.close(); expect(session.close()).toBe(close); await expect(close).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED' }); expect(f.socket.destroyed).toBe(true); expect(f.releases).toHaveBeenCalledOnce(); expect(f.releases.mock.calls[0]![0]).toBe(true); expect(f.end).toHaveBeenCalledOnce(); });
  it('settles a real pg query rejection and client error together on cancellation', async () => { const f = fixture(); const abort = new AbortController(); const session = await checkoutD3DataSession(f.pool, f.end, abort.signal); const query = session.client.query('SELECT 1'); const queryFailure = expect(query).rejects.toBeInstanceOf(Error); abort.abort(); await queryFailure; await expect(session.close()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED' }); expect(f.releases).toHaveBeenCalledOnce(); expect(f.end).toHaveBeenCalledOnce(); expect(f.pool.totalCount).toBe(0); });
  it('does not check out a client when already aborted', async () => { const f = fixture(); const abort = new AbortController(); abort.abort(); const connect = vi.spyOn(f.pool, 'connect'); await expect(checkoutD3DataSession(f.pool, f.end, abort.signal)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED' }); expect(connect).not.toHaveBeenCalled(); expect(f.releases).not.toHaveBeenCalled(); });
  it('retains error ownership through delayed end and catches errors arriving during pool settlement', async () => { const f = fixture(); const session = await checkoutD3DataSession(f.pool, f.end); f.socket.holdDestroy = true; const close = session.close(); const assertion = expect(close).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_DATA_CLIENT_UNVERIFIED' }); expect(guarded(session.client)).toBe(true); f.socket.emit('error', new Error('private-late-settlement-marker')); expect(guarded(session.client)).toBe(true); f.socket.finishDestroy(); await assertion; expect(f.releases).toHaveBeenCalledOnce(); expect(f.end).toHaveBeenCalledOnce(); expect(guarded(session.client)).toBe(false); });
  it('retains the guard on uncertain settlement until the original client finally ends', async () => { const f = fixture(); const session = await checkoutD3DataSession(f.pool, f.end); vi.useFakeTimers(); f.socket.holdDestroy = true; const destroy = vi.spyOn(f.socket, 'destroy'); const close = session.close(); const assertion = expect(close).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_DATA_CLIENT_SETTLEMENT_UNCERTAIN' }); await vi.advanceTimersByTimeAsync(10000); await assertion; expect(destroy.mock.calls.length).toBeGreaterThanOrEqual(2); expect(guarded(session.client)).toBe(true); const terminal = ended(session.client); f.socket.finishDestroy(); await vi.runAllTicks(); vi.useRealTimers(); await terminal; expect(guarded(session.client)).toBe(false); expect(f.releases).toHaveBeenCalledOnce(); expect(f.end).toHaveBeenCalledOnce(); });
});
