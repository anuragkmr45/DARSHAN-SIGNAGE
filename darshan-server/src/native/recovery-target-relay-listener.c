#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <linux/capability.h>
#include <linux/fs.h>
#include <linux/openat2.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/random.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef TARGET_RELAY_SOCKET_PATH
#define TARGET_RELAY_SOCKET_PATH "/run/darshan-recovery/target-relay.sock"
#endif
#ifndef TARGET_RELAY_AUTHORITY_DIRECTORY
#define TARGET_RELAY_AUTHORITY_DIRECTORY "/var/lib/darshan/recovery-target-relay-authority"
#endif
#ifndef TARGET_RELAY_CONFIG_FILE
#define TARGET_RELAY_CONFIG_FILE "/etc/darshan/recovery-target-relay/relay.json"
#endif
#ifndef TARGET_RELAY_NODE_PATH
#define TARGET_RELAY_NODE_PATH "/usr/local/lib/darshan-recovery-target/node"
#endif
#ifndef TARGET_RELAY_WORKER_PATH
#define TARGET_RELAY_WORKER_PATH "/usr/local/lib/darshan-recovery-target/recovery-target-relay-worker.js"
#endif
#ifndef TARGET_RELAY_SITE_ID
#define TARGET_RELAY_SITE_ID "site-unconfigured"
#endif
#ifndef TARGET_RELAY_BACKEND_INSTALLATION_ID
#define TARGET_RELAY_BACKEND_INSTALLATION_ID "00000000-0000-4000-8000-000000000000"
#endif
#ifndef TARGET_RELAY_POLICY_SHA256
#define TARGET_RELAY_POLICY_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_RELAY_LISTENER_SHA256
#define TARGET_RELAY_LISTENER_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_RELAY_WORKER_SHA256
#define TARGET_RELAY_WORKER_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_RELAY_CONFIG_SHA256
#define TARGET_RELAY_CONFIG_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_RELAY_KNOWN_HOSTS_SHA256
#define TARGET_RELAY_KNOWN_HOSTS_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_RELAY_KEY_PUBLIC_FINGERPRINT
#define TARGET_RELAY_KEY_PUBLIC_FINGERPRINT "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
#endif
#ifndef TARGET_RELAY_DESTINATION_IDENTITY
#define TARGET_RELAY_DESTINATION_IDENTITY "unconfigured"
#endif
#ifndef TARGET_RELAY_SUPERVISOR_UID
#define TARGET_RELAY_SUPERVISOR_UID 0
#endif
#ifndef TARGET_RELAY_RUNNER_UID
#define TARGET_RELAY_RUNNER_UID 1000
#endif
#ifndef TARGET_RELAY_RUNNER_GID
#define TARGET_RELAY_RUNNER_GID 1000
#endif
#ifndef TARGET_RELAY_UID
#define TARGET_RELAY_UID 993
#endif
#ifndef TARGET_RELAY_GID
#define TARGET_RELAY_GID 993
#endif

#define AUTHORITY_FILE "instance-authority"
#define MAX_CHILDREN 4
#ifndef DRAIN_MILLISECONDS
#define DRAIN_MILLISECONDS 5000
#endif
#ifndef TERM_MILLISECONDS
#define TERM_MILLISECONDS 2000
#endif

struct owned_socket { int fd; int parent_fd; char name[108]; dev_t dev; ino_t ino; };
struct child { pid_t pid; pid_t pgid; int direct_reaped; };
static sigset_t termination_signals;

static long long monotonic_milliseconds(void) {
  struct timespec now; if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) return -1;
  return (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int canonical_absolute(const char *path) {
  if (!path || path[0] != '/' || !path[1]) return 0;
  const char *segment = path + 1;
  for (const char *cursor = segment; ; cursor++) if (*cursor == '/' || *cursor == '\0') {
    size_t length = (size_t)(cursor - segment);
    if (!length || (length == 1 && segment[0] == '.') || (length == 2 && segment[0] == '.' && segment[1] == '.')) return 0;
    if (!*cursor) return 1;
    segment = cursor + 1;
  }
}

static int open_directory(const char *path) {
  struct open_how how = { .flags = O_RDONLY | O_DIRECTORY | O_CLOEXEC,
    .resolve = RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS };
  if (!canonical_absolute(path)) { errno = EINVAL; return -1; }
  return (int)syscall(SYS_openat2, AT_FDCWD, path, &how, sizeof(how));
}

static int verify_directory(int fd, uid_t uid, gid_t gid, mode_t mode, const struct stat *identity) {
  struct stat state;
  if (fstat(fd, &state) < 0 || !S_ISDIR(state.st_mode) || state.st_uid != uid || state.st_gid != gid ||
      (state.st_mode & 0777) != mode || (identity && (state.st_dev != identity->st_dev || state.st_ino != identity->st_ino))) {
    errno = EPERM; return -1;
  }
  return 0;
}

static int split_path(const char *path, char *parent, size_t parent_size, char *name, size_t name_size) {
  const char *slash = strrchr(path, '/');
  if (!canonical_absolute(path) || !slash || slash == path || !slash[1]) { errno = EINVAL; return -1; }
  size_t parent_length = (size_t)(slash - path), name_length = strlen(slash + 1);
  if (parent_length >= parent_size || name_length >= name_size || strlen(path) >= sizeof(((struct sockaddr_un *)0)->sun_path)) {
    errno = ENAMETOOLONG; return -1;
  }
  memcpy(parent, path, parent_length); parent[parent_length] = '\0'; memcpy(name, slash + 1, name_length + 1); return 0;
}

static int random_token(char token[65]) {
  unsigned char bytes[32]; ssize_t count; static const char hex[] = "0123456789abcdef";
  do { count = getrandom(bytes, sizeof(bytes), 0); } while (count < 0 && errno == EINTR);
  if (count != (ssize_t)sizeof(bytes)) return -1;
  for (size_t index = 0; index < sizeof(bytes); index++) { token[index * 2] = hex[bytes[index] >> 4]; token[index * 2 + 1] = hex[bytes[index] & 15]; }
  token[64] = '\0'; return 0;
}

static int lower_hex_string(const char *value, size_t length) {
  for (size_t index = 0; index < length; index++) if (!((value[index] >= '0' && value[index] <= '9') ||
      (value[index] >= 'a' && value[index] <= 'f'))) return 0;
  return 1;
}

static int valid_previous_record(const char *record, ssize_t length) {
  if (!length) return 1;
  if (memchr(record, '\0', (size_t)length)) return 0;
  const char *token_prefix = "instance_authority_token=";
  size_t token_prefix_length = strlen(token_prefix);
  if (length < (ssize_t)(token_prefix_length + 65) || memcmp(record, token_prefix, token_prefix_length) != 0 ||
      !lower_hex_string(record + token_prefix_length, 64) || record[token_prefix_length + 64] != '\n') return 0;
  char fixed[2048]; int fixed_length = snprintf(fixed, sizeof(fixed),
    "format=darshan-recovery-target-relay-authority-v1\nsite_id=%s\nbackend_installation_id=%s\npolicy_sha256=%s\nlistener_sha256=%s\nworker_sha256=%s\nconfig_sha256=%s\nknown_hosts_sha256=%s\nkey_public_fingerprint=%s\ndestination_identity=%s\n",
    TARGET_RELAY_SITE_ID, TARGET_RELAY_BACKEND_INSTALLATION_ID, TARGET_RELAY_POLICY_SHA256, TARGET_RELAY_LISTENER_SHA256,
    TARGET_RELAY_WORKER_SHA256, TARGET_RELAY_CONFIG_SHA256, TARGET_RELAY_KNOWN_HOSTS_SHA256,
    TARGET_RELAY_KEY_PUBLIC_FINGERPRINT, TARGET_RELAY_DESTINATION_IDENTITY);
  if (fixed_length <= 0 || (size_t)fixed_length >= sizeof(fixed)) return 0;
  const char *cursor = record + token_prefix_length + 65, *end = record + length;
  if (end - cursor <= fixed_length || memcmp(cursor, fixed, (size_t)fixed_length) != 0) return 0;
  cursor += fixed_length;
  if (end - cursor < 6 || memcmp(cursor, "pid=", 4) != 0) return 0;
  cursor += 4;
  const char *pid_start = cursor;
  while (cursor < end && *cursor >= '0' && *cursor <= '9') cursor++;
  if (cursor == pid_start || cursor == end || *cursor++ != '\n' || end - cursor < 17 || memcmp(cursor, "start_identity=", 15) != 0) return 0;
  cursor += 15; const char *start = cursor; while (cursor < end && *cursor >= '0' && *cursor <= '9') cursor++;
  return cursor > start && cursor + 1 == end && *cursor == '\n';
}

static int process_start_identity(char output[32]) {
  int fd = open("/proc/self/stat", O_RDONLY | O_CLOEXEC); if (fd < 0) return -1;
  char bytes[1024]; ssize_t length = read(fd, bytes, sizeof(bytes) - 1); close(fd); if (length <= 0) return -1; bytes[length] = '\0';
  char *cursor = strrchr(bytes, ')'); if (!cursor || cursor[1] != ' ') { errno = EINVAL; return -1; } cursor += 2;
  for (unsigned field = 3; field < 22; field++) { cursor = strchr(cursor, ' '); if (!cursor) { errno = EINVAL; return -1; } while (*cursor == ' ') cursor++; }
  char *end = strchr(cursor, ' '); if (!end) end = bytes + length; size_t value_length = (size_t)(end - cursor);
  if (!value_length || value_length >= 32) { errno = EINVAL; return -1; }
  for (size_t index = 0; index < value_length; index++) if (cursor[index] < '0' || cursor[index] > '9') { errno = EINVAL; return -1; }
  memcpy(output, cursor, value_length); output[value_length] = '\0'; return 0;
}

static int acquire_authority(char token[65]) {
  int directory_fd = open_directory(TARGET_RELAY_AUTHORITY_DIRECTORY); if (directory_fd < 0) return -1;
  struct stat directory_identity;
  if (fstat(directory_fd, &directory_identity) < 0 || verify_directory(directory_fd, TARGET_RELAY_SUPERVISOR_UID,
      TARGET_RELAY_RUNNER_GID, 0700, NULL) < 0) { close(directory_fd); return -1; }
  int created = 0; int fd = openat(directory_fd, AUTHORITY_FILE, O_RDWR | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0 && errno == ENOENT) { fd = openat(directory_fd, AUTHORITY_FILE, O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600); if (fd >= 0) created = 1; }
  struct stat state;
  if (fd < 0 || (created && fchown(fd, TARGET_RELAY_SUPERVISOR_UID, TARGET_RELAY_RUNNER_GID) < 0) || fstat(fd, &state) < 0 ||
      !S_ISREG(state.st_mode) || state.st_nlink != 1 || state.st_uid != TARGET_RELAY_SUPERVISOR_UID ||
      state.st_gid != TARGET_RELAY_RUNNER_GID || (state.st_mode & 0777) != 0600 || state.st_dev != directory_identity.st_dev || state.st_size > 2048) {
    if (fd >= 0) close(fd);
    close(directory_fd); errno = EPERM; return -1;
  }
  struct flock lock = { .l_type = F_WRLCK, .l_whence = SEEK_SET, .l_start = 0, .l_len = 0 };
  if (fcntl(fd, F_OFD_SETLK, &lock) < 0) { close(fd); close(directory_fd); return -1; }
  char previous[2048]; ssize_t length = pread(fd, previous, sizeof(previous), 0);
  if (length < 0 || !valid_previous_record(previous, length) || random_token(token) < 0) { close(fd); close(directory_fd); errno = EPERM; return -1; }
  char start_identity[32]; if (process_start_identity(start_identity) < 0) { close(fd); close(directory_fd); return -1; }
  char record[2048]; length = snprintf(record, sizeof(record),
    "instance_authority_token=%s\nformat=darshan-recovery-target-relay-authority-v1\nsite_id=%s\nbackend_installation_id=%s\npolicy_sha256=%s\nlistener_sha256=%s\nworker_sha256=%s\nconfig_sha256=%s\nknown_hosts_sha256=%s\nkey_public_fingerprint=%s\ndestination_identity=%s\npid=%ld\nstart_identity=%s\n",
    token, TARGET_RELAY_SITE_ID, TARGET_RELAY_BACKEND_INSTALLATION_ID, TARGET_RELAY_POLICY_SHA256, TARGET_RELAY_LISTENER_SHA256,
    TARGET_RELAY_WORKER_SHA256, TARGET_RELAY_CONFIG_SHA256, TARGET_RELAY_KNOWN_HOSTS_SHA256,
    TARGET_RELAY_KEY_PUBLIC_FINGERPRINT, TARGET_RELAY_DESTINATION_IDENTITY, (long)getpid(), start_identity);
  if (length <= 0 || (size_t)length >= sizeof(record) || ftruncate(fd, 0) < 0 || pwrite(fd, record, (size_t)length, 0) != length ||
      fsync(fd) < 0 || fsync(directory_fd) < 0 || verify_directory(directory_fd, TARGET_RELAY_SUPERVISOR_UID,
        TARGET_RELAY_RUNNER_GID, 0700, &directory_identity) < 0) { close(fd); close(directory_fd); return -1; }
  close(directory_fd); return fd;
}

static int bind_socket(struct owned_socket *owned) {
  char parent[PATH_MAX]; if (split_path(TARGET_RELAY_SOCKET_PATH, parent, sizeof(parent), owned->name, sizeof(owned->name)) < 0) return -1;
  owned->parent_fd = open_directory(parent); if (owned->parent_fd < 0) return -1;
  struct stat parent_identity, existing;
  if (fstat(owned->parent_fd, &parent_identity) < 0 || verify_directory(owned->parent_fd, TARGET_RELAY_SUPERVISOR_UID,
      TARGET_RELAY_RUNNER_GID, 0710, NULL) < 0 || fstatat(owned->parent_fd, owned->name, &existing, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT) {
    errno = EEXIST; return -1;
  }
  owned->fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0); if (owned->fd < 0) return -1;
  struct sockaddr_un address = { .sun_family = AF_UNIX }; memcpy(address.sun_path, TARGET_RELAY_SOCKET_PATH, strlen(TARGET_RELAY_SOCKET_PATH) + 1);
  if (bind(owned->fd, (struct sockaddr *)&address, offsetof(struct sockaddr_un, sun_path) + strlen(TARGET_RELAY_SOCKET_PATH) + 1) < 0) return -1;
  struct stat created;
  if (fstatat(owned->parent_fd, owned->name, &created, AT_SYMLINK_NOFOLLOW) < 0 || !S_ISSOCK(created.st_mode) ||
      fchmodat(owned->parent_fd, owned->name, 0660, 0) < 0 || fchownat(owned->parent_fd, owned->name,
        TARGET_RELAY_SUPERVISOR_UID, TARGET_RELAY_RUNNER_GID, AT_SYMLINK_NOFOLLOW) < 0 || listen(owned->fd, MAX_CHILDREN) < 0 ||
      verify_directory(owned->parent_fd, TARGET_RELAY_SUPERVISOR_UID, TARGET_RELAY_RUNNER_GID, 0710, &parent_identity) < 0) return -1;
  struct stat final;
  if (fstatat(owned->parent_fd, owned->name, &final, AT_SYMLINK_NOFOLLOW) < 0 || !S_ISSOCK(final.st_mode) ||
      final.st_dev != created.st_dev || final.st_ino != created.st_ino || final.st_uid != TARGET_RELAY_SUPERVISOR_UID ||
      final.st_gid != TARGET_RELAY_RUNNER_GID || (final.st_mode & 0777) != 0660) { errno = EPERM; return -1; }
  owned->dev = final.st_dev; owned->ino = final.st_ino; return 0;
}

static int preserve_socket(struct owned_socket *owned, const char *token) {
  if (owned->fd >= 0) { close(owned->fd); owned->fd = -1; } if (owned->parent_fd < 0) return 0;
  struct stat state;
  if (fstatat(owned->parent_fd, owned->name, &state, AT_SYMLINK_NOFOLLOW) < 0 || !S_ISSOCK(state.st_mode) ||
      state.st_dev != owned->dev || state.st_ino != owned->ino) { close(owned->parent_fd); owned->parent_fd = -1; errno = ESTALE; return -1; }
  for (unsigned attempt = 0; attempt < 32; attempt++) {
    char destination[NAME_MAX + 1]; int length = snprintf(destination, sizeof(destination), "%s.closed.%s.%u", owned->name, token, attempt);
    if (length <= 0 || (size_t)length >= sizeof(destination)) break;
    if (syscall(SYS_renameat2, owned->parent_fd, owned->name, owned->parent_fd, destination, RENAME_NOREPLACE) == 0) {
      int result = fsync(owned->parent_fd); close(owned->parent_fd); owned->parent_fd = -1; return result;
    }
    if (errno != EEXIST) break;
  }
  close(owned->parent_fd); owned->parent_fd = -1; return -1;
}

static int take_termination(void) {
  const struct timespec immediate = {0, 0}; int result;
  do { result = sigtimedwait(&termination_signals, NULL, &immediate); } while (result < 0 && errno == EINTR); return result;
}

static int group_exists(pid_t pgid) {
  if (kill(-pgid, 0) == 0 || errno == EPERM) return 1;
  if (errno == ESRCH) return 0;
  return -1;
}

static int reap(struct child children[MAX_CHILDREN], unsigned *count) {
  int status;
  for (;;) {
    pid_t result = waitpid(-1, &status, WNOHANG);
    if (result > 0) {
      for (unsigned index = 0; index < *count; index++) if (children[index].pid == result) children[index].direct_reaped = 1;
      continue;
    }
    if (result < 0 && errno != ECHILD && errno != EINTR) return -1;
    if (result < 0 && errno == EINTR) continue;
    break;
  }
  for (unsigned index = 0; index < *count; ) {
    int alive = group_exists(children[index].pgid);
    if (alive < 0) return -1;
    if (children[index].direct_reaped && !alive) { children[index] = children[--*count]; continue; }
    index++;
  }
  return 0;
}

static int signal_groups(struct child children[MAX_CHILDREN], unsigned count, int signal_number) {
  int failed = 0;
  for (unsigned index = 0; index < count; index++)
    if (kill(-children[index].pgid, signal_number) < 0 && errno != ESRCH) failed = 1;
  return failed ? -1 : 0;
}

static void child_exec(int accepted, int listener, int authority, int parent, int gate_read) {
  if (setpgid(0, 0) < 0) _exit(78);
  unsigned char admission; ssize_t count; do { count = read(gate_read, &admission, 1); } while (count < 0 && errno == EINTR);
  close(gate_read); if (count != 1 || admission != 'G') _exit(78);
  if (dup2(accepted, STDIN_FILENO) < 0 || dup2(accepted, STDOUT_FILENO) < 0) _exit(78);
  close(accepted); close(listener); close(authority); close(parent);
#ifndef TARGET_RELAY_SKIP_PRIVILEGE_DROP
  for (int capability = 0; capability <= CAP_LAST_CAP; capability++)
    if (prctl(PR_CAPBSET_DROP, capability, 0, 0, 0) < 0 && errno != EINVAL) _exit(78);
  if (setgroups(0, NULL) < 0 || setgid(TARGET_RELAY_GID) < 0 || setuid(TARGET_RELAY_UID) < 0) _exit(78);
#endif
  struct __user_cap_header_struct header = { .version = _LINUX_CAPABILITY_VERSION_3, .pid = 0 };
  struct __user_cap_data_struct data[2] = {{0}, {0}};
  if (syscall(SYS_capset, &header, data) < 0 || prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) < 0 ||
      prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0 || syscall(SYS_close_range, 3U, ~0U, 0) < 0) _exit(78);
  char config_env[PATH_MAX + 64], uid_env[64], gid_env[64];
  (void)snprintf(config_env, sizeof(config_env), "DARSHAN_TARGET_RELAY_CONFIG_FILE=%s", TARGET_RELAY_CONFIG_FILE);
  (void)snprintf(uid_env, sizeof(uid_env), "DARSHAN_TARGET_RELAY_UID=%u", TARGET_RELAY_UID);
  (void)snprintf(gid_env, sizeof(gid_env), "DARSHAN_TARGET_RELAY_GID=%u", TARGET_RELAY_GID);
  char *const argv[] = { (char *)TARGET_RELAY_NODE_PATH, (char *)TARGET_RELAY_WORKER_PATH, NULL };
  char *const envp[] = { config_env, uid_env, gid_env, "PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", NULL };
  execve(TARGET_RELAY_NODE_PATH, argv, envp); _exit(78);
}

int main(int argc, char **argv) {
  (void)argv;
  if (argc != 1 || getuid() != TARGET_RELAY_SUPERVISOR_UID || sigemptyset(&termination_signals) < 0 ||
      sigaddset(&termination_signals, SIGTERM) < 0 || sigaddset(&termination_signals, SIGINT) < 0 ||
      sigprocmask(SIG_BLOCK, &termination_signals, NULL) < 0 || signal(SIGPIPE, SIG_IGN) == SIG_ERR ||
      prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) < 0) return 64;
  char token[65]; int authority = acquire_authority(token);
  if (authority < 0) { fputs("target-relay-listener: authority unavailable\n", stderr); return 78; }
  int pending = take_termination(); if (pending > 0) { close(authority); return 128 + pending; }
  if (pending < 0 && errno != EAGAIN) { close(authority); return 78; }
  struct owned_socket owned = { .fd = -1, .parent_fd = -1 };
  if (bind_socket(&owned) < 0) { fputs("target-relay-listener: listener unavailable\n", stderr); close(authority); return 78; }
  struct child children[MAX_CHILDREN]; unsigned child_count = 0; int shutdown_signal = 0, failed = 0;
  while (!shutdown_signal && !failed) {
    if (reap(children, &child_count) < 0) { failed = 1; break; }
    for (unsigned turn = 0; turn < 16 && !shutdown_signal && !failed; turn++) {
      pending = take_termination(); if (pending > 0) { shutdown_signal = pending; break; }
      if (pending < 0 && errno != EAGAIN) { failed = 1; break; }
      int accepted = accept4(owned.fd, NULL, NULL, SOCK_CLOEXEC);
      if (accepted < 0) { if (errno == EAGAIN || errno == EWOULDBLOCK) break; if (errno == EINTR) continue; failed = 1; break; }
      struct ucred credential; socklen_t credential_length = sizeof(credential);
      if (getsockopt(accepted, SOL_SOCKET, SO_PEERCRED, &credential, &credential_length) < 0 ||
          credential_length != sizeof(credential) || credential.uid != TARGET_RELAY_RUNNER_UID || child_count >= MAX_CHILDREN) { close(accepted); continue; }
      pending = take_termination(); if (pending > 0) { close(accepted); shutdown_signal = pending; break; }
      int gate[2]; if (pipe2(gate, O_CLOEXEC) < 0) { close(accepted); failed = 1; break; }
      pid_t pid = fork();
      if (pid == 0) { close(gate[1]); (void)sigprocmask(SIG_UNBLOCK, &termination_signals, NULL); child_exec(accepted, owned.fd, authority, owned.parent_fd, gate[0]); }
      close(gate[0]); close(accepted); if (pid < 0) { close(gate[1]); failed = 1; break; }
      if (setpgid(pid, pid) < 0 && !(errno == EACCES && getpgid(pid) == pid)) {
        (void)kill(pid, SIGKILL); (void)waitpid(pid, NULL, 0); close(gate[1]); failed = 1; break;
      }
      children[child_count++] = (struct child){ .pid = pid, .pgid = pid, .direct_reaped = 0 };
      pending = take_termination(); unsigned char admission = pending > 0 ? 'X' : 'G';
      if (write(gate[1], &admission, 1) != 1) failed = 1;
      close(gate[1]);
      if (pending > 0) shutdown_signal = pending;
      else if (pending < 0 && errno != EAGAIN) failed = 1;
    }
    if (!shutdown_signal && !failed) { const struct timespec interval = {0, 100000000}; int signal_number = sigtimedwait(&termination_signals, NULL, &interval);
      if (signal_number > 0) shutdown_signal = signal_number; else if (signal_number < 0 && errno != EAGAIN && errno != EINTR) failed = 1; }
  }
  close(owned.fd); owned.fd = -1; long long deadline = monotonic_milliseconds() + DRAIN_MILLISECONDS;
  while (child_count && monotonic_milliseconds() < deadline) { if (reap(children, &child_count) < 0) { failed = 1; break; }
    const struct timespec pause = {0, 10000000}; (void)nanosleep(&pause, NULL); }
  if (signal_groups(children, child_count, SIGTERM) < 0) failed = 1;
  deadline = monotonic_milliseconds() + TERM_MILLISECONDS;
  while (child_count && monotonic_milliseconds() < deadline) { if (reap(children, &child_count) < 0) { failed = 1; break; }
    const struct timespec pause = {0, 10000000}; (void)nanosleep(&pause, NULL); }
  if (signal_groups(children, child_count, SIGKILL) < 0) failed = 1;
  deadline = monotonic_milliseconds() + TERM_MILLISECONDS;
  while (child_count && monotonic_milliseconds() < deadline) { if (reap(children, &child_count) < 0) { failed = 1; break; }
    const struct timespec pause = {0, 10000000}; (void)nanosleep(&pause, NULL); }
  if (reap(children, &child_count) < 0) failed = 1;
  while (child_count) {
    /* Fail-stop: never release the lifetime authority or preserve the socket
       while a worker process group still exists, even after bounded KILL. */
    if (signal_groups(children, child_count, SIGKILL) < 0 || reap(children, &child_count) < 0) failed = 1;
    if (child_count) { const struct timespec pause = {0, 10000000}; (void)nanosleep(&pause, NULL); }
  }
  if (preserve_socket(&owned, token) < 0) failed = 1;
  close(authority);
  if (failed) return 78;
  return shutdown_signal ? 128 + shutdown_signal : 78;
}
