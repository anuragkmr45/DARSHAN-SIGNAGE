#define _POSIX_C_SOURCE 200809L
#include <fcntl.h>
#include <stddef.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* No environment-selected executable, PATH lookup, shell, or argument rewriting. */
static int allowed(const char *path) {
  static const char *const tools[] = {
    "/usr/bin/age", "/usr/bin/age-keygen", "/usr/bin/ffmpeg", "/usr/bin/ffprobe"
  };
  for (size_t index = 0; index < sizeof(tools) / sizeof(tools[0]); index++) {
    if (strcmp(path, tools[index]) == 0) return 1;
  }
  return 0;
}

/* Build-only probe: the fixed path is exclusively created, inspected and removed. */
static int self_test(void) {
  static const char path[] = "/tmp/darshan-d3-tool-umask-test";
  struct stat observed;
  int descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0666);
  if (descriptor < 0) return 70;
  int valid = fstat(descriptor, &observed) == 0 && S_ISREG(observed.st_mode)
    && (observed.st_mode & 07777) == 0600 && observed.st_nlink == 1;
  int closed = close(descriptor);
  int removed = unlink(path);
  return valid && closed == 0 && removed == 0 ? 0 : 70;
}

int main(int argc, char **argv) {
  umask(0077);
  if (argc == 2 && strcmp(argv[1], "--self-test") == 0) return self_test();
  if (argc < 2 || !allowed(argv[1])) return 64;
  execv(argv[1], &argv[1]);
  return 127;
}
