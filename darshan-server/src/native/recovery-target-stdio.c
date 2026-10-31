#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>
#include <time.h>
#include <signal.h>
#include <stdlib.h>
#include <unistd.h>

#ifndef TARGET_HELPER_SOCKET_PATH
#define TARGET_HELPER_SOCKET_PATH "/run/darshan-recovery-target/helper.sock"
#endif
#define MAX_REQUEST_BYTES (64U * 1024U + 1U)
#define MAX_RESPONSE_BYTES (128U * 1024U + 1U)
#ifndef IO_TIMEOUT_MILLISECONDS
#define IO_TIMEOUT_MILLISECONDS 65000
#endif

static long long monotonic_milliseconds(void) {
  struct timespec now; if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) return -1;
  return (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int wait_fd(int fd, short events, long long deadline) {
  for (;;) {
    long long now = monotonic_milliseconds(); if (now < 0 || now >= deadline) { errno = ETIMEDOUT; return -1; }
    int remaining = (int)(deadline - now); struct pollfd item = { .fd = fd, .events = events };
    int result = poll(&item, 1, remaining);
    if (result > 0 && ((item.revents & events) || (events == POLLIN && (item.revents & POLLHUP)))) return 0;
    if (result > 0 && (item.revents & (POLLERR | POLLHUP)) && !(item.revents & events)) { errno = ECONNRESET; return -1; }
    if (result < 0 && errno == EINTR) continue;
    if (result == 0) errno = ETIMEDOUT;
    if (result <= 0) return -1;
  }
}

static int nonblocking(int fd) {
  int flags = fcntl(fd, F_GETFL); return flags < 0 ? -1 : fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static int read_frame(int fd, unsigned char *buffer, size_t capacity, size_t *length, long long deadline) {
  size_t used = 0; int newline = 0;
  while (used < capacity) {
    if (wait_fd(fd, POLLIN, deadline) < 0) return -1;
    ssize_t count = read(fd, buffer + used, capacity - used);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) continue;
    if (count < 0) return -1;
    if (count == 0) break;
    for (ssize_t index = 0; index < count; index++) {
      unsigned char value = buffer[used + (size_t)index];
      if (value == '\r' || newline) { errno = EPROTO; return -1; }
      if (value == '\n') { if (newline || index != count - 1) { errno = EPROTO; return -1; } newline = 1; }
    }
    used += (size_t)count;
    if (newline) {
      unsigned char extra;
      if (wait_fd(fd, POLLIN, deadline) < 0) return -1;
      do { count = read(fd, &extra, 1); } while (count < 0 && errno == EINTR);
      if (count != 0) { errno = count > 0 ? EPROTO : errno; return -1; }
      break;
    }
  }
  if (used < 2 || used > capacity || !newline || buffer[used - 1] != '\n') { errno = used == capacity ? EFBIG : EPROTO; return -1; }
  *length = used; return 0;
}

static int write_all(int fd, const unsigned char *bytes, size_t length, long long deadline, int socket_output) {
  size_t offset = 0;
  while (offset < length) {
    if (wait_fd(fd, POLLOUT, deadline) < 0) return -1;
    ssize_t count = socket_output ? send(fd, bytes + offset, length - offset, MSG_NOSIGNAL)
      : write(fd, bytes + offset, length - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) continue;
    if (count <= 0) return -1;
    offset += (size_t)count;
  }
  return 0;
}

int main(int argc, char **argv) {
  (void)argv;
  const char *original_command = getenv("SSH_ORIGINAL_COMMAND");
  if (argc != 1 || TARGET_HELPER_SOCKET_PATH[0] != '/' || strlen(TARGET_HELPER_SOCKET_PATH) >= sizeof(((struct sockaddr_un *)0)->sun_path)) {
    fputs("recovery-target-stdio: invalid invocation\n", stderr); return 64;
  }
  if (original_command && original_command[0] != '\0') {
    fputs("recovery-target-stdio: original command forbidden\n", stderr); return 64;
  }
  if (signal(SIGPIPE, SIG_IGN) == SIG_ERR || nonblocking(STDIN_FILENO) < 0 || nonblocking(STDOUT_FILENO) < 0) return 71;
  unsigned char request[MAX_REQUEST_BYTES], response[MAX_RESPONSE_BYTES]; size_t request_length, response_length;
  long long deadline = monotonic_milliseconds() + IO_TIMEOUT_MILLISECONDS;
  if (read_frame(STDIN_FILENO, request, sizeof(request), &request_length, deadline) < 0) {
    fputs("recovery-target-stdio: invalid request frame\n", stderr); return 65;
  }
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0); if (fd < 0) return 71;
  struct sockaddr_un address = { .sun_family = AF_UNIX };
  memcpy(address.sun_path, TARGET_HELPER_SOCKET_PATH, strlen(TARGET_HELPER_SOCKET_PATH) + 1);
  if (connect(fd, (struct sockaddr *)&address,
      offsetof(struct sockaddr_un, sun_path) + strlen(TARGET_HELPER_SOCKET_PATH) + 1) < 0) {
    if (errno != EINPROGRESS || wait_fd(fd, POLLOUT, deadline) < 0) {
      close(fd); fputs("recovery-target-stdio: helper unavailable\n", stderr); return 69;
    }
    int socket_error = 0; socklen_t socket_error_length = sizeof(socket_error);
    if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &socket_error, &socket_error_length) < 0 || socket_error != 0) {
      close(fd); fputs("recovery-target-stdio: helper unavailable\n", stderr); return 69;
    }
  }
  if (write_all(fd, request, request_length, deadline, 1) < 0 || shutdown(fd, SHUT_WR) < 0 ||
      wait_fd(fd, POLLIN, deadline) < 0 || read_frame(fd, response, sizeof(response), &response_length, deadline) < 0) {
    close(fd); fputs("recovery-target-stdio: bounded exchange failed\n", stderr); return 74;
  }
  close(fd);
  if (write_all(STDOUT_FILENO, response, response_length, deadline, 0) < 0) {
    fputs("recovery-target-stdio: output failed\n", stderr); return 74;
  }
  return 0;
}
