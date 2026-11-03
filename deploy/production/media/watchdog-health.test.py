import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('watchdog_health', Path(__file__).with_name('watchdog-health.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


def events(*names):
    return ('\n'.join(json.dumps({'event': name}) for name in names) + '\n').encode()


class WatchdogHealthTests(unittest.TestCase):
    def test_ready_is_healthy(self):
        self.assertEqual(health.status(events('watchdog_ready')), (True, 'WATCHDOG_HEALTHY'))

    def test_unrecovered_docker_degradation_is_unhealthy(self):
        self.assertEqual(health.status(events('watchdog_ready', 'watchdog_docker_inspection_degraded')),
                         (False, 'WATCHDOG_DOCKER_MANAGEMENT_DEGRADED'))
        self.assertEqual(health.status(events('watchdog_ready', 'watchdog_docker_inspection_degraded',
                                              'watchdog_docker_inspection_recovered')),
                         (True, 'WATCHDOG_HEALTHY'))

    def test_new_ready_supersedes_retained_prior_invocation_events(self):
        self.assertEqual(health.status(events('watchdog_ready', 'watchdog_docker_inspection_degraded',
                                              'watchdog_enforcement_unconfirmed', 'watchdog_ready')),
                         (True, 'WATCHDOG_HEALTHY'))

    def test_terminal_event_after_ready_is_unhealthy(self):
        for event in health.TERMINAL:
            with self.subTest(event=event):
                self.assertEqual(health.status(events('watchdog_ready', event)), (False, event.upper()))

    def test_missing_ready_malformed_and_oversized_input_fail(self):
        self.assertEqual(health.status(b'not-json\n'), (False, 'WATCHDOG_READY_NOT_OBSERVED'))
        self.assertEqual(health.status(events('watchdog_docker_inspection_recovered')),
                         (False, 'WATCHDOG_READY_NOT_OBSERVED'))
        self.assertEqual(health.status(b'x' * (health.MAX_INPUT + 1)), (False, 'WATCHDOG_JOURNAL_TOO_LARGE'))


if __name__ == '__main__':
    unittest.main()
