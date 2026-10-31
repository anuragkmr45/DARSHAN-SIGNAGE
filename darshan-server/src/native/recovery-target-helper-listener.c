#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <linux/fs.h>
#include <linux/capability.h>
#include <linux/openat2.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
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

#ifndef TARGET_HELPER_SOCKET_PATH
#define TARGET_HELPER_SOCKET_PATH "/run/darshan-recovery-target/helper.sock"
#endif
#ifndef TARGET_HELPER_AUTHORITY_DIRECTORY
#define TARGET_HELPER_AUTHORITY_DIRECTORY "/var/lib/darshan/recovery-target-authority"
#endif
#ifndef TARGET_HELPER_JOURNAL_ROOT
#define TARGET_HELPER_JOURNAL_ROOT "/var/lib/darshan/recovery-target-helper"
#endif
#ifndef TARGET_HELPER_KEYRING_FILE
#define TARGET_HELPER_KEYRING_FILE "/etc/darshan/recovery-target-trust/authorization-keys.json"
#endif
#ifndef TARGET_HELPER_IDENTITY_FILE
#define TARGET_HELPER_IDENTITY_FILE "/etc/darshan/recovery-target-helper/installed-identity.json"
#endif
#ifndef TARGET_HELPER_NODE_PATH
#define TARGET_HELPER_NODE_PATH "/usr/local/lib/darshan-recovery-target/node"
#endif
#ifndef TARGET_HELPER_WORKER_PATH
#define TARGET_HELPER_WORKER_PATH "/usr/local/lib/darshan-recovery-target/recovery-target-helper-worker.js"
#endif
#ifndef TARGET_HELPER_SITE_ID
#define TARGET_HELPER_SITE_ID "site-unconfigured"
#endif
#ifndef TARGET_HELPER_INSTALLATION_ID
#define TARGET_HELPER_INSTALLATION_ID "00000000-0000-4000-8000-000000000000"
#endif
#ifndef TARGET_HELPER_POLICY_SHA256
#define TARGET_HELPER_POLICY_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_BINARY_SHA256
#define TARGET_HELPER_BINARY_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_ROLE_SHA256
#define TARGET_HELPER_ROLE_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_ENGINE_PROFILE_SHA256
#define TARGET_HELPER_ENGINE_PROFILE_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_SPECIFICATION_ROOT_SHA256
#define TARGET_HELPER_SPECIFICATION_ROOT_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_EVIDENCE_ROOT_SHA256
#define TARGET_HELPER_EVIDENCE_ROOT_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_ALLOCATION_LEDGER_ROOT_SHA256
#define TARGET_HELPER_ALLOCATION_LEDGER_ROOT_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_ALLOCATION_CONTROL_ROOT_SHA256
#define TARGET_HELPER_ALLOCATION_CONTROL_ROOT_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_ACTIVE_ROOT_SHA256
#define TARGET_HELPER_ACTIVE_ROOT_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_QUARANTINE_ROOT_SHA256
#define TARGET_HELPER_QUARANTINE_ROOT_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_POOL_ROOT_SHA256
#define TARGET_HELPER_POOL_ROOT_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_STORAGE_AUTHORITY_SHA256
#define TARGET_HELPER_STORAGE_AUTHORITY_SHA256 "0000000000000000000000000000000000000000000000000000000000000000"
#endif
#ifndef TARGET_HELPER_HOST_MODE
#define TARGET_HELPER_HOST_MODE "SPLIT_HOST"
#endif
#ifndef TARGET_HELPER_SUPERVISOR_UID
#define TARGET_HELPER_SUPERVISOR_UID 0
#endif
#ifndef TARGET_HELPER_BRIDGE_GID
#define TARGET_HELPER_BRIDGE_GID 995
#endif
#ifndef TARGET_HELPER_BRIDGE_UID
#define TARGET_HELPER_BRIDGE_UID 995
#endif
#ifndef TARGET_HELPER_UID
#define TARGET_HELPER_UID 994
#endif
#ifndef TARGET_HELPER_GID
#define TARGET_HELPER_GID 994
#endif
#define AUTHORITY_FILE "instance-authority"
#define HELPER_LOCK_FILE ".target-helper.lock"
#define MAX_CHILDREN 4
#define MAX_ADOPTED_DESCENDANTS 64
#define DRAIN_MILLISECONDS 5000
#define TERM_MILLISECONDS 2000

struct owned_socket { int fd; int parent_fd; char name[108]; dev_t dev; ino_t ino; };
struct child { pid_t pid; pid_t pgid; int direct_reaped; };
struct adopted { pid_t pid; char start_identity[32]; int reaped; int seen; };
static sigset_t termination_signals;
static int lower_hex(unsigned char value) { return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f'); }
static int take_termination(void) {
  const struct timespec immediate = { .tv_sec = 0, .tv_nsec = 0 }; int signal_number;
  do { signal_number = sigtimedwait(&termination_signals, NULL, &immediate); } while (signal_number < 0 && errno == EINTR);
  return signal_number;
}
#ifdef TARGET_HELPER_LISTENER_TESTING
static void test_pause(const char *point) {
  const char *directory = getenv("TARGET_HELPER_TEST_DIRECTORY");
  const char *selected = getenv("TARGET_HELPER_TEST_PAUSE");
  if (!directory || !selected || strcmp(selected, point) != 0) return;
  char ready[PATH_MAX], proceed[PATH_MAX];
  if (snprintf(ready, sizeof(ready), "%s/%s.ready", directory, point) <= 0 ||
      snprintf(proceed, sizeof(proceed), "%s/%s.continue", directory, point) <= 0) return;
  int marker = open(ready, O_CREAT | O_WRONLY | O_CLOEXEC, 0600); if (marker >= 0) close(marker);
  const struct timespec interval = { .tv_sec = 0, .tv_nsec = 10000000 };
  for (unsigned attempt = 0; attempt < 500 && access(proceed, F_OK) < 0; attempt++) (void)nanosleep(&interval, NULL);
}

static void test_record_adopted(pid_t pid) {
  const char *directory = getenv("TARGET_HELPER_TEST_DIRECTORY");
  if (!directory) return;
  char marker_path[PATH_MAX];
  if (snprintf(marker_path, sizeof(marker_path), "%s/adopted.%ld.ready", directory, (long)pid) <= 0) return;
  int marker = open(marker_path, O_CREAT | O_WRONLY | O_CLOEXEC, 0600); if (marker >= 0) close(marker);
}

static int test_fail_discovery_after_adopted_reap(int reaped_adopted) {
  static int armed = 0;
  const char *directory = getenv("TARGET_HELPER_TEST_DIRECTORY");
  if (!directory || !getenv("TARGET_HELPER_TEST_FAIL_DISCOVERY_AFTER_ADOPTED_REAP")) return 0;
  if (reaped_adopted) {
    char ready[PATH_MAX]; armed = 1;
    if (snprintf(ready, sizeof(ready), "%s/discovery-fault.ready", directory) > 0) {
      int marker = open(ready, O_CREAT | O_WRONLY | O_CLOEXEC, 0600); if (marker >= 0) close(marker);
    }
  }
  if (armed) {
    char proceed[PATH_MAX];
    if (snprintf(proceed, sizeof(proceed), "%s/discovery-fault.continue", directory) <= 0 || access(proceed, F_OK) < 0) {
      errno = EIO; return -1;
    }
    armed = 0;
  }
  return 0;
}
#else
static void test_pause(const char *point) { (void)point; }
static void test_record_adopted(pid_t pid) { (void)pid; }
static int test_fail_discovery_after_adopted_reap(int reaped_adopted) { (void)reaped_adopted; return 0; }
#endif

static int canonical_absolute(const char *path) {
  if (!path || path[0] != '/' || path[1] == '\0') return 0;
  const char *segment = path + 1;
  for (const char *cursor = segment; ; cursor++) {
    if (*cursor == '/' || *cursor == '\0') {
      size_t length = (size_t)(cursor - segment);
      if (length == 0 || (length == 1 && segment[0] == '.') ||
          (length == 2 && segment[0] == '.' && segment[1] == '.')) return 0;
      if (*cursor == '\0') return 1;
      segment = cursor + 1;
    }
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
  memcpy(parent, path, parent_length); parent[parent_length] = '\0';
  memcpy(name, slash + 1, name_length + 1); return 0;
}

static int random_token(char token[65]) {
  unsigned char bytes[32]; ssize_t count;
  do { count = getrandom(bytes, sizeof(bytes), 0); } while (count < 0 && errno == EINTR);
  if (count != (ssize_t)sizeof(bytes)) return -1;
  static const char hex[] = "0123456789abcdef";
  for (size_t index = 0; index < sizeof(bytes); index++) {
    token[index * 2] = hex[bytes[index] >> 4]; token[index * 2 + 1] = hex[bytes[index] & 15];
  }
  token[64] = '\0'; return 0;
}

static int read_bounded(int fd, char *bytes, size_t capacity, ssize_t *length) {
  if (lseek(fd, 0, SEEK_SET) < 0) return -1;
  ssize_t total = 0;
  while ((size_t)total < capacity) {
    ssize_t count = read(fd, bytes + total, capacity - (size_t)total);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) return -1;
    if (count == 0) { *length = total; return 0; }
    total += count;
  }
  char extra; ssize_t count = read(fd, &extra, 1);
  if (count != 0) { errno = EFBIG; return -1; }
  *length = total; return 0;
}

static int previous_authority_token(const char *record, ssize_t length, char token[65]) {
  if (length == 0) return 0;
  const char *needle = "instance_authority_token="; size_t needle_length = strlen(needle);
  if (length < (ssize_t)(needle_length + 64 + 1) || memcmp(record, needle, needle_length) != 0 ||
      record[needle_length + 64] != '\n') return -1;
  memcpy(token, record + needle_length, 64); token[64] = '\0';
  for (size_t index = 0; index < 64; index++) if (!lower_hex((unsigned char)token[index])) return -1;
  const char *cursor = record + needle_length + 65, *end = record + length;
  char fixed[2048];
  int fixed_length = snprintf(fixed, sizeof(fixed),
    "format=darshan-recovery-target-instance-authority-v2\nsite_id=%s\ninstallation_id=%s\npolicy_sha256=%s\nhelper_role_sha256=%s\nengine_profile_sha256=%s\nspecification_root_sha256=%s\nevidence_root_sha256=%s\nallocation_ledger_root_sha256=%s\nallocation_control_root_sha256=%s\nactive_root_sha256=%s\nquarantine_root_sha256=%s\npool_root_sha256=%s\nstorage_authority_sha256=%s\nhost_mode=%s\nlistener_sha256=%s\nboot_id=",
    TARGET_HELPER_SITE_ID, TARGET_HELPER_INSTALLATION_ID, TARGET_HELPER_POLICY_SHA256,
    TARGET_HELPER_ROLE_SHA256, TARGET_HELPER_ENGINE_PROFILE_SHA256, TARGET_HELPER_SPECIFICATION_ROOT_SHA256,
    TARGET_HELPER_EVIDENCE_ROOT_SHA256, TARGET_HELPER_ALLOCATION_LEDGER_ROOT_SHA256,
    TARGET_HELPER_ALLOCATION_CONTROL_ROOT_SHA256, TARGET_HELPER_ACTIVE_ROOT_SHA256,
    TARGET_HELPER_QUARANTINE_ROOT_SHA256, TARGET_HELPER_POOL_ROOT_SHA256,
    TARGET_HELPER_STORAGE_AUTHORITY_SHA256, TARGET_HELPER_HOST_MODE,
    TARGET_HELPER_BINARY_SHA256);
  if (fixed_length <= 0 || (size_t)fixed_length >= sizeof(fixed) || end - cursor < fixed_length ||
      memcmp(cursor, fixed, (size_t)fixed_length) != 0) return -1;
  cursor += fixed_length; const char *newline = memchr(cursor, '\n', (size_t)(end - cursor));
  if (!newline || newline == cursor || newline - cursor > 64) return -1;
  for (const char *value = cursor; value < newline; value++)
    if (!((*value >= '0' && *value <= '9') || (*value >= 'a' && *value <= 'z') || *value == '-')) return -1;
  cursor = newline + 1;
  if (end - cursor < 5 || memcmp(cursor, "pid=", 4) != 0) return -1;
  cursor += 4;
  newline = memchr(cursor, '\n', (size_t)(end - cursor)); if (!newline || newline == cursor) return -1;
  for (const char *value = cursor; value < newline; value++) if (*value < '0' || *value > '9') return -1;
  cursor = newline + 1;
  const char start_prefix[] = "start_identity=";
  if (end - cursor < (ptrdiff_t)sizeof(start_prefix) || memcmp(cursor, start_prefix, sizeof(start_prefix) - 1) != 0) return -1;
  cursor += sizeof(start_prefix) - 1; newline = memchr(cursor, '\n', (size_t)(end - cursor));
  if (!newline || newline == cursor || newline + 1 != end) return -1;
  for (const char *value = cursor; value < newline; value++) if (*value < '0' || *value > '9') return -1;
  return 1;
}

static int process_start_identity(char output[32]) {
  int fd = open("/proc/self/stat", O_RDONLY | O_CLOEXEC); if (fd < 0) return -1;
  char bytes[1024]; ssize_t length = read(fd, bytes, sizeof(bytes) - 1); close(fd);
  if (length <= 0) return -1;
  bytes[length] = '\0';
  char *cursor = strrchr(bytes, ')'); if (!cursor || cursor[1] != ' ') { errno = EINVAL; return -1; }
  cursor += 2;
  for (unsigned field = 3; field < 22; field++) {
    cursor = strchr(cursor, ' '); if (!cursor) { errno = EINVAL; return -1; }
    while (*cursor == ' ') cursor++;
  }
  char *end = strchr(cursor, ' '); if (!end) end = bytes + length;
  size_t value_length = (size_t)(end - cursor);
  if (value_length < 1 || value_length >= 32) { errno = EINVAL; return -1; }
  for (size_t index = 0; index < value_length; index++) if (cursor[index] < '0' || cursor[index] > '9') { errno = EINVAL; return -1; }
  memcpy(output, cursor, value_length); output[value_length] = '\0'; return 0;
}

static int helper_lock_matches(const char *bytes, ssize_t length, const char *token, pid_t *owner_pid) {
  char expected_prefix[160];
  int prefix = snprintf(expected_prefix, sizeof(expected_prefix), "{\"instanceAuthorityToken\":\"%s\",\"instanceId\":\"", token);
  if (prefix <= 0 || length < prefix + 36 + 8 || memcmp(bytes, expected_prefix, (size_t)prefix) != 0) return 0;
  const char *uuid = bytes + prefix;
  for (int index = 0; index < 36; index++) {
    if (index == 8 || index == 13 || index == 18 || index == 23) { if (uuid[index] != '-') return 0; }
    else if (!lower_hex((unsigned char)uuid[index])) return 0;
  }
  const char *pid = uuid + 36;
  if (memcmp(pid, "\",\"pid\":", 8) != 0) return 0;
  pid += 8;
  if (pid >= bytes + length || *pid < '1' || *pid > '9') return 0;
  char pid_text[32]; size_t pid_length = 0;
  while (pid < bytes + length && *pid >= '0' && *pid <= '9') {
    if (pid_length + 1 >= sizeof(pid_text)) return 0;
    pid_text[pid_length++] = *pid++;
  }
  pid_text[pid_length] = '\0'; char *end = NULL; errno = 0; long parsed = strtol(pid_text, &end, 10);
  if (errno || !end || *end || parsed <= 0 || parsed > INT_MAX || pid + 1 != bytes + length || pid[0] != '}') return 0;
  *owner_pid = (pid_t)parsed; return 1;
}

static int reconcile_stale_lock(const char *old_token) {
  int directory_fd = open_directory(TARGET_HELPER_JOURNAL_ROOT); if (directory_fd < 0) return -1;
  struct stat directory_identity;
  if (fstat(directory_fd, &directory_identity) < 0 ||
      verify_directory(directory_fd, TARGET_HELPER_UID, TARGET_HELPER_GID, 0700, NULL) < 0) { close(directory_fd); return -1; }
  int lock_fd = openat(directory_fd, HELPER_LOCK_FILE, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
  if (lock_fd < 0) { int saved = errno; close(directory_fd); if (saved == ENOENT) return 0; errno = saved; return -1; }
  struct stat lock_state; char bytes[512]; ssize_t length = 0;
  pid_t owner_pid = 0;
  if (!old_token || fstat(lock_fd, &lock_state) < 0 || !S_ISREG(lock_state.st_mode) || lock_state.st_nlink != 1 ||
      lock_state.st_uid != TARGET_HELPER_UID || lock_state.st_gid != TARGET_HELPER_GID ||
      (lock_state.st_mode & 0777) != 0600 || lock_state.st_dev != directory_identity.st_dev ||
      read_bounded(lock_fd, bytes, sizeof(bytes), &length) < 0 || !helper_lock_matches(bytes, length, old_token, &owner_pid)) {
    close(lock_fd); close(directory_fd); errno = EPERM; return -1;
  }
  close(lock_fd);
  if (kill(owner_pid, 0) == 0 || errno == EPERM) { close(directory_fd); errno = EBUSY; return -1; }
  if (errno != ESRCH) { close(directory_fd); return -1; }
  char destination[NAME_MAX + 1];
  int written = snprintf(destination, sizeof(destination), "%s.stale.%s", HELPER_LOCK_FILE, old_token);
  if (written <= 0 || (size_t)written >= sizeof(destination) ||
      syscall(SYS_renameat2, directory_fd, HELPER_LOCK_FILE, directory_fd, destination, RENAME_NOREPLACE) < 0 ||
      fsync(directory_fd) < 0 || verify_directory(directory_fd, TARGET_HELPER_UID, TARGET_HELPER_GID, 0700, &directory_identity) < 0) {
    close(directory_fd); return -1;
  }
  close(directory_fd); return 0;
}

static int acquire_authority(char token[65]) {
  int directory_fd = open_directory(TARGET_HELPER_AUTHORITY_DIRECTORY); if (directory_fd < 0) return -1;
  struct stat directory_identity;
  if (fstat(directory_fd, &directory_identity) < 0 ||
      verify_directory(directory_fd, TARGET_HELPER_SUPERVISOR_UID, TARGET_HELPER_BRIDGE_GID, 0700, NULL) < 0) {
    close(directory_fd); return -1;
  }
  int created = 0;
  int fd = openat(directory_fd, AUTHORITY_FILE, O_RDWR | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0 && errno == ENOENT) {
    fd = openat(directory_fd, AUTHORITY_FILE, O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd >= 0) created = 1;
  }
  struct stat state;
  if (fd < 0 || (created && (fchmod(fd, 0600) < 0 ||
      fchown(fd, TARGET_HELPER_SUPERVISOR_UID, TARGET_HELPER_BRIDGE_GID) < 0)) ||
      fstat(fd, &state) < 0 || !S_ISREG(state.st_mode) || state.st_nlink != 1 ||
      state.st_uid != TARGET_HELPER_SUPERVISOR_UID || state.st_gid != TARGET_HELPER_BRIDGE_GID ||
      (state.st_mode & 0777) != 0600 || state.st_dev != directory_identity.st_dev || state.st_size > 2048) {
    if (fd >= 0) close(fd);
    close(directory_fd); errno = EPERM; return -1;
  }
  struct flock lock = { .l_type = F_WRLCK, .l_whence = SEEK_SET, .l_start = 0, .l_len = 0 };
  if (fcntl(fd, F_OFD_SETLK, &lock) < 0) { close(fd); close(directory_fd); return -1; }
  char old_record[2048] = {0}, old_token[65] = {0}; ssize_t old_length = 0;
  if (read_bounded(fd, old_record, sizeof(old_record) - 1, &old_length) < 0) { close(fd); close(directory_fd); return -1; }
  int old_token_result = previous_authority_token(old_record, old_length, old_token);
  if (old_token_result < 0 || reconcile_stale_lock(old_token_result == 1 ? old_token : NULL) < 0 || random_token(token) < 0) {
    close(fd); close(directory_fd); return -1;
  }
  char boot[80] = "unavailable"; int boot_fd = open("/proc/sys/kernel/random/boot_id", O_RDONLY | O_CLOEXEC);
  if (boot_fd >= 0) { ssize_t count = read(boot_fd, boot, sizeof(boot) - 1); close(boot_fd); if (count > 0) { boot[count] = '\0'; boot[strcspn(boot, "\r\n")] = '\0'; } }
  char start_identity[32]; if (process_start_identity(start_identity) < 0) { close(fd); close(directory_fd); return -1; }
  char record[2048];
  int length = snprintf(record, sizeof(record),
    "instance_authority_token=%s\nformat=darshan-recovery-target-instance-authority-v2\nsite_id=%s\ninstallation_id=%s\npolicy_sha256=%s\nhelper_role_sha256=%s\nengine_profile_sha256=%s\nspecification_root_sha256=%s\nevidence_root_sha256=%s\nallocation_ledger_root_sha256=%s\nallocation_control_root_sha256=%s\nactive_root_sha256=%s\nquarantine_root_sha256=%s\npool_root_sha256=%s\nstorage_authority_sha256=%s\nhost_mode=%s\nlistener_sha256=%s\nboot_id=%s\npid=%ld\nstart_identity=%s\n",
    token, TARGET_HELPER_SITE_ID, TARGET_HELPER_INSTALLATION_ID, TARGET_HELPER_POLICY_SHA256,
    TARGET_HELPER_ROLE_SHA256, TARGET_HELPER_ENGINE_PROFILE_SHA256, TARGET_HELPER_SPECIFICATION_ROOT_SHA256,
    TARGET_HELPER_EVIDENCE_ROOT_SHA256, TARGET_HELPER_ALLOCATION_LEDGER_ROOT_SHA256,
    TARGET_HELPER_ALLOCATION_CONTROL_ROOT_SHA256, TARGET_HELPER_ACTIVE_ROOT_SHA256,
    TARGET_HELPER_QUARANTINE_ROOT_SHA256, TARGET_HELPER_POOL_ROOT_SHA256,
    TARGET_HELPER_STORAGE_AUTHORITY_SHA256, TARGET_HELPER_HOST_MODE,
    TARGET_HELPER_BINARY_SHA256,
    boot, (long)getpid(), start_identity);
  if (length <= 0 || (size_t)length >= sizeof(record) || ftruncate(fd, 0) < 0 || lseek(fd, 0, SEEK_SET) < 0 ||
      write(fd, record, (size_t)length) != length || fsync(fd) < 0 || fsync(directory_fd) < 0 ||
      verify_directory(directory_fd, TARGET_HELPER_SUPERVISOR_UID, TARGET_HELPER_BRIDGE_GID, 0700, &directory_identity) < 0) {
    close(fd); close(directory_fd); return -1;
  }
  close(directory_fd); return fd;
}

static int bind_socket(struct owned_socket *owned) {
  char parent[PATH_MAX];
  if (split_path(TARGET_HELPER_SOCKET_PATH, parent, sizeof(parent), owned->name, sizeof(owned->name)) < 0) return -1;
  owned->parent_fd = open_directory(parent); if (owned->parent_fd < 0) return -1;
  struct stat parent_identity, existing;
  if (fstat(owned->parent_fd, &parent_identity) < 0 ||
      verify_directory(owned->parent_fd, TARGET_HELPER_SUPERVISOR_UID, TARGET_HELPER_BRIDGE_GID, 0710, NULL) < 0 ||
      fstatat(owned->parent_fd, owned->name, &existing, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT) { errno = EEXIST; return -1; }
  owned->fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0); if (owned->fd < 0) return -1;
  struct sockaddr_un address = { .sun_family = AF_UNIX };
  memcpy(address.sun_path, TARGET_HELPER_SOCKET_PATH, strlen(TARGET_HELPER_SOCKET_PATH) + 1);
  if (bind(owned->fd, (struct sockaddr *)&address,
      offsetof(struct sockaddr_un, sun_path) + strlen(TARGET_HELPER_SOCKET_PATH) + 1) < 0) return -1;
  struct stat created;
  if (fstatat(owned->parent_fd, owned->name, &created, AT_SYMLINK_NOFOLLOW) < 0 || !S_ISSOCK(created.st_mode) ||
      fchmodat(owned->parent_fd, owned->name, 0660, 0) < 0 ||
      fchownat(owned->parent_fd, owned->name, TARGET_HELPER_SUPERVISOR_UID, TARGET_HELPER_BRIDGE_GID, AT_SYMLINK_NOFOLLOW) < 0 ||
      listen(owned->fd, MAX_CHILDREN) < 0 || verify_directory(owned->parent_fd, TARGET_HELPER_SUPERVISOR_UID,
        TARGET_HELPER_BRIDGE_GID, 0710, &parent_identity) < 0) return -1;
  struct stat final;
  if (fstatat(owned->parent_fd, owned->name, &final, AT_SYMLINK_NOFOLLOW) < 0 || !S_ISSOCK(final.st_mode) ||
      final.st_dev != created.st_dev || final.st_ino != created.st_ino || final.st_uid != TARGET_HELPER_SUPERVISOR_UID ||
      final.st_gid != TARGET_HELPER_BRIDGE_GID || (final.st_mode & 0777) != 0660) { errno = EPERM; return -1; }
  owned->dev = final.st_dev; owned->ino = final.st_ino; return 0;
}

static int preserve_socket(struct owned_socket *owned, const char *token) {
  if (owned->fd >= 0) { close(owned->fd); owned->fd = -1; }
  if (owned->parent_fd < 0) return 0;
  struct stat state;
  if (fstatat(owned->parent_fd, owned->name, &state, AT_SYMLINK_NOFOLLOW) < 0 || !S_ISSOCK(state.st_mode) ||
      state.st_dev != owned->dev || state.st_ino != owned->ino) { close(owned->parent_fd); owned->parent_fd = -1; errno = ESTALE; return -1; }
  for (unsigned attempt = 0; attempt < 32; attempt++) {
    char destination[NAME_MAX + 1];
    int length = snprintf(destination, sizeof(destination), "%s.closed.%s.%u", owned->name, token, attempt);
    if (length <= 0 || (size_t)length >= sizeof(destination)) break;
    if (syscall(SYS_renameat2, owned->parent_fd, owned->name, owned->parent_fd, destination, RENAME_NOREPLACE) == 0) {
      struct stat preserved; int result = fstatat(owned->parent_fd, destination, &preserved, AT_SYMLINK_NOFOLLOW) == 0 &&
        S_ISSOCK(preserved.st_mode) && preserved.st_dev == owned->dev && preserved.st_ino == owned->ino && fsync(owned->parent_fd) == 0 ? 0 : -1;
      close(owned->parent_fd); owned->parent_fd = -1; return result;
    }
    if (errno != EEXIST) break;
  }
  close(owned->parent_fd); owned->parent_fd = -1; return -1;
}

static int group_exists(pid_t pgid) {
  if (kill(-pgid, 0) == 0 || errno == EPERM) return 1;
  if (errno == ESRCH) return 0;
  return -1;
}

static int pid_start_identity(pid_t pid, char output[32]) {
  char path[64];if(snprintf(path,sizeof(path),"/proc/%ld/stat",(long)pid)<=0)return -1;
  int fd=open(path,O_RDONLY|O_CLOEXEC);if(fd<0)return -1;char bytes[1024];ssize_t length=read(fd,bytes,sizeof(bytes)-1);close(fd);
  if(length<=0)return -1;
  bytes[length]='\0';char *cursor=strrchr(bytes,')');if(!cursor||cursor[1]!=' '){errno=EINVAL;return -1;}cursor+=2;
  for(unsigned field=3;field<22;field++){cursor=strchr(cursor,' ');if(!cursor){errno=EINVAL;return -1;}while(*cursor==' ')cursor++;}
  char *end=strchr(cursor,' ');if(!end)end=bytes+length;size_t size=(size_t)(end-cursor);if(!size||size>=32){errno=EINVAL;return -1;}
  for(size_t index=0;index<size;index++)if(cursor[index]<'0'||cursor[index]>'9'){errno=EINVAL;return -1;}
  memcpy(output,cursor,size);output[size]='\0';return 0;
}

static int discover_adopted(struct child children[MAX_CHILDREN],unsigned child_count,
    struct adopted adopted[MAX_ADOPTED_DESCENDANTS],unsigned *adopted_count,unsigned *discovered_count) {
  char path[96],bytes[4096];if(snprintf(path,sizeof(path),"/proc/self/task/%ld/children",(long)getpid())<=0)return -1;
  int fd=open(path,O_RDONLY|O_CLOEXEC);if(fd<0)return -1;ssize_t length=read(fd,bytes,sizeof(bytes)-1);close(fd);if(length<0)return -1;bytes[length]='\0';
  *discovered_count=0;for(unsigned index=0;index<*adopted_count;index++)adopted[index].seen=0;
  char *cursor=bytes;while(*cursor){while(*cursor==' ')cursor++;if(!*cursor)break;char *end=NULL;errno=0;long parsed=strtol(cursor,&end,10);
    if(errno||end==cursor||parsed<=0||parsed>INT_MAX){errno=EPROTO;return -1;}cursor=end;
    (*discovered_count)++;int direct=0,known=0;for(unsigned index=0;index<child_count;index++)if(!children[index].direct_reaped&&children[index].pid==(pid_t)parsed)direct=1;
    for(unsigned index=0;index<*adopted_count;index++)if(adopted[index].pid==(pid_t)parsed){
      if(adopted[index].reaped){errno=ESTALE;return -1;}adopted[index].seen=1;known=1;}
    if(!direct&&!known){if(*adopted_count>=MAX_ADOPTED_DESCENDANTS){errno=E2BIG;return -1;}
      struct adopted value={.pid=(pid_t)parsed,.reaped=0,.seen=1};if(pid_start_identity(value.pid,value.start_identity)<0)return -1;
      adopted[(*adopted_count)++]=value;test_record_adopted(value.pid);}
  }
  return 0;
}

static int reap(struct child children[MAX_CHILDREN], unsigned *count,
    struct adopted adopted[MAX_ADOPTED_DESCENDANTS],unsigned *adopted_count,
    int *unknown_descendants,int *negative_liveness) {
  int status,waitpid_echild=0,reaped_adopted=0;*negative_liveness=0;
  for (;;) {
    pid_t result = waitpid(-1, &status, WNOHANG);
    if (result > 0) {
      for (unsigned index = 0; index < *count; index++)
        if (children[index].pid == result) children[index].direct_reaped = 1;
      for(unsigned index=0;index<*adopted_count;index++)if(adopted[index].pid==result){adopted[index].reaped=1;reaped_adopted=1;break;}
      continue;
    }
    if (result < 0 && errno == EINTR) continue;
    if (result < 0 && errno == ECHILD) waitpid_echild=1;
    else if (result < 0) {*unknown_descendants=1;return -1;}
    break;
  }
  if(test_fail_discovery_after_adopted_reap(reaped_adopted)<0){*unknown_descendants=1;return -1;}
  unsigned discovered_count=0;
  if(discover_adopted(children,*count,adopted,adopted_count,&discovered_count)<0){*unknown_descendants=1;return -1;}
  for(unsigned index=0;index<*adopted_count;){
    if(adopted[index].reaped||(waitpid_echild&&!adopted[index].seen)){adopted[index]=adopted[--*adopted_count];continue;}
    if(adopted[index].seen){char current[32];if(pid_start_identity(adopted[index].pid,current)<0||
        strcmp(current,adopted[index].start_identity)){*unknown_descendants=1;return -1;}}
    index++;
  }
  for (unsigned index = 0; index < *count; ) {
    int alive = group_exists(children[index].pgid);
    if (alive < 0) {*unknown_descendants=1;return -1;}
    if (children[index].direct_reaped && !alive) { children[index] = children[--(*count)]; continue; }
    index++;
  }
  if(waitpid_echild&&discovered_count==0&&*count==0&&*adopted_count==0){
    *unknown_descendants=0;*negative_liveness=1;
  }
  return 0;
}

static int signal_groups(struct child children[MAX_CHILDREN], unsigned count, int signal_number) {
  int failed = 0;
  for (unsigned index = 0; index < count; index++)
    if (kill(-children[index].pgid, signal_number) < 0 && errno != ESRCH) failed = 1;
  return failed ? -1 : 0;
}

static int signal_adopted(struct adopted adopted[MAX_ADOPTED_DESCENDANTS],unsigned count,int signal_number) {
  int failed=0;for(unsigned index=0;index<count;index++){char current[32];
    if(adopted[index].reaped)continue;
    if(pid_start_identity(adopted[index].pid,current)<0){if(errno!=ENOENT&&errno!=ESRCH)failed=1;continue;}
    if(strcmp(current,adopted[index].start_identity)){failed=1;continue;}
    if(kill(adopted[index].pid,signal_number)<0&&errno!=ESRCH)failed=1;
  }return failed?-1:0;
}

static void child_exec(int accepted, int listener, int authority, int parent, int gate, const char *token) {
  if (setpgid(0, 0) < 0) _exit(78);
#ifdef TARGET_HELPER_LISTENER_TESTING
  if (getenv("TARGET_HELPER_TEST_CHILD_EXIT_BEFORE_GATE")) {
    const char *directory = getenv("TARGET_HELPER_TEST_DIRECTORY");
    if (directory) { char marker_path[PATH_MAX]; (void)snprintf(marker_path, sizeof(marker_path), "%s/child-exit.ready", directory);
      int marker = open(marker_path, O_CREAT | O_WRONLY | O_CLOEXEC, 0600); if (marker >= 0) close(marker); }
    _exit(77);
  }
#endif
  unsigned char admission;
  ssize_t admitted; do { admitted = read(gate, &admission, 1); } while (admitted < 0 && errno == EINTR);
  close(gate); if (admitted != 1 || admission != 'G') _exit(78);
  if (dup2(accepted, STDIN_FILENO) < 0 || dup2(accepted, STDOUT_FILENO) < 0) _exit(78);
  close(accepted); close(listener); close(authority); close(parent);
#ifndef TARGET_HELPER_SKIP_PRIVILEGE_DROP
  for (int capability = 0; capability <= CAP_LAST_CAP; capability++)
    if (prctl(PR_CAPBSET_DROP, capability, 0, 0, 0) < 0 && errno != EINVAL) _exit(78);
  if (setgroups(0, NULL) < 0 || setgid(TARGET_HELPER_GID) < 0 || setuid(TARGET_HELPER_UID) < 0) _exit(78);
#endif
  struct __user_cap_header_struct capability_header = { .version = _LINUX_CAPABILITY_VERSION_3, .pid = 0 };
  struct __user_cap_data_struct capability_data[2] = {{0}, {0}};
  if (syscall(SYS_capset, &capability_header, capability_data) < 0 ||
      prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) < 0 ||
      prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0 || syscall(SYS_close_range, 3U, ~0U, 0) < 0) _exit(78);
  char token_env[128], root_env[PATH_MAX + 64], keyring_env[PATH_MAX + 64], identity_env[PATH_MAX + 64], uid_env[64], gid_env[64];
  (void)snprintf(token_env, sizeof(token_env), "DARSHAN_TARGET_HELPER_INSTANCE_AUTHORITY_TOKEN=%s", token);
  (void)snprintf(root_env, sizeof(root_env), "DARSHAN_TARGET_HELPER_JOURNAL_ROOT=%s", TARGET_HELPER_JOURNAL_ROOT);
  (void)snprintf(keyring_env, sizeof(keyring_env), "DARSHAN_TARGET_HELPER_KEYRING_FILE=%s", TARGET_HELPER_KEYRING_FILE);
  (void)snprintf(identity_env, sizeof(identity_env), "DARSHAN_TARGET_HELPER_IDENTITY_FILE=%s", TARGET_HELPER_IDENTITY_FILE);
  (void)snprintf(uid_env, sizeof(uid_env), "DARSHAN_TARGET_HELPER_UID=%u", TARGET_HELPER_UID);
  (void)snprintf(gid_env, sizeof(gid_env), "DARSHAN_TARGET_HELPER_GID=%u", TARGET_HELPER_GID);
  char *const argv[] = { (char *)TARGET_HELPER_NODE_PATH, (char *)TARGET_HELPER_WORKER_PATH, NULL };
  char *const envp[] = { token_env, root_env, keyring_env, identity_env, uid_env, gid_env,
    "DARSHAN_TARGET_HELPER_SITE_ID=" TARGET_HELPER_SITE_ID,
    "DARSHAN_TARGET_HELPER_INSTALLATION_ID=" TARGET_HELPER_INSTALLATION_ID,
    "DARSHAN_TARGET_HELPER_POLICY_SHA256=" TARGET_HELPER_POLICY_SHA256,
    "DARSHAN_TARGET_HELPER_ROLE_SHA256=" TARGET_HELPER_ROLE_SHA256,
    "DARSHAN_TARGET_HELPER_ENGINE_PROFILE_SHA256=" TARGET_HELPER_ENGINE_PROFILE_SHA256,
    "DARSHAN_TARGET_HELPER_SPECIFICATION_ROOT_SHA256=" TARGET_HELPER_SPECIFICATION_ROOT_SHA256,
    "DARSHAN_TARGET_HELPER_EVIDENCE_ROOT_SHA256=" TARGET_HELPER_EVIDENCE_ROOT_SHA256,
    "DARSHAN_TARGET_HELPER_ALLOCATION_LEDGER_ROOT_SHA256=" TARGET_HELPER_ALLOCATION_LEDGER_ROOT_SHA256,
    "DARSHAN_TARGET_HELPER_ALLOCATION_CONTROL_ROOT_SHA256=" TARGET_HELPER_ALLOCATION_CONTROL_ROOT_SHA256,
    "DARSHAN_TARGET_HELPER_ACTIVE_ROOT_SHA256=" TARGET_HELPER_ACTIVE_ROOT_SHA256,
    "DARSHAN_TARGET_HELPER_QUARANTINE_ROOT_SHA256=" TARGET_HELPER_QUARANTINE_ROOT_SHA256,
    "DARSHAN_TARGET_HELPER_POOL_ROOT_SHA256=" TARGET_HELPER_POOL_ROOT_SHA256,
    "DARSHAN_TARGET_HELPER_STORAGE_AUTHORITY_SHA256=" TARGET_HELPER_STORAGE_AUTHORITY_SHA256,
    "DARSHAN_TARGET_HELPER_HOST_MODE=" TARGET_HELPER_HOST_MODE,
    "DARSHAN_TARGET_HELPER_ACTION_DEADLINE_MS=60000", "PATH=/usr/bin:/bin", "LANG=C", NULL };
  execve(TARGET_HELPER_NODE_PATH, argv, envp); _exit(78);
}

static long long monotonic_milliseconds(void) {
  struct timespec now; if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) return -1;
  return (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

int main(int argc, char **argv) {
  (void)argv;
  if (argc != 1 || getuid() != TARGET_HELPER_SUPERVISOR_UID || sigemptyset(&termination_signals) < 0 ||
      sigaddset(&termination_signals, SIGTERM) < 0 || sigaddset(&termination_signals, SIGINT) < 0 ||
      sigprocmask(SIG_BLOCK, &termination_signals, NULL) < 0 || signal(SIGPIPE, SIG_IGN) == SIG_ERR ||
      prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) < 0) return 64;
  char token[65]; int authority = acquire_authority(token);
  if (authority < 0) { fputs("target-helper-listener: authority unavailable\n", stderr); return 78; }
  struct owned_socket owned = { .fd = -1, .parent_fd = -1 };
  struct child children[MAX_CHILDREN];struct adopted adopted[MAX_ADOPTED_DESCENDANTS];
  unsigned child_count = 0,adopted_count=0; int shutdown_signal = 0, failed = 0;
  int unknown_descendants=0,negative_liveness=0;
  test_pause("authority");
  int early_signal = take_termination();
  if (early_signal > 0) { shutdown_signal=early_signal; goto shutdown; }
  if (early_signal < 0 && errno != EAGAIN) { failed=1; goto shutdown; }
  if (bind_socket(&owned) < 0) { fputs("target-helper-listener: listener unavailable\n", stderr); failed=1; goto shutdown; }
  while (!shutdown_signal && !failed) {
    if (reap(children,&child_count,adopted,&adopted_count,&unknown_descendants,&negative_liveness)<0) { failed=1; break; }
    for (unsigned accepted_this_turn = 0; accepted_this_turn < 16; accepted_this_turn++) {
      int pending_signal = take_termination();
      if (pending_signal > 0) { shutdown_signal = pending_signal; break; }
      if (pending_signal < 0 && errno != EAGAIN) { failed = 1; break; }
      int accepted = accept4(owned.fd, NULL, NULL, SOCK_CLOEXEC);
      if (accepted < 0) { if (errno == EAGAIN || errno == EWOULDBLOCK) break; if (errno == EINTR) continue; failed = 1; break; }
      struct ucred credential; socklen_t credential_length = sizeof(credential);
      if (getsockopt(accepted, SOL_SOCKET, SO_PEERCRED, &credential, &credential_length) < 0 ||
          credential_length != sizeof(credential) || credential.uid != TARGET_HELPER_BRIDGE_UID || child_count+adopted_count >= MAX_CHILDREN) {
        close(accepted); continue;
      }
      test_pause("fork");
      pending_signal = take_termination();
      if (pending_signal > 0) { close(accepted); shutdown_signal = pending_signal; break; }
      if (pending_signal < 0 && errno != EAGAIN) { close(accepted); failed = 1; break; }
      int gate[2]; if (pipe2(gate, O_CLOEXEC) < 0) { close(accepted); failed = 1; break; }
      pid_t pid = fork();
      if (pid == 0) { close(gate[1]); (void)sigprocmask(SIG_UNBLOCK, &termination_signals, NULL);
        child_exec(accepted, owned.fd, authority, owned.parent_fd, gate[0], token); }
      close(gate[0]); close(accepted);
      if (pid < 0) { close(gate[1]); failed = 1; break; }
      if (setpgid(pid, pid) < 0 && !(errno == EACCES && getpgid(pid) == pid)) {
        (void)kill(pid, SIGKILL); (void)waitpid(pid, NULL, 0); close(gate[1]); failed = 1; break;
      }
      children[child_count++] = (struct child){ .pid = pid, .pgid = pid, .direct_reaped = 0 };
      test_pause("gate");
      pending_signal = take_termination(); unsigned char admission = pending_signal > 0 ? 'X' : 'G';
      if (write(gate[1], &admission, 1) != 1) failed = 1;
      close(gate[1]);
      if (pending_signal > 0) { shutdown_signal = pending_signal; break; }
      if (pending_signal < 0 && errno != EAGAIN) { failed = 1; break; }
    }
    if (failed) break;
    const struct timespec interval = { .tv_sec = 0, .tv_nsec = 100000000 };
    int signal_number = sigtimedwait(&termination_signals, NULL, &interval);
    if (signal_number > 0) shutdown_signal = signal_number;
    else if (signal_number < 0 && errno != EAGAIN && errno != EINTR) failed = 1;
  }
shutdown:
  if(owned.fd>=0)close(owned.fd);
  owned.fd = -1;
  long long deadline = monotonic_milliseconds() + DRAIN_MILLISECONDS;
  negative_liveness=0;
  while (!negative_liveness && monotonic_milliseconds() < deadline) {
    if (reap(children,&child_count,adopted,&adopted_count,&unknown_descendants,&negative_liveness)<0) failed=1;
    const struct timespec pause = {0, 10000000}; (void)nanosleep(&pause, NULL);
  }
  if (signal_groups(children, child_count, SIGTERM) < 0||signal_adopted(adopted,adopted_count,SIGTERM)<0) failed = 1;
  deadline = monotonic_milliseconds() + TERM_MILLISECONDS;
  while (!negative_liveness && monotonic_milliseconds() < deadline) {
    if (reap(children,&child_count,adopted,&adopted_count,&unknown_descendants,&negative_liveness)<0) failed=1;
    const struct timespec pause = {0, 10000000}; (void)nanosleep(&pause, NULL);
  }
  if (signal_groups(children, child_count, SIGKILL) < 0||signal_adopted(adopted,adopted_count,SIGKILL)<0) failed = 1;
  deadline = monotonic_milliseconds() + TERM_MILLISECONDS;
  while (!negative_liveness && monotonic_milliseconds() < deadline) {
    if (reap(children,&child_count,adopted,&adopted_count,&unknown_descendants,&negative_liveness)<0) failed=1;
    const struct timespec pause = {0, 10000000}; (void)nanosleep(&pause, NULL);
  }
  while (!negative_liveness) {
    /* Bookkeeping reaching zero is insufficient. Authority release is fail-stop
       until waitpid reports ECHILD and one successful discovery/identity/group
       sweep proves there are no adopted descendants or retained groups. */
    if (signal_groups(children, child_count, SIGKILL) < 0||signal_adopted(adopted,adopted_count,SIGKILL)<0||
        reap(children,&child_count,adopted,&adopted_count,&unknown_descendants,&negative_liveness)<0) failed=1;
    if(!negative_liveness){const struct timespec pause={0,10000000};(void)nanosleep(&pause,NULL);}
  }
  if (preserve_socket(&owned, token) < 0) failed = 1;
  close(authority);
  if (failed) return 78;
  return shutdown_signal ? 128 + shutdown_signal : 78;
}
