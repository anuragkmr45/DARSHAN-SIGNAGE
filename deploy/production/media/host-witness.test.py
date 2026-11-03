import importlib.util
import json
import os
from pathlib import Path
import tempfile
import contextlib
import http.server
import ssl
import subprocess
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('witness', Path(__file__).with_name('host-witness.py'))
witness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(witness)
watch_spec = importlib.util.spec_from_file_location('watchdog', Path(__file__).parents[3] / 'darshan-media/host-watchdog.py')
watchdog = importlib.util.module_from_spec(watch_spec)
watch_spec.loader.exec_module(watchdog)
MANAGED = '82ade1cd-21a8-4134-9d52-50a77a95de15'
NODE = '567bec75-913f-42e1-ad7e-e2cf990b4393'
EPOCH = '6e8746b0-714d-4950-bf72-42c0576f09f5'


class HostWitnessTests(unittest.TestCase):
    @contextlib.contextmanager
    def tls_server(self, slow=False):
        with tempfile.TemporaryDirectory() as directory:
            cert, key = Path(directory) / 'cert.pem', Path(directory) / 'key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-keyout', str(key), '-out', str(cert), '-subj', '/CN=localhost',
                            '-addext', 'subjectAltName=DNS:localhost'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            class Handler(http.server.BaseHTTPRequestHandler):
                def log_message(self, *_args):
                    pass
                def do_GET(self):
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    try:
                        if slow:
                            for _index in range(20):
                                self.wfile.write(b' ')
                                self.wfile.flush()
                                time.sleep(0.2)
                        else:
                            self.wfile.write(b'{"ready":true}')
                    except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                        pass
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                yield server.server_port, cert
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_actual_trusted_tls_and_wrong_hostname_rejection(self):
        with self.tls_server() as (port, cert):
            self.assertEqual(witness.https_json('https://localhost:%d/health' % port, 'synthetic-only', cert), {'ready': True})
            with self.assertRaises(ssl.SSLCertVerificationError):
                witness.https_json('https://127.0.0.1:%d/health' % port, 'synthetic-only', cert)

    def test_actual_slow_trickle_cannot_extend_total_https_deadline(self):
        with self.tls_server(slow=True) as (port, cert):
            began = time.monotonic()
            with self.assertRaisesRegex(witness.WitnessError, 'TOTAL_DEADLINE'):
                witness.https_json('https://localhost:%d/health' % port, 'synthetic-only', cert)
            self.assertLess(time.monotonic() - began, 2.3)

    def test_proofs_bind_old_boot_and_retry_without_new_id_or_changed_body(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proof.json'
            proof = witness.proof_for({'node_instance_id': NODE, 'authority_epoch': EPOCH,
                                       'managed_instance_id': MANAGED, 'process_start_ticks': '42'})
            witness.atomic_new(path, proof)
            original = path.read_bytes()
            with mock.patch.object(witness, 'private_bytes', side_effect=lambda name: Path(name).read_bytes()), \
                 mock.patch.object(witness, 'https_json', side_effect=[OSError(), {'accepted': True, 'node_instance_id': NODE}]) as transport:
                with self.assertRaises(OSError):
                    witness.deliver(path, 'https://backend.test/api/v1/internal/live-media-witness', 'private-secret', 'ca')
                self.assertFalse(path.with_suffix('.ack').exists())
                witness.deliver(path, 'https://backend.test/api/v1/internal/live-media-witness', 'private-secret', 'ca')
                self.assertEqual(transport.call_args_list[0].args[4], transport.call_args_list[1].args[4])
                self.assertEqual(path.read_bytes(), original)
                self.assertTrue(path.with_suffix('.ack').exists())
                self.assertTrue(witness.acknowledged(path))
                path.with_suffix('.ack').write_text('{"witness_id":"wrong"}')
                self.assertFalse(witness.acknowledged(path))

    def test_foreign_node_ack_never_marks_old_proof_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proof.json'
            witness.atomic_new(path, {'witness_id': MANAGED, 'node_instance_id': NODE})
            with mock.patch.object(witness, 'private_bytes', side_effect=lambda name: Path(name).read_bytes()), \
                 mock.patch.object(witness, 'https_json', return_value={'accepted': True, 'node_instance_id': MANAGED}):
                with self.assertRaisesRegex(witness.WitnessError, 'ACK_BINDING'):
                    witness.deliver(path, 'https://backend.test/api/v1/internal/live-media-witness', 'secret', 'ca')
                self.assertFalse(path.with_suffix('.ack').exists())

    def test_private_inputs_reject_wrong_owner_mode_links_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'secret'
            path.write_bytes(b'synthetic-only')
            path.chmod(0o600)
            self.assertEqual(witness.private_bytes(path, os.getuid()), b'synthetic-only')
            with self.assertRaisesRegex(witness.WitnessError, 'PRIVATE_FILE_REJECTED'):
                witness.private_bytes(path, os.getuid() + 1)
            path.chmod(0o644)
            with self.assertRaises(witness.WitnessError):
                witness.private_bytes(path, os.getuid())
            path.chmod(0o600)
            link = Path(directory) / 'hard'
            os.link(path, link)
            with self.assertRaises(witness.WitnessError):
                witness.private_bytes(path, os.getuid())
            link.unlink()
            link.symlink_to(path)
            with self.assertRaises(OSError):
                witness.private_bytes(link, os.getuid())

    def test_pin_rejects_wrong_container_image_and_reused_pid(self):
        pin = {'container_id': 'a' * 64, 'image_id': 'sha256:' + 'b' * 64, 'managed_instance_id': MANAGED,
               'heartbeat': '/run/private/heartbeat', 'host_pid': 123, 'process_start_ticks': '42', 'started_at': 'first-start'}
        info = {'Id': pin['container_id'], 'Image': pin['image_id'], 'RestartCount': 0, 'State': {'StartedAt': 'first-start'}}
        fake = SimpleNamespace(validate_target=lambda *_args: {'pid': 123, 'start_ticks': '42'})
        self.assertEqual(witness.validate_pin(info, pin, fake)['pid'], 123)
        for change in [{'Id': 'c' * 64}, {'Image': 'sha256:' + 'c' * 64}, {'RestartCount': 1}, {'State': {'StartedAt': 'later'}}]:
            with self.assertRaises(witness.WitnessError):
                witness.validate_pin({**info, **change}, pin, fake)
        fake.validate_target = lambda *_args: {'pid': 123, 'start_ticks': '99'}
        with self.assertRaisesRegex(witness.WitnessError, 'HOST_PROCESS_FENCE'):
            witness.validate_pin(info, pin, fake)

    def test_forged_heartbeat_does_not_arm_against_different_authenticated_boot(self):
        args = SimpleNamespace(container_id='a' * 64, image_id='sha256:' + 'b' * 64, instance_id=MANAGED, heartbeat='/run/pulse')
        fake = SimpleNamespace(validate_target=lambda *_args: {'pid': 123, 'start_ticks': '42', 'started_at': 'x'},
                               validate_heartbeat=lambda *_args: None, boottime_ms=lambda: 100, UUID=watchdog.UUID)
        health = {'protocol_version': 1, 'authority_mode': 'backend', 'managed_instance_id': MANAGED,
                  'node_instance_id': NODE, 'authority_epoch': EPOCH}
        with self.assertRaisesRegex(witness.WitnessError, 'HEALTH_HEARTBEAT'):
            witness.pin_target({'Image': args.image_id}, health, {'authority_node_instance_id': MANAGED, 'boottime_ms': 100}, args, fake, 'boot')
        with mock.patch.object(os, 'readlink', return_value='pid:[pinned]'):
            result = witness.pin_target({'Image': args.image_id}, health, {'authority_node_instance_id': NODE, 'boottime_ms': 100}, args, fake, 'boot')
        self.assertEqual(result['node_instance_id'], NODE)
        self.assertEqual(result['process_start_ticks'], '42')
        with self.assertRaisesRegex(witness.WitnessError, 'STALE_BOOT'):
            witness.pin_target({'Image': args.image_id}, health, {'authority_node_instance_id': NODE, 'boottime_ms': -2000}, args, fake, 'boot')

    def test_https_rejects_insecure_redirect_credentials_query_and_fragment(self):
        for url in ['http://backend.test/x', 'https://user:pass@backend.test/x', 'https://backend.test/x?a=1', 'https://backend.test/x#f']:
            with self.assertRaisesRegex(witness.WitnessError, 'HTTPS_ENDPOINT'):
                witness.https_json(url, 'secret', 'unused')

    def test_outbox_never_overwrites_existing_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proof.json'
            witness.atomic_new(path, {'one': 1})
            with self.assertRaises(FileExistsError):
                witness.atomic_new(path, {'one': 2})
            self.assertEqual(json.loads(path.read_text()), {'one': 1})
            self.assertEqual(list(Path(directory).glob('.pending-*')), [])


class HostReadinessTests(unittest.TestCase):
    def test_requires_root_owned_tmpfs_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            with mock.patch.object(os, 'geteuid', return_value=0):
                with self.assertRaises(watchdog.WatchdogError):
                    watchdog.HostReadinessLease(parent / 'lease', parent / 'witness', MANAGED)

    def test_marker_sequence_pid_binding_and_staleness(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            parent.chmod(0o755)
            marker = parent / 'witness.json'
            metadata = SimpleNamespace(st_mode=0o100644, st_uid=0, st_nlink=1)
            root_dir = SimpleNamespace(st_mode=0o40755, st_uid=0)
            with mock.patch.object(os, 'geteuid', return_value=0), mock.patch.object(os, 'lstat', return_value=root_dir), \
                 mock.patch.object(watchdog, 'require_tmpfs'), mock.patch.object(os, 'fstat', return_value=metadata), \
                 mock.patch.object(watchdog, 'process_start_ticks', return_value='42'):
                lease = watchdog.HostReadinessLease(parent / 'lease.json', marker, MANAGED)
                hb = {'authority_node_instance_id': NODE}
                self.assertFalse(lease.pulse(hb, 0))
                value = {'version': 1, 'node_instance_id': NODE, 'managed_instance_id': MANAGED, 'sequence': 1, 'pid': 123, 'start_ticks': '42'}
                marker.write_text(json.dumps(value))
                self.assertTrue(lease.pulse(hb, 0.1))
                self.assertEqual(json.loads((parent / 'lease.json').read_text())['node_instance_id'], NODE)
                self.assertTrue(lease.pulse(hb, 0.5))
                with self.assertRaisesRegex(watchdog.WatchdogError, 'STALE'):
                    lease.pulse(hb, 1.2)
                value['sequence'] = 2
                marker.write_text(json.dumps(value))
                self.assertTrue(lease.pulse(hb, 1.3))
                value['sequence'] = 1
                marker.write_text(json.dumps(value))
                with self.assertRaisesRegex(watchdog.WatchdogError, 'REPLAY'):
                    lease.pulse(hb, 1.4)
                value['node_instance_id'] = EPOCH
                marker.write_text(json.dumps(value))
                with self.assertRaisesRegex(watchdog.WatchdogError, 'BINDING'):
                    lease.pulse(hb, 1.5)
                value['node_instance_id'], value['sequence'] = NODE, 3
                marker.write_text(json.dumps(value))
                with mock.patch.object(watchdog, 'process_start_ticks', return_value='99'):
                    with self.assertRaisesRegex(watchdog.WatchdogError, 'PROCESS_CHANGED'):
                        lease.pulse(hb, 1.6)
                metadata.st_uid = 1000
                with self.assertRaisesRegex(watchdog.WatchdogError, 'OWNERSHIP'):
                    lease.pulse(hb, 1.6)


if __name__ == '__main__':
    unittest.main()
