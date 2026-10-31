#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <linux/fs.h>
#include <linux/openat2.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/random.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
#include <time.h>

#define BROKER_UID 1000
#define BROKER_GID 1000

struct listener { int fd; int directory_fd; char name[108]; const char *path; dev_t dev; ino_t ino; };
static sigset_t termination_signals;

static int block_termination_signals(void) {
  sigemptyset(&termination_signals); sigaddset(&termination_signals, SIGTERM); sigaddset(&termination_signals, SIGINT);
  return sigprocmask(SIG_BLOCK, &termination_signals, NULL);
}

static int take_signal(const struct timespec *timeout) {
  int signal_number;
  do { signal_number = sigtimedwait(&termination_signals, NULL, timeout); } while (signal_number < 0 && errno == EINTR);
  return signal_number;
}

static int open_protected_directory(const char *directory) {
  struct open_how how = { .flags = O_RDONLY | O_DIRECTORY | O_CLOEXEC,
    .resolve = RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS };
  return (int)syscall(SYS_openat2, AT_FDCWD, directory, &how, sizeof(how));
}

static int canonical_absolute_path(const char *path) {
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

static int split_path(const char *path, char *directory, size_t directory_size,
                      char *name, size_t name_size) {
  const char *slash = strrchr(path, '/');
  if (!slash || slash == path || !slash[1]) { errno = EINVAL; return -1; }
  size_t directory_length = (size_t)(slash - path);
  size_t name_length = strlen(slash + 1);
  if (directory_length >= directory_size || name_length >= name_size) { errno = ENAMETOOLONG; return -1; }
  memcpy(directory, path, directory_length); directory[directory_length] = '\0';
  memcpy(name, slash + 1, name_length + 1);
  return 0;
}

static int open_listener(struct listener *out, const char *path) {
  char directory[4096];
  if (!canonical_absolute_path(path) || strlen(path) >= sizeof(((struct sockaddr_un *)0)->sun_path) ||
      split_path(path, directory, sizeof(directory), out->name, sizeof(out->name)) < 0) return -1;
  int directory_fd = open_protected_directory(directory);
  if (directory_fd < 0) return -1;
  struct stat directory_state;
  if (fstat(directory_fd, &directory_state) < 0 || directory_state.st_uid != 0 ||
      directory_state.st_gid != BROKER_GID || (directory_state.st_mode & 0777) != 0710) {
    close(directory_fd); errno = EPERM; return -1;
  }
  struct stat existing;
  if (fstatat(directory_fd, out->name, &existing, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT) {
    close(directory_fd); errno = EEXIST; return -1;
  }
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) { close(directory_fd); return -1; }
  struct sockaddr_un address = { .sun_family = AF_UNIX };
  memcpy(address.sun_path, path, strlen(path) + 1);
  if (bind(fd, (struct sockaddr *)&address, offsetof(struct sockaddr_un, sun_path) + strlen(path) + 1) < 0) {
    int saved = errno; close(fd); close(directory_fd); errno = saved; return -1;
  }
  struct stat created;
  if (fstatat(directory_fd, out->name, &created, AT_SYMLINK_NOFOLLOW) < 0 || !S_ISSOCK(created.st_mode)) {
    int saved = errno ? errno : EPERM; close(fd); close(directory_fd); errno = saved; return -1;
  }
  out->fd = fd; out->directory_fd = directory_fd; out->path = path;
  out->dev = created.st_dev; out->ino = created.st_ino;
  if (fchmodat(directory_fd, out->name, 0660, 0) < 0 ||
      fchownat(directory_fd, out->name, BROKER_UID, BROKER_GID, AT_SYMLINK_NOFOLLOW) < 0 || listen(fd, 128) < 0 ||
      fstat(directory_fd, &directory_state) < 0 || directory_state.st_uid != 0 ||
      directory_state.st_gid != BROKER_GID || (directory_state.st_mode & 0777) != 0710) {
    errno = errno ? errno : EPERM; return -1;
  }
  struct stat final;
  if (fstatat(directory_fd, out->name, &final, AT_SYMLINK_NOFOLLOW) < 0 || !S_ISSOCK(final.st_mode) ||
      final.st_dev != out->dev || final.st_ino != out->ino || final.st_uid != BROKER_UID ||
      final.st_gid != BROKER_GID || (final.st_mode & 0777) != 0660) { errno = EPERM; return -1; }
  return 0;
}

/* The root-owned, non-group-writable parent is the exclusion boundary. No
 * process running as the broker uid can replace an entry between proof and
 * rename. Exact sockets are preserved, never unlinked or overwritten. */
static int preservation_token(struct timespec *timestamp, unsigned long long *random_value) {
#ifdef BACKUP_BROKER_LISTENER_TESTING
  const char *fixed = getenv("BACKUP_BROKER_LISTENER_TEST_TOKEN");
  if (fixed && *fixed) {
    char *end = NULL; errno = 0; *random_value = strtoull(fixed, &end, 16);
    timestamp->tv_sec = 0; timestamp->tv_nsec = 0;
    return errno == 0 && end && *end == '\0' ? 0 : -1;
  }
#endif
  if (clock_gettime(CLOCK_REALTIME, timestamp) < 0) return -1;
  ssize_t count;
  do { count = getrandom(random_value, sizeof(*random_value), 0); } while (count < 0 && errno == EINTR);
  return count == (ssize_t)sizeof(*random_value) ? 0 : -1;
}

static int preserve_listener(struct listener *listener, unsigned index) {
  if (listener->fd >= 0) { close(listener->fd); listener->fd = -1; }
  if (listener->directory_fd < 0) return 0;
  struct stat current;
  if (fstatat(listener->directory_fd, listener->name, &current, AT_SYMLINK_NOFOLLOW) < 0 ||
      current.st_dev != listener->dev || current.st_ino != listener->ino || !S_ISSOCK(current.st_mode)) {
    close(listener->directory_fd); listener->directory_fd = -1; errno = ESTALE; return -1;
  }
#ifdef BACKUP_BROKER_LISTENER_TESTING
  const char *test_directory = getenv("BACKUP_BROKER_LISTENER_TEST_DIRECTORY");
  if (test_directory && *test_directory && getenv("BACKUP_BROKER_LISTENER_TEST_PAUSE_PRESERVE")) {
    char ready[4096], proceed[4096];
    (void)snprintf(ready, sizeof(ready), "%s/preserve.%u.ready", test_directory, index);
    (void)snprintf(proceed, sizeof(proceed), "%s/preserve.%u.continue", test_directory, index);
    int marker = open(ready, O_CREAT | O_WRONLY | O_CLOEXEC, 0600); if (marker >= 0) close(marker);
    const struct timespec interval = { .tv_sec = 0, .tv_nsec = 10000000 };
    for (unsigned attempt = 0; attempt < 500 && access(proceed, F_OK) < 0; attempt++) (void)nanosleep(&interval, NULL);
  }
#endif
  struct timespec timestamp; unsigned long long random_value;
  if (preservation_token(&timestamp, &random_value) < 0) {
    close(listener->directory_fd); listener->directory_fd = -1; return -1;
  }
  int result = -1;
  for (unsigned attempt = 0; attempt < 32; attempt++) {
    char destination[NAME_MAX + 1];
    int length = snprintf(destination, sizeof(destination), "%s.closed.%016llx.%08lx.%016llx.%u.%u",
      listener->name, (unsigned long long)timestamp.tv_sec, (unsigned long)timestamp.tv_nsec,
      random_value, index, attempt);
    if (length <= 0 || (size_t)length >= sizeof(destination)) { errno = ENAMETOOLONG; break; }
    if (syscall(SYS_renameat2, listener->directory_fd, listener->name,
                listener->directory_fd, destination, RENAME_NOREPLACE) == 0) {
      struct stat preserved;
      if (fstatat(listener->directory_fd, destination, &preserved, AT_SYMLINK_NOFOLLOW) == 0 &&
          preserved.st_dev == listener->dev && preserved.st_ino == listener->ino && S_ISSOCK(preserved.st_mode)) result = 0;
      else errno = ESTALE;
      break;
    }
    if (errno != EEXIST) break;
  }
  int saved = errno;
  close(listener->directory_fd); listener->directory_fd = -1; errno = saved;
  return result;
}

int main(int argc, char **argv) {
  if (argc < 2) { fputs("usage: backup-broker-listener PROGRAM [ARGS...]\n", stderr); return 64; }
  if (block_termination_signals() < 0) { perror("broker listener signals"); return 78; }
#ifdef BACKUP_BROKER_LISTENER_TESTING
  const char *test_directory = getenv("BACKUP_BROKER_LISTENER_TEST_DIRECTORY");
  if (test_directory && *test_directory && getenv("BACKUP_BROKER_LISTENER_TEST_EARLY_SIGNAL")) {
    char ready[4096], proceed[4096];
    (void)snprintf(ready, sizeof(ready), "%s/startup.ready", test_directory);
    (void)snprintf(proceed, sizeof(proceed), "%s/startup.continue", test_directory);
    int marker = open(ready, O_CREAT | O_WRONLY | O_CLOEXEC, 0600); if (marker >= 0) close(marker);
    const struct timespec interval = { .tv_sec = 0, .tv_nsec = 10000000 };
    for (unsigned attempt = 0; attempt < 500 && access(proceed, F_OK) < 0; attempt++) (void)nanosleep(&interval, NULL);
  }
#endif
  const struct timespec immediate = { .tv_sec = 0, .tv_nsec = 0 };
  int early_signal = take_signal(&immediate);
  if (early_signal > 0) return 128 + early_signal;
  if (early_signal < 0 && errno != EAGAIN) { perror("broker listener early signal"); return 78; }
  const char *main_path = getenv("BACKUP_BROKER_SOCKET_PATH");
  const char *recovery_path = getenv("BACKUP_BROKER_RECOVERY_SOCKET_PATH");
  if (getuid() != 0 || !main_path || !*main_path || !recovery_path || !*recovery_path ||
      strcmp(main_path, recovery_path) == 0) return 78;
  struct listener listeners[2] = {{ .fd = -1, .directory_fd = -1 }, { .fd = -1, .directory_fd = -1 }};
  if (open_listener(&listeners[0], main_path) < 0) {
    perror("main broker listener"); if (preserve_listener(&listeners[0], 0) < 0) perror("main listener preservation"); return 78;
  }
  if (open_listener(&listeners[1], recovery_path) < 0) {
    perror("recovery broker listener");
    if (preserve_listener(&listeners[1], 1) < 0) perror("recovery listener preservation");
    if (preserve_listener(&listeners[0], 0) < 0) perror("main listener preservation");
    return 78;
  }
  early_signal = take_signal(&immediate);
  if (early_signal > 0) {
    int failed = preserve_listener(&listeners[1], 1) < 0;
    failed |= preserve_listener(&listeners[0], 0) < 0;
    return failed ? 78 : 128 + early_signal;
  }
  if (early_signal < 0 && errno != EAGAIN) {
    perror("broker listener pre-fork signal");
    if (preserve_listener(&listeners[1], 1) < 0) perror("recovery listener preservation");
    if (preserve_listener(&listeners[0], 0) < 0) perror("main listener preservation");
    return 78;
  }
  pid_t pid = fork();
  if (pid < 0) {
    if (preserve_listener(&listeners[1], 1) < 0) perror("recovery listener preservation");
    if (preserve_listener(&listeners[0], 0) < 0) perror("main listener preservation");
    return 78;
  }
  if (pid == 0) {
    if (sigprocmask(SIG_UNBLOCK, &termination_signals, NULL) < 0) _exit(78);
    close(listeners[0].directory_fd); close(listeners[1].directory_fd);
    if (dup2(listeners[0].fd, 3) < 0 || dup2(listeners[1].fd, 4) < 0) { perror("listener fd handoff"); _exit(78); }
    if (fcntl(3, F_SETFD, 0) < 0 || fcntl(4, F_SETFD, 0) < 0) { perror("listener fd flags"); _exit(78); }
    if (setgroups(0, NULL) < 0 || setgid(BROKER_GID) < 0 || setuid(BROKER_UID) < 0) { perror("broker privilege drop"); _exit(78); }
    setenv("BACKUP_BROKER_MAIN_LISTEN_FD", "3", 1);
    setenv("BACKUP_BROKER_RECOVERY_LISTEN_FD", "4", 1);
    if (listeners[0].fd > 4) close(listeners[0].fd);
    if (listeners[1].fd > 4) close(listeners[1].fd);
    execvp(argv[1], &argv[1]); perror("broker exec"); _exit(78);
  }
  close(listeners[0].fd); listeners[0].fd = -1;
  close(listeners[1].fd); listeners[1].fd = -1;
  int forward_failed = 0;
  int status = 78 << 8;
  for (;;) {
    pid_t waited = waitpid(pid, &status, WNOHANG);
    if (waited == pid) break;
    if (waited < 0) { perror("broker child wait"); forward_failed = 1; break; }
#ifdef BACKUP_BROKER_LISTENER_TESTING
    const char *test_directory = getenv("BACKUP_BROKER_LISTENER_TEST_DIRECTORY");
    if (test_directory && *test_directory && getenv("BACKUP_BROKER_LISTENER_TEST_WAIT_BOUNDARY")) {
      char arm[4096], ready[4096], proceed[4096];
      (void)snprintf(arm, sizeof(arm), "%s/wait.arm", test_directory);
      (void)snprintf(ready, sizeof(ready), "%s/wait.ready", test_directory);
      (void)snprintf(proceed, sizeof(proceed), "%s/wait.continue", test_directory);
      if (access(arm, F_OK) == 0) {
        int marker = open(ready, O_CREAT | O_WRONLY | O_CLOEXEC, 0600); if (marker >= 0) close(marker);
        const struct timespec interval = { .tv_sec = 0, .tv_nsec = 10000000 };
        for (unsigned attempt = 0; attempt < 500 && access(proceed, F_OK) < 0; attempt++) (void)nanosleep(&interval, NULL);
      }
    }
#endif
    const struct timespec wait_interval = { .tv_sec = 0, .tv_nsec = 100000000 };
    int signal_number = take_signal(&wait_interval);
    if (signal_number > 0) {
      if (kill(pid, signal_number) < 0 && errno != ESRCH) { perror("broker child signal"); forward_failed = 1; }
    } else if (signal_number < 0 && errno != EAGAIN) {
      perror("broker signal wait"); forward_failed = 1; break;
    }
  }
  int preserve_failed = preserve_listener(&listeners[1], 1) < 0;
  if (preserve_failed) perror("recovery listener preservation");
  if (preserve_listener(&listeners[0], 0) < 0) { perror("main listener preservation"); preserve_failed = 1; }
  if (forward_failed || preserve_failed) return 78;
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 78;
}
