#!/usr/bin/env python3
"""Validate the ordered, bounded journal state of the active host watchdog."""
import json
import sys

MAX_INPUT = 64 * 1024
TERMINAL = {
    'watchdog_configuration_rejected',
    'watchdog_enforcement_target_rejected',
    'watchdog_enforcement_unconfirmed',
    'watchdog_failed',
    'watchdog_identity_fence_lost',
    'watchdog_pidfd_pin_failed',
    'watchdog_target_rejected',
}


def status(raw):
    if len(raw) > MAX_INPUT:
        return False, 'WATCHDOG_JOURNAL_TOO_LARGE'
    ready = False
    docker_degraded = False
    terminal = None
    recognized = 0
    for line in raw.splitlines():
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        if not isinstance(value, dict) or not isinstance(value.get('event'), str):
            continue
        event = value['event']
        recognized += 1
        if event == 'watchdog_ready':
            # A new ready event is a freshly pinned service invocation. Older
            # terminal/degraded events in the retained journal no longer apply.
            ready, docker_degraded, terminal = True, False, None
        elif ready and event == 'watchdog_docker_inspection_degraded':
            docker_degraded = True
        elif ready and event == 'watchdog_docker_inspection_recovered':
            docker_degraded = False
        elif ready and event in TERMINAL:
            terminal = event
    if recognized == 0 or not ready:
        return False, 'WATCHDOG_READY_NOT_OBSERVED'
    if terminal is not None:
        return False, terminal.upper()
    if docker_degraded:
        return False, 'WATCHDOG_DOCKER_MANAGEMENT_DEGRADED'
    return True, 'WATCHDOG_HEALTHY'


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    healthy, code = status(raw)
    print(code)
    return 0 if healthy else 1


if __name__ == '__main__':
    raise SystemExit(main())
