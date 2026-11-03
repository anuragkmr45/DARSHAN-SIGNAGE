#!/usr/bin/env python3
"""Target-only live credentials. Never called by bundle generation."""
import argparse
import base64
import json
import ipaddress
import http.client
import os
from pathlib import Path
import secrets
import stat
import signal
import ssl
import subprocess
import uuid
from urllib.parse import urlsplit


def protected(path, uid=0, maximum=65536):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077 or info.st_nlink != 1:
            raise ValueError('PRIVATE_INPUT_OWNERSHIP')
        data = os.read(fd, maximum + 1)
        if len(data) > maximum:
            raise ValueError('PRIVATE_INPUT_TOO_LARGE')
        return data
    finally:
        os.close(fd)


def write_new(path, data, uid):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchown(fd, uid, uid)
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['backend', 'media', 'check-backend'])
    parser.add_argument('--metadata', required=True)
    parser.add_argument('--authority-import')
    parser.add_argument('--control-import')
    parser.add_argument('--witness-import')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('TARGET_ROOT_REQUIRED')
    meta = json.loads(Path(args.metadata).read_text())
    root = Path(meta.get('private_root', meta.get('privateRoot', '')))
    if not root.is_absolute() or str(root.parent.parent) != '/etc/darshan/sites':
        raise ValueError('UNEXPECTED_PRIVATE_ROOT')
    backend_uid = int(meta.get('effectiveUid', meta.get('backend_effective_uid', 1000)))
    if args.action == 'check-backend':
        for name in ['authority.json', 'control-secret', 'witness-secret', 'site-ca.crt']:
            protected(root / 'backend' / name, backend_uid)
        authority = json.loads(protected(root / 'backend' / 'authority.json', backend_uid))
        url = urlsplit(meta['mediaOrigin'])
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
            raise ValueError('MEDIA_CONTROL_HTTPS_ORIGIN_REQUIRED')
        control = protected(root / 'backend' / 'control-secret', backend_uid).decode().strip()
        connection = http.client.HTTPSConnection(url.hostname, url.port or 443,
            context=ssl.create_default_context(cafile=str(root / 'backend' / 'site-ca.crt')), timeout=1.5)
        def deadline(_signal, _frame):
            raise ValueError('MEDIA_HEALTH_TOTAL_DEADLINE')
        previous = signal.signal(signal.SIGALRM, deadline)
        signal.setitimer(signal.ITIMER_REAL, 1.5)
        try:
            connection.request('GET', '/internal/health', headers={'x-darshan-media-secret': control})
            response = connection.getresponse()
            body = response.read(8193)
            if response.status != 200 or len(body) > 8192:
                raise ValueError('MEDIA_HEALTH_UNAVAILABLE')
            health = json.loads(body)
            if (health.get('protocol_version') != 1 or health.get('authority_mode') != 'backend'
                    or health.get('status') != 'ready' or not health.get('accepting_new_runs')
                    or health.get('authority_epoch') != authority['epoch_id']):
                raise ValueError('MEDIA_EPOCH_READINESS_MISMATCH')
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)
            connection.close()
        print('Protected Backend inputs verified; cross-VM/TLS/watchdog release QA still required.')
        return
    role = root / args.action
    if role.exists():
        raise ValueError('PRIVATE_ROLE_ALREADY_EXISTS_NO_OVERWRITE')
    if args.action == 'media':
        if not all([args.authority_import, args.control_import, args.witness_import]):
            raise ValueError('MEDIA_REQUIRES_THREE_PROTECTED_IMPORT_FILES')
        authority = protected(args.authority_import)
        parsed = json.loads(authority)
        if set(parsed) != {'version', 'epoch_id', 'authority_secret'} or type(parsed['version']) is not int or parsed['version'] != 1:
            raise ValueError('AUTHORITY_SCHEMA')
        if uuid.UUID(parsed['epoch_id']).version not in (1, 2, 3, 4, 5):
            raise ValueError('AUTHORITY_UUID')
        decoded = base64.b64decode(parsed['authority_secret'] + '=', altchars=b'-_', validate=True)
        if len(decoded) != 32 or base64.urlsafe_b64encode(decoded).decode().rstrip('=') != parsed['authority_secret']:
            raise ValueError('AUTHORITY_SECRET')
        control, witness = protected(args.control_import).strip(), protected(args.witness_import).strip()
        if min(len(control), len(witness)) < 32 or max(len(control), len(witness)) > 4096 or b'\n' in control + witness or b'\r' in control + witness:
            raise ValueError('CONTROL_WITNESS_SECRET')
        if control == witness or parsed['authority_secret'].encode() in (control, witness):
            raise ValueError('DISTINCT_SECRETS_REQUIRED')
    role.mkdir(parents=True, mode=0o700)
    uid = backend_uid if args.action == 'backend' else 1000
    os.chown(role, uid, uid)
    if args.action == 'backend':
        authority = {'version': 1, 'epoch_id': str(uuid.uuid4()),
                     'authority_secret': base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('=')}
        write_new(role / 'authority.json', json.dumps(authority).encode(), uid)
        write_new(role / 'control-secret', secrets.token_hex(32).encode(), uid)
        write_new(role / 'witness-secret', secrets.token_hex(32).encode(), uid)
        print('Generated private Backend files on target. Securely transfer independent copies to Media; install site-ca.crt before activation.')
        return
    write_new(role / 'authority.json', authority, uid)
    write_new(role / 'control-secret', control, uid)
    # Host key/outbox are outside the ONLY directory mounted into the node.
    host = root / 'host'
    host.mkdir(mode=0o700, exist_ok=True)
    write_new(host / 'witness-secret', witness, 0)
    key, signing = secrets.token_hex(12), secrets.token_hex(32)
    write_new(role / 'signing.env', ('LIVEKIT_API_KEY=' + key + '\nLIVEKIT_API_SECRET=' + signing + '\n').encode(), uid)
    values = dict(line.split('=', 1) for line in Path('.env.production').read_text().splitlines() if '=' in line)
    yaml = ('port: 18781\nbind_addresses: [127.0.0.1]\nrtc:\n'
            '  tcp_port: %s\n  udp_port: %s\n  node_ip: %s\n  use_external_ip: false\n'
            '  stun_servers: []\n  turn_servers: []\nkeys:\n  %s: %s\nlogging:\n  level: warn\n') % (
                values['MEDIA_RTC_TCP_PORT'], values['MEDIA_RTC_UDP_PORT'], values['MEDIA_BIND_ADDRESS'], key, signing)
    write_new(role / 'livekit.yaml', yaml.encode(), uid)
    try:
        ipaddress.ip_address(values['MEDIA_PRIVATE_HOST'])
        san = 'IP:' + values['MEDIA_PRIVATE_HOST']
    except ValueError:
        san = 'DNS:' + values['MEDIA_PRIVATE_HOST']
    subprocess.run(['openssl', 'req', '-new', '-newkey', 'rsa:3072', '-nodes', '-keyout', str(role / 'media.key'),
                    '-out', str(role / 'media.csr'), '-subj', '/CN=' + values['MEDIA_PRIVATE_HOST'],
                    '-addext', 'subjectAltName=' + san],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    os.chown(role / 'media.key', uid, uid)
    os.chmod(role / 'media.key', 0o600)
    os.chmod(role / 'media.csr', 0o644)
    print('Generated target-only Media signing secret/key/CSR. Obtain site-issued media.crt and install private site-ca.crt; no self-signed fallback.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Live private provisioning rejected: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__))
        raise SystemExit(1)
