import contextlib
import errno
import importlib.util
import io
import os
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

spec = importlib.util.spec_from_file_location('watchdog', pathlib.Path(__file__).parents[1] / 'host-watchdog.py')
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)
INSTANCE = 'f010e1ec-d9ce-4b75-9cf8-e95f73aaef50'
ID = 'a' * 64


def heartbeat(**changes):
    value = {'schema_version': 1, 'instance_id': INSTANCE, 'supervisor_pid': 1,
             'process_start_ticks': '123', 'sequence': 5, 'boottime_ms': 10_000,
             'boot_id': 'test-boot', 'phase': 'RUNNING'}
    value.update(changes)
    return value


class WatchdogTests(unittest.TestCase):
    def check_value(self, value, previous=None):
        return watchdog.validate_heartbeat(value, INSTANCE, '123', 'test-boot', 10_000, previous)

    def test_valid_heartbeat_and_unchanged_atomic_file(self):
        value = heartbeat()
        self.assertEqual(self.check_value(value), value)
        self.assertEqual(self.check_value(value, value), value)

    def test_future_wrong_boot_wrong_instance_pid_and_start_are_denied(self):
        for changes in ({'boottime_ms': 10_051}, {'boot_id': 'different'}, {'instance_id': 'other'},
                        {'supervisor_pid': 42}, {'process_start_ticks': '999'}, {'sequence': True}):
            with self.subTest(changes=changes), self.assertRaises(watchdog.WatchdogError):
                self.check_value(heartbeat(**changes))

    def test_replayed_or_forged_sequence_cannot_extend_liveness(self):
        previous = heartbeat()
        for changes in ({'sequence': 4}, {'boottime_ms': 9999}, {'boottime_ms': 10_001}):
            with self.subTest(changes=changes), self.assertRaises(watchdog.WatchdogError):
                self.check_value(heartbeat(**changes), previous)

    def test_schema_rejects_unknown_fields_and_nonfinite_clock_values(self):
        for value in (heartbeat(secret='do not log'), heartbeat(boottime_ms=float('nan')), heartbeat(phase='READY')):
            with self.assertRaises(watchdog.WatchdogError):
                self.check_value(value)

    def test_file_symlink_hardlink_mode_and_wrong_owner_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            os.chmod(directory, 0o700)
            file = directory / 'supervisor.json'
            file.write_text('{}', encoding='utf8')
            os.chmod(file, 0o600)
            self.assertEqual(watchdog.read_heartbeat(str(file), os.getuid()), {})
            with self.assertRaises(watchdog.WatchdogError):
                watchdog.read_heartbeat(str(file), os.getuid() + 1)
            os.chmod(file, 0o644)
            with self.assertRaises(watchdog.WatchdogError):
                watchdog.read_heartbeat(str(file), os.getuid())
            os.chmod(file, 0o600)
            link = directory / 'linked.json'
            os.link(file, link)
            with self.assertRaises(watchdog.WatchdogError):
                watchdog.read_heartbeat(str(file), os.getuid())
            link.unlink()
            file.unlink()
            file.symlink_to('/dev/null')
            with self.assertRaises((OSError, watchdog.WatchdogError)):
                watchdog.read_heartbeat(str(file), os.getuid())

    def test_atomic_replacement_after_open_can_unlink_the_safe_opened_inode(self):
        import json
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            os.chmod(directory, 0o700)
            file = directory / 'supervisor.json'
            replacement = directory / 'next.json'
            original = heartbeat(sequence=1)
            file.write_text(json.dumps(original), encoding='utf8')
            replacement.write_text(json.dumps(heartbeat(sequence=2)), encoding='utf8')
            os.chmod(file, 0o600)
            os.chmod(replacement, 0o600)
            real_fstat = os.fstat
            observed_links = []

            def replace_before_fstat(fd):
                os.replace(replacement, file)  # Real atomic rename after the reader opened the old inode.
                metadata = real_fstat(fd)
                observed_links.append(metadata.st_nlink)
                return metadata

            with mock.patch.object(watchdog.os, 'fstat', side_effect=replace_before_fstat):
                self.assertEqual(watchdog.read_heartbeat(str(file), os.getuid()), original)
            self.assertEqual(observed_links, [0])
            self.assertEqual(os.lstat(file).st_nlink, 1)

    def test_target_labels_instance_and_mount_fence_are_mandatory(self):
        info = {'Id': ID, 'Config': {'Labels': {watchdog.LABEL_MANAGED: '1', watchdog.LABEL_ROLE: 'media-node', watchdog.LABEL_INSTANCE: INSTANCE},
                'Env': ['DARSHAN_MEDIA_NODE_INSTANCE_ID=' + INSTANCE, 'DARSHAN_MEDIA_SUPERVISOR_STATE_FILE=/run/state/supervisor.json']},
                'HostConfig': {'RestartPolicy': {'Name': 'no'}}, 'State': {'Running': True, 'Pid': os.getpid(), 'StartedAt': 'fixed'}, 'RestartCount': 0,
                'Mounts': [{'Type': 'bind', 'Source': '/private/state', 'Destination': '/run/state', 'RW': True}]}
        with mock.patch.object(watchdog, 'validate_host_pid', return_value='123'):
            self.assertEqual(watchdog.validate_target(info, ID, INSTANCE, '/private/state/supervisor.json')['pid'], os.getpid())
        with self.assertRaises(watchdog.WatchdogError):
            watchdog.validate_target(info, ID, 'wrong', '/private/state/supervisor.json')
        with self.assertRaises(watchdog.WatchdogError):
            watchdog.validate_target(info, ID, INSTANCE, '/another/state/supervisor.json')
        for pid_mode in ('host', 'container:another-container'):
            info['HostConfig']['PidMode'] = pid_mode
            with self.assertRaisesRegex(watchdog.WatchdogError, 'PID_NAMESPACE_NOT_PRIVATE'):
                watchdog.validate_target(info, ID, INSTANCE, '/private/state/supervisor.json')
        info['HostConfig'].pop('PidMode')
        info['Config']['Labels'] = {}
        args = SimpleNamespace(docker_context='default', container_id=ID, instance_id=INSTANCE, heartbeat='/private/state/supervisor.json')
        with mock.patch.object(watchdog, 'validate_local_endpoint', return_value='local'), mock.patch.object(watchdog, 'inspect_container', return_value=info), mock.patch.object(watchdog, 'docker_call') as mutation, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(watchdog.enforce(args, 'stale'), 3)
            mutation.assert_not_called()

    def test_remote_docker_endpoint_is_rejected_before_any_inspect_or_kill(self):
        import json
        for endpoint in ('ssh://media.example.test', 'tcp://192.0.2.9:2375', 'https://media.example.test'):
            with self.subTest(endpoint=endpoint), mock.patch.object(watchdog, 'docker_call', return_value=json.dumps([{'Endpoints': {'docker': {'Host': endpoint}}}]).encode()) as calls:
                with self.assertRaisesRegex(watchdog.WatchdogError, 'MUST_BE_LOCAL_UNIX'):
                    watchdog.validate_local_endpoint('remote')
                self.assertEqual(calls.call_count, 1)
                self.assertEqual(calls.call_args[0][1], ['context', 'inspect', 'remote'])

    def test_wrong_host_cgroup_cannot_borrow_an_unrelated_process_clock(self):
        with self.assertRaisesRegex(watchdog.WatchdogError, 'CGROUP_REJECTED'):
            watchdog.validate_host_pid(os.getpid(), ID)

    def test_monitor_pause_cannot_be_hidden_by_fresh_supervisor_heartbeat(self):
        watchdog.validate_monitor_gap(10_000, 10_100)
        for sample in (11_501, 9999):
            with self.assertRaisesRegex(watchdog.WatchdogError, 'HOST_MONITOR_BOOTTIME_GAP'):
                watchdog.validate_monitor_gap(10_000, sample)
        # The heartbeat itself can be fresh and valid; own-monitor gap still wins.
        self.check_value(heartbeat())
        with self.assertRaises(watchdog.WatchdogError):
            watchdog.validate_monitor_gap(8000, 10_000)

    def test_pidfd_fallback_does_not_signal_when_host_fence_is_wrong(self):
        fd = os.pidfd_open(os.getpid())
        try:
            with open('/proc/sys/kernel/random/boot_id', encoding='ascii') as stream:
                boot_id = stream.read().strip()
            args = SimpleNamespace(pidfd=fd, container_id=ID, boot_id=boot_id,
                                   process_fence={'pid': os.getpid(), 'start_ticks': 'original'}, pid_namespace='original')
            with mock.patch.object(watchdog, 'validate_host_pid', side_effect=watchdog.WatchdogError('HOST_PID_CGROUP_REJECTED')), mock.patch.object(watchdog.signal, 'pidfd_send_signal') as send, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(watchdog.enforce_pidfd(args, 'unavailable', watchdog.time.monotonic() + 0.1), 3)
                send.assert_not_called()
        finally:
            os.close(fd)

    def test_dead_held_pidfd_never_reopens_or_signals_a_reused_numeric_pid(self):
        import subprocess
        import sys
        child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(10)'])
        fd = os.pidfd_open(child.pid)
        try:
            child.terminate()
            child.wait(timeout=1)
            args = SimpleNamespace(pidfd=fd, container_id=ID)
            with mock.patch.object(watchdog.os, 'pidfd_open', side_effect=AssertionError('must never reopen')), mock.patch.object(watchdog.signal, 'pidfd_send_signal') as send, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(watchdog.enforce_pidfd(args, 'unavailable', watchdog.time.monotonic() + 0.1), 0)
                send.assert_not_called()
        finally:
            os.close(fd)
            if child.poll() is None:
                child.kill()
                child.wait()

    def test_denied_pidfd_signal_observes_a_concurrent_exit_to_the_same_deadline(self):
        import json
        import subprocess
        import sys
        import threading
        import time
        for exits in (True, False):
            with self.subTest(concurrent_exit=exits):
                child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(10)'])
                fd = os.pidfd_open(child.pid)
                timer = threading.Timer(0.06, child.terminate) if exits else None
                try:
                    with open('/proc/sys/kernel/random/boot_id', encoding='ascii') as stream:
                        boot_id = stream.read().strip()
                    ticks = watchdog.process_start_ticks(child.pid)
                    args = SimpleNamespace(pidfd=fd, container_id=ID, boot_id=boot_id,
                                           process_fence={'pid': child.pid, 'start_ticks': ticks},
                                           pid_namespace=os.readlink('/proc/%d/ns/pid' % child.pid))
                    output = io.StringIO()
                    began = time.monotonic()
                    deadline = began + 0.18
                    if timer:
                        timer.start()
                    with mock.patch.object(watchdog, 'validate_host_pid', return_value=ticks), \
                            mock.patch.object(watchdog.signal, 'pidfd_send_signal', side_effect=PermissionError(errno.EACCES, 'denied')), \
                            mock.patch.object(watchdog.os, 'pidfd_open', side_effect=AssertionError('must never reopen')), \
                            contextlib.redirect_stdout(output):
                        self.assertEqual(watchdog.enforce_pidfd(args, 'stale', deadline), 0 if exits else 3)
                    elapsed = time.monotonic() - began
                    events = [json.loads(line)['event'] for line in output.getvalue().splitlines()]
                    self.assertIn('watchdog_pidfd_rejected', events)
                    self.assertNotIn('watchdog_pidfd_enforced', events)
                    if exits:
                        self.assertIn('watchdog_pinned_exit_observed', events)
                        self.assertGreaterEqual(elapsed, 0.04)
                    else:
                        self.assertIn('watchdog_enforcement_unconfirmed', events)
                        self.assertNotIn('watchdog_pinned_exit_observed', events)
                        self.assertGreaterEqual(elapsed, 0.15)
                        self.assertIsNone(child.poll())
                    self.assertLess(elapsed, 0.4)
                finally:
                    if timer:
                        timer.cancel()
                        timer.join()
                    os.close(fd)
                    if child.poll() is None:
                        child.kill()
                    child.wait(timeout=1)


if __name__ == '__main__':
    unittest.main()
