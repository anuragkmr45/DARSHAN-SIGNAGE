import { buildScreenPlaybackStateById } from '../screens/playback.js';
import { emitScreenStateUpdateGlobal } from '../realtime/screens-namespace.js';
import { getSocketServer } from '../realtime/socket-server.js';
import { createLogger } from '../utils/logger.js';
const logger = createLogger('screen-state-refresh');
const DEFAULT_DEBOUNCE_MS = 750;
const refreshStateByScreenId = new Map();
function scheduleRefresh(screenId, state) {
    if (state.timer) {
        clearTimeout(state.timer);
    }
    state.timer = setTimeout(() => {
        state.timer = null;
        void runRefresh(screenId);
    }, state.debounceMs);
}
async function runRefresh(screenId) {
    const state = refreshStateByScreenId.get(screenId);
    if (!state) {
        return;
    }
    if (state.inFlight) {
        state.rerun = true;
        return;
    }
    if (!getSocketServer()) {
        refreshStateByScreenId.delete(screenId);
        return;
    }
    state.inFlight = true;
    let shouldReschedule = false;
    try {
        const playbackState = await buildScreenPlaybackStateById(screenId);
        if (playbackState) {
            emitScreenStateUpdateGlobal(playbackState);
        }
    }
    catch (error) {
        logger.warn({ error, screenId }, 'Failed to refresh screen state');
    }
    finally {
        state.inFlight = false;
        shouldReschedule = state.rerun;
        state.rerun = false;
    }
    if (shouldReschedule) {
        scheduleRefresh(screenId, state);
        return;
    }
    if (!state.timer) {
        refreshStateByScreenId.delete(screenId);
    }
}
export function queueScreenStateRefresh(screenId, options) {
    if (!screenId) {
        return;
    }
    const debounceMs = Math.max(0, options?.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    const state = refreshStateByScreenId.get(screenId) ?? {
        timer: null,
        inFlight: false,
        rerun: false,
        debounceMs,
    };
    state.debounceMs = debounceMs;
    refreshStateByScreenId.set(screenId, state);
    if (state.inFlight) {
        state.rerun = true;
        return;
    }
    scheduleRefresh(screenId, state);
}
export function clearQueuedScreenStateRefreshes() {
    for (const state of refreshStateByScreenId.values()) {
        if (state.timer) {
            clearTimeout(state.timer);
        }
    }
    refreshStateByScreenId.clear();
}
