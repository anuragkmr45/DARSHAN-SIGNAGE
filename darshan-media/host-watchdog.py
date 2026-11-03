#!/usr/bin/env python3
"""Fail-closed host enforcement for one explicitly fenced DARSHAN media container.

Python standard library + Docker CLI only. Never discovers targets by name and
never prints Docker inspect output, environment values, or heartbeat contents.
"""
import argparse
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import time
import urllib.parse
import signal
import select

LABEL_MANAGED = 'com.darshan.media.managed'
LABEL_ROLE = 'com.darshan.media.role'
LABEL_INSTANCE = 'com.darshan.media.instance'
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.I)


class WatchdogError(Exception):
    pass


def boottime_ms():
    # CLOCK_BOOTTIME includes suspend; /proc/uptime shares that clock with the SFU host.
    with open('/proc/uptime', encoding='ascii') as stream:
        return int(float(stream.read(100).split()[0]) * 1000)


def process_start_ticks(pid):
    with open('/proc/%d/stat' % pid, encoding='ascii') as stream:
        value = stream.read(4096)
    return value[value.rfind(')') + 2:].split()[19]


def mount_filesystem_type(path, mountinfo, device=None):
    """Resolve the longest mount component prefix, including escaped mount names."""
    selected = None
    longest = -1
    for line in mountinfo.splitlines():
        left, separator, right = line.partition(' - ')
        fields, details = left.split(), right.split()
        if not separator or len(fields) < 6 or len(details) < 3:
            raise WatchdogError('HEARTBEAT_FILESYSTEM_UNVERIFIABLE')
        mount = re.sub(r'\\([0-7]{3})', lambda match: chr(int(match.group(1), 8)), fields[4])
        if device is not None and fields[2] != device:
            continue
        if (path == mount or path.startswith(mount.rstrip('/') + '/')) and len(mount) >= longest:
            selected, longest = details[0], len(mount)
    if selected is None:
        raise WatchdogError('HEARTBEAT_FILESYSTEM_UNVERIFIABLE')
    return selected


def require_tmpfs(parent):
    metadata = os.stat(parent)
    device = '%d:%d' % (os.major(metadata.st_dev), os.minor(metadata.st_dev))
    with open('/proc/self/mountinfo', encoding='utf8') as stream:
        filesystem = mount_filesystem_type(str(parent), stream.read(), device)
    if filesystem != 'tmpfs':
        raise WatchdogError('HEARTBEAT_DIRECTORY_REQUIRES_TMPFS')


def docker_call(context, arguments, timeout):
    try:
        result = subprocess.run(['docker', '--context', context] + arguments, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=timeout, check=True)
        if len(result.stdout) > 1024 * 1024:
            raise WatchdogError('DOCKER_RESPONSE_TOO_LARGE')
        return result.stdout
    except (subprocess.SubprocessError, OSError):
        raise WatchdogError('DOCKER_OPERATION_UNAVAILABLE') from None


def inspect_container(context, container_id, timeout=0.25):
    try:
        result = json.loads(docker_call(context, ['inspect', container_id], timeout))
        if not isinstance(result, list) or len(result) != 1:
            raise ValueError()
        return result[0]
    except (ValueError, TypeError):
        raise WatchdogError('INVALID_DOCKER_RESPONSE') from None


def validate_local_endpoint(context):
    try:
        details = json.loads(docker_call(context, ['context', 'inspect', context], 0.25))
        endpoint = details[0]['Endpoints']['docker']['Host']
        url = urllib.parse.urlsplit(endpoint)
        if url.scheme != 'unix' or url.netloc or not url.path.startswith('/') or url.query or url.fragment:
            raise WatchdogError('DOCKER_ENDPOINT_MUST_BE_LOCAL_UNIX')
        resolved = os.path.realpath(url.path)
        metadata = os.stat(resolved)
        if not stat.S_ISSOCK(metadata.st_mode):
            raise WatchdogError('DOCKER_ENDPOINT_NOT_A_SOCKET')
        return (resolved, metadata.st_dev, metadata.st_ino)
    except (ValueError, KeyError, IndexError, TypeError, OSError):
        raise WatchdogError('DOCKER_ENDPOINT_UNVERIFIABLE') from None


def validate_host_pid(pid, container_id):
    """Reject VM/remote/rootless PID domains before relating /proc to Docker state."""
    with open('/proc/%d/cgroup' % pid, encoding='ascii') as stream:
        if container_id not in stream.read(16384):
            raise WatchdogError('HOST_PID_CGROUP_REJECTED')
    with open('/proc/%d/status' % pid, encoding='ascii') as stream:
        namespace = next((line.split()[1:] for line in stream if line.startswith('NSpid:')), None)
    if not namespace or namespace[0] != str(pid) or namespace[-1] != '1':
        raise WatchdogError('HOST_PID_NAMESPACE_REJECTED')
    return process_start_ticks(pid)


def validate_target(info, container_id, instance, heartbeat_path):
    """A failed identity fence never authorizes killing a container."""
    if info.get('Id') != container_id:
        raise WatchdogError('TARGET_ID_REJECTED')
    config = info.get('Config') or {}
    labels = config.get('Labels') or {}
    if (labels.get(LABEL_MANAGED) != '1' or labels.get(LABEL_ROLE) != 'media-node'
            or labels.get(LABEL_INSTANCE) != instance):
        raise WatchdogError('TARGET_LABELS_REJECTED')
    if (info.get('HostConfig') or {}).get('RestartPolicy', {}).get('Name') not in ('', 'no'):
        raise WatchdogError('AUTOMATIC_RESTART_NOT_ALLOWED')
    if (info.get('HostConfig') or {}).get('PidMode', '') not in ('', 'private'):
        raise WatchdogError('TARGET_PID_NAMESPACE_NOT_PRIVATE')
    env = {}
    for value in config.get('Env') or []:
        if '=' in value:
            key, content = value.split('=', 1)
            env[key] = content
    container_path = env.get('DARSHAN_MEDIA_SUPERVISOR_STATE_FILE', '')
    if env.get('DARSHAN_MEDIA_NODE_INSTANCE_ID') != instance or not container_path.startswith('/'):
        raise WatchdogError('TARGET_INSTANCE_REJECTED')
    expected_parent = str(pathlib.Path(heartbeat_path).parent)
    matching = [mount for mount in info.get('Mounts', []) if mount.get('Type') == 'bind'
                and mount.get('Source') == expected_parent
                and mount.get('Destination') == str(pathlib.PurePosixPath(container_path).parent)
                and mount.get('RW') is True]
    if len(matching) != 1 or pathlib.Path(heartbeat_path).name != pathlib.PurePosixPath(container_path).name:
        raise WatchdogError('TARGET_HEARTBEAT_MOUNT_REJECTED')
    state = info.get('State') or {}
    if not state.get('Running'):
        return None
    pid = state.get('Pid')
    if type(pid) is not int or pid <= 0 or not state.get('StartedAt') or info.get('RestartCount') != 0:
        raise WatchdogError('TARGET_START_FENCE_REJECTED')
    return {'pid': pid, 'started_at': state['StartedAt'], 'start_ticks': validate_host_pid(pid, container_id)}


def read_heartbeat(filename, expected_uid):
    name = pathlib.Path(filename)
    if not name.is_absolute() or str(name) != os.path.abspath(filename):
        raise WatchdogError('HEARTBEAT_PATH_NOT_CANONICAL')
    current = pathlib.Path(name.anchor)
    for part in name.parts[1:-1]:
        current /= part
        metadata = os.lstat(current)
        if stat.S_ISLNK(metadata.st_mode):
            raise WatchdogError('HEARTBEAT_PATH_SYMLINK')
    parent = os.lstat(name.parent)
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != expected_uid or parent.st_mode & 0o077:
        raise WatchdogError('HEARTBEAT_DIRECTORY_OWNERSHIP')
    parent_fd = os.open(name.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open(name.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        try:
            metadata = os.fstat(fd)
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != expected_uid
                    or metadata.st_mode & 0o077 or metadata.st_nlink not in (0, 1)):
                raise WatchdogError('HEARTBEAT_FILE_OWNERSHIP')
            # Atomic replacement may unlink the already-opened private old inode.
            # It stays safe to read; content freshness/instance fences still apply.
            content = os.read(fd, 4097)
        finally:
            os.close(fd)
    finally:
        os.close(parent_fd)
    if len(content) > 4096:
        raise WatchdogError('HEARTBEAT_TOO_LARGE')
    try:
        value = json.loads(content)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise WatchdogError('HEARTBEAT_INVALID_JSON') from None


def validate_heartbeat(value, instance, start_ticks, boot_id, now_ms, previous=None):
    fields = {'schema_version', 'instance_id', 'supervisor_pid', 'process_start_ticks',
              'sequence', 'boottime_ms', 'boot_id', 'phase'}
    optional = {'authority_node_instance_id'}
    if set(value) not in (fields, fields | optional) or value.get('schema_version') != 1:
        raise WatchdogError('HEARTBEAT_SCHEMA_REJECTED')
    if 'authority_node_instance_id' in value and (not isinstance(value['authority_node_instance_id'], str)
                                                or not UUID.fullmatch(value['authority_node_instance_id'])):
        raise WatchdogError('HEARTBEAT_AUTHORITY_INSTANCE_REJECTED')
    if previous and value.get('authority_node_instance_id') != previous.get('authority_node_instance_id'):
        raise WatchdogError('HEARTBEAT_AUTHORITY_INSTANCE_CHANGED')
    if value.get('instance_id') != instance or value.get('supervisor_pid') != 1 or value.get('process_start_ticks') != start_ticks:
        raise WatchdogError('HEARTBEAT_INSTANCE_REJECTED')
    if value.get('boot_id') != boot_id:
        raise WatchdogError('HEARTBEAT_CLOCK_DOMAIN_REJECTED')
    if type(value.get('sequence')) is not int or value['sequence'] < 1 or value['sequence'] > 2**53 - 1:
        raise WatchdogError('HEARTBEAT_SEQUENCE_REJECTED')
    if type(value.get('boottime_ms')) is not int or value['boottime_ms'] <= 0 or value['boottime_ms'] > now_ms + 50:
        raise WatchdogError('HEARTBEAT_FUTURE_OR_INVALID_CLOCK')
    if value.get('phase') not in ('STARTING', 'RUNNING', 'STOPPING'):
        raise WatchdogError('HEARTBEAT_PHASE_REJECTED')
    if previous and (value['sequence'] < previous['sequence'] or
                     (value['sequence'] == previous['sequence'] and value['boottime_ms'] != previous['boottime_ms']) or
                     value['boottime_ms'] < previous['boottime_ms']):
        raise WatchdogError('HEARTBEAT_REPLAY_REJECTED')
    return value


def validate_monitor_gap(previous_boottime, now_ms):
    if previous_boottime is not None and (now_ms < previous_boottime or now_ms - previous_boottime > 1500):
        raise WatchdogError('HOST_MONITOR_BOOTTIME_GAP')


def event(name, **values):
    print(json.dumps({'event': name, **values}, separators=(',', ':')), flush=True)


class HostReadinessLease:
    """Optional production gate: only the independently pinned host can pulse.

    The witness marker is another root-owned, advancing host loop. Neither
    marker nor this lease is writable inside the media namespace.
    """
    def __init__(self, lease_file, witness_file, instance):
        self.lease = pathlib.Path(lease_file)
        self.witness = pathlib.Path(witness_file)
        self.instance = instance
        self.sequence = 0
        self.last_witness_sequence = None
        self.last_progress = None
        if os.geteuid() != 0 or not self.lease.is_absolute() or not self.witness.is_absolute():
            raise WatchdogError('HOST_LEASE_CONFIGURATION_REJECTED')
        for parent in (self.lease.parent, self.witness.parent):
            metadata = os.lstat(parent)
            if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022):
                raise WatchdogError('HOST_LEASE_DIRECTORY_REJECTED')
            require_tmpfs(parent)

    def pulse(self, heartbeat, now=None):
        now = time.monotonic() if now is None else now
        authority = heartbeat.get('authority_node_instance_id')
        if not isinstance(authority, str) or not UUID.fullmatch(authority):
            raise WatchdogError('HOST_LEASE_AUTHORITY_REQUIRED')
        try:
            fd = os.open(self.witness, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            if self.last_progress is None:
                return False  # Boot metadata is visible; admissions remain closed.
            raise WatchdogError('HOST_WITNESS_LEASE_MISSING') from None
        try:
            metadata = os.fstat(fd)
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022
                    or metadata.st_nlink not in (0, 1)):
                raise WatchdogError('HOST_WITNESS_LEASE_OWNERSHIP')
            raw = os.read(fd, 4097)
            if len(raw) > 4096:
                raise WatchdogError('HOST_WITNESS_LEASE_INVALID')
            value = json.loads(raw)
        except (ValueError, UnicodeError):
            raise WatchdogError('HOST_WITNESS_LEASE_INVALID') from None
        finally:
            os.close(fd)
        expected = {'version', 'node_instance_id', 'managed_instance_id', 'sequence', 'pid', 'start_ticks'}
        if (not isinstance(value, dict) or set(value) != expected or type(value.get('version')) is not int or value.get('version') != 1 or value.get('node_instance_id') != authority
                or value.get('managed_instance_id') != self.instance or type(value.get('sequence')) is not int
                or not 1 <= value['sequence'] <= 2**53 - 1 or type(value.get('pid')) is not int or value['pid'] <= 1
                or not isinstance(value.get('start_ticks'), str) or not value['start_ticks'].isdigit()):
            raise WatchdogError('HOST_WITNESS_LEASE_BINDING')
        if process_start_ticks(value['pid']) != value['start_ticks']:
            raise WatchdogError('HOST_WITNESS_PROCESS_CHANGED')
        if self.last_witness_sequence is not None and value['sequence'] < self.last_witness_sequence:
            raise WatchdogError('HOST_WITNESS_LEASE_REPLAY')
        if self.last_witness_sequence != value['sequence']:
            self.last_witness_sequence, self.last_progress = value['sequence'], now
        if now - self.last_progress > 1.0:
            raise WatchdogError('HOST_WITNESS_LEASE_STALE')
        self.sequence += 1
        payload = {'version': 1, 'node_instance_id': authority, 'managed_instance_id': self.instance,
                   'sequence': self.sequence, 'ready': True}
        temporary = self.lease.with_name('.pulse-%s-%s' % (os.getpid(), self.sequence))
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644)
        try:
            os.fchmod(fd, 0o644)
            os.write(fd, json.dumps(payload, separators=(',', ':')).encode())
        finally:
            os.close(fd)
        os.replace(temporary, self.lease)
        return True


def pin_pidfd(args, fence, boot_id):
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise WatchdogError('PIDFD_ENFORCEMENT_UNSUPPORTED')
    fd = os.pidfd_open(fence['pid'], 0)
    try:
        signal.pidfd_send_signal(fd, 0)  # Permission/liveness check without mutation.
        if validate_host_pid(fence['pid'], args.container_id) != fence['start_ticks']:
            raise WatchdogError('PIDFD_START_FENCE_CHANGED')
        args.pidfd = fd
        args.process_fence = fence
        args.pid_namespace = os.readlink('/proc/%d/ns/pid' % fence['pid'])
        args.boot_id = boot_id
    except Exception:
        os.close(fd)
        raise


def pidfd_dead(fd):
    poll = select.poll()
    poll.register(fd, select.POLLIN)
    return bool(poll.poll(0))


def wait_pinned_exit(fd, deadline):
    poll = select.poll()
    poll.register(fd, select.POLLIN)
    return bool(poll.poll(max(0, int((deadline - time.monotonic()) * 1000))))


def enforce_pidfd(args, reason, deadline):
    """Kill only the originally pinned private-namespace PID1; never reopen by PID."""
    stage = 'PINNED_HANDLE'
    try:
        if not hasattr(args, 'pidfd'):
            raise WatchdogError('NO_PINNED_PIDFD')
        if pidfd_dead(args.pidfd):
            event('watchdog_pinned_namespace_already_dead', reason=reason)
            return 0
        stage = 'BOOT_DOMAIN'
        with open('/proc/sys/kernel/random/boot_id', encoding='ascii') as stream:
            if stream.read(100).strip() != args.boot_id:
                raise WatchdogError('PIDFD_BOOT_DOMAIN_CHANGED')
        fence = args.process_fence
        stage = 'HOST_PROCESS_FENCE'
        if (validate_host_pid(fence['pid'], args.container_id) != fence['start_ticks']
                or os.readlink('/proc/%d/ns/pid' % fence['pid']) != args.pid_namespace):
            raise WatchdogError('PIDFD_IDENTITY_FENCE_CHANGED')
        stage = 'SIGNAL_PINNED_HANDLE'
        signal.pidfd_send_signal(args.pidfd, signal.SIGKILL)
        stage = 'CONFIRM_PINNED_EXIT'
        if wait_pinned_exit(args.pidfd, deadline):
            event('watchdog_pidfd_enforced', reason=reason, container_id=args.container_id[:12])
            return 0
    except WatchdogError as error:
        event('watchdog_pidfd_rejected', code=str(error))
    except OSError as error:
        event('watchdog_pidfd_rejected', code='OS_ERROR_%s' % error.errno, stage=stage)
        # A prior Docker SIGKILL can still be completing when this fallback is
        # denied by host policy. Observe the original handle until the original
        # deadline; never reopen a PID or claim this denied signal killed it.
        if stage == 'SIGNAL_PINNED_HANDLE' and wait_pinned_exit(args.pidfd, deadline):
            event('watchdog_pinned_exit_observed', reason=reason, container_id=args.container_id[:12],
                  pidfd_signal_confirmed=False)
            return 0
    event('watchdog_enforcement_unconfirmed', reason=reason, container_id=args.container_id[:12])
    return 3


def enforce(args, reason):
    """Guard and kill by full ID only. Enforcement is bounded to one second."""
    deadline = time.monotonic() + 1.0
    docker_deadline = deadline - 0.3  # Preserve a bounded independent PID1 actuator budget.
    try:
        endpoint = validate_local_endpoint(args.docker_context)
        if getattr(args, 'endpoint_fence', endpoint) != endpoint:
            raise WatchdogError('DOCKER_ENDPOINT_FENCE_CHANGED')
        current = inspect_container(args.docker_context, args.container_id, 0.25)
        # Repeat the identity/mount fence immediately before any destructive command.
        validate_target(current, args.container_id, args.instance_id, args.heartbeat)
        if not current.get('State', {}).get('Running'):
            event('watchdog_container_already_stopped', reason=reason)
            return 0
        docker_call(args.docker_context, ['kill', '--signal', 'KILL', args.container_id],
                    max(0.05, min(0.25, docker_deadline - time.monotonic())))
        while time.monotonic() < docker_deadline:
            state = inspect_container(args.docker_context, args.container_id,
                                      max(0.05, min(0.25, docker_deadline - time.monotonic())))
            if not state.get('State', {}).get('Running'):
                event('watchdog_killed_pinned_container', reason=reason, container_id=args.container_id[:12])
                return 0
            time.sleep(0.025)
    except WatchdogError as error:
        if str(error) != 'DOCKER_OPERATION_UNAVAILABLE':
            event('watchdog_enforcement_target_rejected', code=str(error))
            return 3
    except OSError:
        return enforce_pidfd(args, reason, deadline)
    return enforce_pidfd(args, reason, deadline)


def monitor(args):
    try:
        # Configuration fence before inspecting/pinning or declaring readiness.
        require_tmpfs(pathlib.Path(args.heartbeat).parent)
        args.endpoint_fence = validate_local_endpoint(args.docker_context)
        initial = inspect_container(args.docker_context, args.container_id)
        fence = validate_target(initial, args.container_id, args.instance_id, args.heartbeat)
    except (WatchdogError, OSError) as error:
        event('watchdog_target_rejected', code=str(error) if isinstance(error, WatchdogError) else 'TARGET_PROCESS_UNAVAILABLE')
        return 3 if str(error) == 'DOCKER_OPERATION_UNAVAILABLE' else 2
    if fence is None:
        event('watchdog_target_not_running')
        return 0
    with open('/proc/sys/kernel/random/boot_id', encoding='ascii') as stream:
        boot_id = stream.read(100).strip()
    try:
        pin_pidfd(args, fence, boot_id)
    except (WatchdogError, OSError):
        event('watchdog_pidfd_pin_failed')
        return 3
    try:
        return monitor_pinned(args, fence, boot_id)
    finally:
        os.close(args.pidfd)


def monitor_pinned(args, fence, boot_id):
    began = boottime_ms()
    previous = None
    ready = False
    last_inspect = time.monotonic()
    docker_unavailable_since = None
    last_boottime = began
    try:
        lease = HostReadinessLease(args.host_lease_file, args.witness_ready_file, args.instance_id) if getattr(args, 'host_lease_file', None) else None
    except (WatchdogError, OSError):
        event('watchdog_configuration_rejected', code='HOST_LEASE_CONFIGURATION_REJECTED')
        return 2
    while True:
        tick = time.monotonic()
        try:
            # The pidfd is the immutable process-lifetime fence established
            # while the local Docker endpoint and full container identity were
            # available. Docker daemon availability is not media authority.
            if pidfd_dead(args.pidfd):
                event('watchdog_pinned_namespace_exited', container_id=args.container_id[:12])
                return 0
            # A fresh post-resume heartbeat must not hide suspended/stalled monitoring.
            now = boottime_ms()
            validate_monitor_gap(last_boottime, now)
            last_boottime = now
            if tick - last_inspect >= 0.5:
                try:
                    info = inspect_container(args.docker_context, args.container_id)
                except WatchdogError as error:
                    if str(error) != 'DOCKER_OPERATION_UNAVAILABLE':
                        raise
                    if docker_unavailable_since is None:
                        docker_unavailable_since = tick
                        event('watchdog_docker_inspection_degraded')
                else:
                    current = validate_target(info, args.container_id, args.instance_id, args.heartbeat)
                    if current is None:
                        event('watchdog_target_stopped')
                        return 0
                    if current != fence:
                        return enforce(args, 'CONTAINER_START_FENCE_CHANGED')
                    if docker_unavailable_since is not None:
                        event('watchdog_docker_inspection_recovered',
                              degraded_ms=max(0, int((tick - docker_unavailable_since) * 1000)))
                    docker_unavailable_since = None
                last_inspect = tick
            now = boottime_ms()
            try:
                heartbeat = read_heartbeat(args.heartbeat, args.heartbeat_uid)
            except FileNotFoundError:
                # Initial grace is at most the running stale threshold. The supervisor
                # writes its initial state before spawning children, so no media can
                # start legitimately without a successful first heartbeat write.
                if not ready and now - began <= 1500:
                    time.sleep(0.1)
                    continue
                return enforce(args, 'SUPERVISOR_HEARTBEAT_MISSING')
            # The supervisor can replace the heartbeat while this read is
            # delayed by host I/O. Compare it with a clock sample taken after
            # the read, while still rejecting a stalled host monitor.
            now = boottime_ms()
            validate_monitor_gap(last_boottime, now)
            last_boottime = now
            heartbeat = validate_heartbeat(heartbeat, args.instance_id, fence['start_ticks'], boot_id, now, previous)
            if now - heartbeat['boottime_ms'] > 1500:
                return enforce(args, 'SUPERVISOR_HEARTBEAT_STALE')
            previous = heartbeat
            if lease:
                lease.pulse(heartbeat)
            if not ready:
                ready = True
                event('watchdog_ready', container_id=args.container_id[:12], instance_id=args.instance_id,
                      stale_ms=1500, poll_ms=100, enforcement_budget_ms=1000)
        except WatchdogError as error:
            if str(error).startswith(('TARGET_', 'HOST_PID_')) or str(error) == 'AUTOMATIC_RESTART_NOT_ALLOWED':
                event('watchdog_identity_fence_lost', code=str(error))
                return 2  # Never kill when ownership/label identity can no longer be proved.
            return enforce(args, str(error))
        except OSError:
            return enforce(args, 'SUPERVISOR_HEARTBEAT_INVALID_PATH')
        time.sleep(max(0.0, 0.1 - (time.monotonic() - tick)))


def main():
    parser = argparse.ArgumentParser(description='Watch one explicitly fenced DARSHAN media node')
    parser.add_argument('--container-id', required=True)
    parser.add_argument('--instance-id', required=True)
    parser.add_argument('--heartbeat', required=True)
    parser.add_argument('--heartbeat-uid', type=int, default=os.getuid())
    parser.add_argument('--docker-context', default='default')
    parser.add_argument('--host-lease-file')
    parser.add_argument('--witness-ready-file')
    args = parser.parse_args()
    if (not re.fullmatch(r'[0-9a-f]{64}', args.container_id) or not UUID.fullmatch(args.instance_id)
            or args.heartbeat_uid < 0 or not re.fullmatch(r'[A-Za-z0-9_.-]+', args.docker_context)
            or not os.path.isabs(args.heartbeat) or os.path.abspath(args.heartbeat) != args.heartbeat
            or bool(args.host_lease_file) != bool(args.witness_ready_file)):
        event('watchdog_configuration_rejected')
        return 2
    return monitor(args)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        event('watchdog_interrupted')
        sys.exit(2)
    except Exception:
        # Never reveal private Docker environment, filesystem contents, or command output.
        event('watchdog_failed')
        sys.exit(3)
