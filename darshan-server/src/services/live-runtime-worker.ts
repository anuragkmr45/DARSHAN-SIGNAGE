import { config } from '@/config';
import { performance } from 'node:perf_hooks';
import { registerDatabaseShutdownHook } from '@/db';
import { initializeLiveAuthorityEpoch } from './live-authority-epoch';
import { dispatchOneLiveMediaOperation, reconcileLiveRuntime, reconcileLiveWindowBoundaries } from './live-runtime';

let timer: ReturnType<typeof setTimeout> | undefined;
let active: Promise<void> | undefined;
let stopped = true;
export function startLiveRuntimeWorker() {
  if (!config.DARSHAN_LIVE_RUNTIME_ENABLED || !stopped) return;
  initializeLiveAuthorityEpoch(); stopped = false;
  let lastReconciled = -Infinity;
  const tick = async () => {
    try {
      await reconcileLiveWindowBoundaries();
      if (performance.now() - lastReconciled >= 1000) { await reconcileLiveRuntime(); lastReconciled = performance.now(); }
      // At most four active control requests and sixteen intents per packet.
      // Claims coordinate workers; network never runs under transaction locks.
      for (let batch = 0; batch < 4 && !stopped; batch++) {
        const outcomes = await Promise.all(Array.from({ length: 4 }, () => dispatchOneLiveMediaOperation()));
        if (!outcomes.some(Boolean)) break;
      }
    } catch { /* Persisted operation status and REST expose failure; no secrets logged. */ }
    finally { active = undefined; if (!stopped) { timer = setTimeout(run, 100); timer.unref(); } }
  };
  const run = () => { active = tick(); };
  registerDatabaseShutdownHook('live-runtime-worker', stopLiveRuntimeWorker);
  run();
}
export async function stopLiveRuntimeWorker() {
  stopped = true; if (timer) clearTimeout(timer); timer = undefined;
  await active;
}
