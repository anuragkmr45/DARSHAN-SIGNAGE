#!/usr/bin/env python3
"""Root-only physical-death witness with a durable, immutable HTTPS outbox.

It observes; it never kills. The independent watchdog remains the actuator.
"""
import argparse
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import signal
import ssl
import stat
import sys
import time
from urllib.parse import urlsplit
import uuid


class WitnessError(Exception):
    pass


def private_bytes(path, uid=0, limit=65536):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077 or info.st_nlink != 1:
            raise WitnessError('PRIVATE_FILE_REJECTED')
        data = os.read(fd, limit + 1)
        if len(data) > limit:
            raise WitnessError('PRIVATE_FILE_TOO_LARGE')
        return data
    finally:
        os.close(fd)


def atomic_new(path, value):
    data = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    temporary = Path(path).with_name('.pending-' + str(uuid.uuid4()))
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        os.link(temporary, path, follow_symlinks=False)
    finally:
        os.unlink(temporary)
    directory = os.open(str(Path(path).parent), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def https_json(url, secret, ca, method='GET', payload=None, header='x-darshan-media-secret', allow_starting_health=False):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise WitnessError('HTTPS_ENDPOINT_REJECTED')
    context = ssl.create_default_context(cafile=str(ca))
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, context=context, timeout=1.5)
    began = time.monotonic()
    def deadline(_signum, _frame):
        raise WitnessError('HTTPS_TOTAL_DEADLINE')
    old_handler = signal.signal(signal.SIGALRM, deadline)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, 1.5)
    try:
        connection.request(method, parsed.path or '/', body=None if payload is None else json.dumps(payload),
                           headers={header: secret, 'content-type': 'application/json'})
        if connection.sock:
            connection.sock.settimeout(max(0.001, 1.5 - (time.monotonic() - began)))
        response = connection.getresponse()
        if connection.sock:
            connection.sock.settimeout(max(0.001, 1.5 - (time.monotonic() - began)))
        body = response.read(8193)
        allowed_status = response.status == 200 or (allow_starting_health and method == 'GET' and parsed.path == '/internal/health' and response.status == 503)
        if not allowed_status or len(body) > 8192 or time.monotonic() - began > 1.5:
            raise WitnessError('HTTPS_ACK_REJECTED')
        return json.loads(body)
    finally:
        signal.setitimer(signal.ITIMER_REAL, *previous_timer)
        signal.signal(signal.SIGALRM, old_handler)
        connection.close()


def validate_pin(info, pin, watchdog):
    if info.get('Id') != pin['container_id'] or info.get('Image') != pin['image_id']:
        raise WitnessError('CONTAINER_IMAGE_FENCE_CHANGED')
    current = watchdog.validate_target(info, pin['container_id'], pin['managed_instance_id'], pin['heartbeat'])
    if (info.get('RestartCount') != 0 or info.get('State', {}).get('StartedAt') != pin['started_at']):
        raise WitnessError('CONTAINER_START_FENCE_CHANGED')
    if current is not None and (current['pid'] != pin['host_pid'] or current['start_ticks'] != pin['process_start_ticks']):
        raise WitnessError('HOST_PROCESS_FENCE_CHANGED')
    return current


def pin_target(info, health, heartbeat, args, watchdog, boot_id):
    if not re.fullmatch(r'[a-f0-9]{64}', args.container_id) or not re.fullmatch(r'sha256:[a-f0-9]{64}', args.image_id):
        raise WitnessError('FULL_CONTAINER_IMAGE_IDS_REQUIRED')
    current = watchdog.validate_target(info, args.container_id, args.instance_id, args.heartbeat)
    if current is None or info.get('Image') != args.image_id:
        raise WitnessError('RUNNING_MATCHING_IMAGE_REQUIRED')
    now = watchdog.boottime_ms()
    watchdog.validate_heartbeat(heartbeat, args.instance_id, current['start_ticks'], boot_id, now)
    if type(heartbeat.get('boottime_ms')) is not int or now - heartbeat['boottime_ms'] > 1500:
        raise WitnessError('STALE_BOOT_HEARTBEAT_REJECTED')
    if (health.get('protocol_version') != 1 or health.get('authority_mode') != 'backend'
            or health.get('managed_instance_id') != args.instance_id
            or health.get('node_instance_id') != heartbeat.get('authority_node_instance_id')
            or not watchdog.UUID.fullmatch(health.get('authority_epoch', ''))
            or health.get('node_instance_id') == args.instance_id):
        raise WitnessError('HEALTH_HEARTBEAT_AUTHORITY_FENCE_REJECTED')
    return {'version': 1, 'container_id': args.container_id, 'image_id': args.image_id,
            'managed_instance_id': args.instance_id, 'node_instance_id': health['node_instance_id'],
            'authority_epoch': health['authority_epoch'], 'host_pid': current['pid'],
            'process_start_ticks': current['start_ticks'], 'started_at': current['started_at'],
            'pid_namespace': os.readlink('/proc/%d/ns/pid' % current['pid']), 'host_boot_id': boot_id,
            'heartbeat': args.heartbeat}


def proof_for(pin):
    return {'witness_id': str(uuid.uuid4()), 'node_instance_id': pin['node_instance_id'],
            'authority_epoch': pin['authority_epoch'], 'managed_instance_id': pin['managed_instance_id'],
            'process_start_ticks': pin['process_start_ticks'], 'reason': 'PINNED_PROCESS_EXIT'}


def write_marker(directory, pin, sequence, start_ticks):
    value = {'version': 1, 'node_instance_id': pin['node_instance_id'], 'managed_instance_id': pin['managed_instance_id'],
             'sequence': sequence, 'pid': os.getpid(), 'start_ticks': start_ticks}
    temporary = directory / ('.witness-%s' % sequence)
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644)
    try:
        os.fchmod(fd, 0o644)
        os.write(fd, json.dumps(value, separators=(',', ':')).encode())
    finally:
        os.close(fd)
    os.replace(temporary, directory / 'witness.json')


def acknowledged(path):
    try:
        payload, body = json.loads(private_bytes(path)), private_bytes(path)
        ack = json.loads(private_bytes(path.with_suffix('.ack')))
        return ack == {'witness_id': payload['witness_id'], 'body_sha256': hashlib.sha256(body).hexdigest()}
    except Exception:
        return False


def deliver(path, url, secret, ca):
    payload = json.loads(private_bytes(path))
    if urlsplit(url).path != '/api/v1/internal/live-media-witness':
        raise WitnessError('WITNESS_PATH_REJECTED')
    result = https_json(url, secret, ca, 'POST', payload, 'x-darshan-live-witness-secret')
    if result != {'accepted': True, 'node_instance_id': payload['node_instance_id']}:
        raise WitnessError('WITNESS_ACK_BINDING_REJECTED')
    ack = path.with_suffix('.ack')
    if not ack.exists():
        atomic_new(ack, {'witness_id': payload['witness_id'], 'body_sha256': hashlib.sha256(private_bytes(path)).hexdigest()})
    elif not acknowledged(path):
        raise WitnessError('CORRUPT_ACK_RETAINED_FOR_REVIEW')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['watch', 'retry'])
    parser.add_argument('--metadata', required=True)
    parser.add_argument('--outbox', required=True)
    parser.add_argument('--container-id')
    parser.add_argument('--image-id')
    parser.add_argument('--instance-id')
    parser.add_argument('--heartbeat')
    parser.add_argument('--readiness-directory')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise WitnessError('HOST_ROOT_REQUIRED')
    meta = json.loads(Path(args.metadata).read_text())
    root, outbox = Path(meta['private_root']), Path(args.outbox)
    expected = root / 'host' / 'witness-outbox'
    if outbox != expected:
        raise WitnessError('OUTBOX_PATH_REJECTED')
    outbox.mkdir(mode=0o700, exist_ok=True)
    status = os.lstat(outbox)
    if not stat.S_ISDIR(status.st_mode) or status.st_uid != 0 or status.st_mode & 0o077:
        raise WitnessError('OUTBOX_OWNERSHIP_REJECTED')
    witness = private_bytes(root / 'host' / 'witness-secret').decode().strip()
    if len(witness) < 32 or '\n' in witness or '\r' in witness:
        raise WitnessError('WITNESS_SECRET_REJECTED')
    ca = root / 'host' / 'site-ca.crt'
    private_bytes(ca)
    if args.mode == 'retry':
        for path in sorted(outbox.glob('*.json')):
            if not acknowledged(path):
                try:
                    deliver(path, meta['witness_url'], witness, ca)
                    print(json.dumps({'event': 'host_witness_acknowledged', 'proof': path.stem}), flush=True)
                except Exception:
                    print(json.dumps({'event': 'host_witness_retry_pending', 'proof': path.stem}), flush=True)
        return
    if not all([args.container_id, args.image_id, args.instance_id, args.heartbeat, args.readiness_directory]):
        raise WitnessError('EXPLICIT_TARGET_REQUIRED')
    spec = importlib.util.spec_from_file_location('darshan_watchdog', Path(__file__).with_name('host-watchdog.py'))
    watchdog = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(watchdog)
    readiness = Path(args.readiness_directory)
    if str(readiness) != '/run/darshan-media-host-lease/' + args.instance_id:
        raise WitnessError('READINESS_DIRECTORY_REJECTED')
    gate_metadata = os.lstat(readiness)
    if not stat.S_ISDIR(gate_metadata.st_mode) or gate_metadata.st_uid != 0 or gate_metadata.st_mode & 0o022:
        raise WitnessError('READINESS_OWNERSHIP_REJECTED')
    watchdog.require_tmpfs(readiness)
    watchdog.validate_local_endpoint('default')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    pin_path = root / 'host' / (args.instance_id + '.pin')
    if pin_path.exists():
        pin = json.loads(private_bytes(pin_path))
        if (pin['container_id'], pin['image_id'], pin['managed_instance_id'], pin['heartbeat'], pin['host_boot_id']) != (
                args.container_id, args.image_id, args.instance_id, args.heartbeat, boot):
            raise WitnessError('PERSISTED_PIN_FENCE_CHANGED')
        current = validate_pin(watchdog.inspect_container('default', args.container_id), pin, watchdog)
    else:
        info = watchdog.inspect_container('default', args.container_id)
        control = private_bytes(root / 'media' / 'control-secret', 1000).decode().strip()
        startup_deadline = time.monotonic() + 8
        while True:
            try:
                health = https_json(meta['control_url'] + '/internal/health', control, ca, allow_starting_health=True)
                break
            except Exception:
                if time.monotonic() >= startup_deadline:
                    raise WitnessError('MEDIA_BOOT_METADATA_UNAVAILABLE') from None
                time.sleep(0.1)
        heartbeat = watchdog.read_heartbeat(args.heartbeat, 1000)
        pin = pin_target(info, health, heartbeat, args, watchdog, boot)
        atomic_new(pin_path, pin)
        current = {'pid': pin['host_pid']}
    proof_path = outbox / (args.instance_id + '.json')
    if current is not None:
        fd = os.pidfd_open(pin['host_pid'])
        try:
            # Close the PID-open race by revalidating the original identity.
            validate_pin(watchdog.inspect_container('default', args.container_id), pin, watchdog)
            if watchdog.process_start_ticks(pin['host_pid']) != pin['process_start_ticks']:
                raise WitnessError('PID_REUSE_REJECTED')
            if os.readlink('/proc/%d/ns/pid' % pin['host_pid']) != pin['pid_namespace']:
                raise WitnessError('PID_NAMESPACE_CHANGED')
            print(json.dumps({'event': 'host_witness_armed', 'instance_id': args.instance_id}), flush=True)
            poller = select.poll()
            poller.register(fd, select.POLLIN)
            marker_sequence, own_start = 0, watchdog.process_start_ticks(os.getpid())
            while not poller.poll(100):
                if Path('/proc/sys/kernel/random/boot_id').read_text().strip() != boot:
                    raise WitnessError('HOST_BOOT_CHANGED')
                marker_sequence += 1
                write_marker(readiness, pin, marker_sequence, own_start)
                # Only the held handle's exit authorizes a witness; new nodes,
                # daemon failures and heartbeat silence do not authorize proof.
        finally:
            os.close(fd)
    if not proof_path.exists():
        atomic_new(proof_path, proof_for(pin))
    while not acknowledged(proof_path):
        try:
            deliver(proof_path, meta['witness_url'], witness, ca)
            print(json.dumps({'event': 'host_witness_acknowledged', 'instance_id': args.instance_id}), flush=True)
        except Exception:
            print(json.dumps({'event': 'host_witness_retry_pending', 'instance_id': args.instance_id}), flush=True)
            time.sleep(5)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'event': 'host_witness_rejected', 'code': str(error) if isinstance(error, WitnessError) else type(error).__name__}), flush=True)
        sys.exit(2)
