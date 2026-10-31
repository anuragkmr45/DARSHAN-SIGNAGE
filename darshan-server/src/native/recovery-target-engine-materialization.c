#define _GNU_SOURCE
#include "recovery-target-engine-materialization.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/if_alg.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static const char zero_sha256[] = "0000000000000000000000000000000000000000000000000000000000000000";
enum parsed_kind { PARSED_INTENT = 1, PARSED_RECEIPT = 2 };

struct parsed_record {
  enum parsed_kind kind;
  uint64_t sequence;
  struct rtem_identity identity;
  char intent_sha256[65], observation_sha256[65];
  int authoritative_complete;
  struct rtem_actual_resource actual;
  char previous_head_sha256[65], record_sha256[65];
};
struct pending_intent {
  struct rtem_identity identity;
  uint64_t sequence;
  char record_sha256[65];
  int terminal;
  struct parsed_record receipt;
};
struct scan_state { struct pending_intent intents[RTEM_MAX_RECORDS]; size_t intent_count; };

static int lower_hex(const char *v, size_t n) {
  if (!v || strlen(v) != n) return 0;
  for (size_t i = 0; i < n; i++) if (!((v[i] >= '0' && v[i] <= '9') || (v[i] >= 'a' && v[i] <= 'f'))) return 0;
  return 1;
}
static int handle(const char *v) {
  size_t n = v ? strlen(v) : 0;
  if (n < 25 || n > 120 || memcmp(v, "tra:v1:", 7)) return 0;
  for (size_t i = 7; i < n; i++) if (!((v[i] >= 'A' && v[i] <= 'Z') || (v[i] >= 'a' && v[i] <= 'z') ||
      (v[i] >= '0' && v[i] <= '9') || v[i] == '_' || v[i] == '-' || v[i] == ':')) return 0;
  return 1;
}
static int uuid(const char *v) {
  if (!v || strlen(v) != 36) return 0;
  for (size_t i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (v[i] != '-') return 0; }
    else if (!((v[i] >= '0' && v[i] <= '9') || (v[i] >= 'a' && v[i] <= 'f'))) return 0;
  }
  return v[14] >= '1' && v[14] <= '8' && strchr("89ab", v[19]);
}
static int sha256(const void *bytes, size_t size, char output[65]) {
  int alg = socket(AF_ALG, SOCK_SEQPACKET | SOCK_CLOEXEC, 0); if (alg < 0) return -1;
  struct sockaddr_alg addr = { .salg_family = AF_ALG, .salg_type = "hash", .salg_name = "sha256" };
  if (bind(alg, (struct sockaddr *)&addr, sizeof(addr)) < 0) { int e = errno; close(alg); errno = e; return -1; }
  int op = accept4(alg, NULL, NULL, SOCK_CLOEXEC); close(alg); if (op < 0) return -1;
  if (send(op, bytes, size, 0) != (ssize_t)size) { int e = errno ? errno : EIO; close(op); errno = e; return -1; }
  unsigned char digest[32]; ssize_t count = read(op, digest, sizeof(digest)); close(op);
  if (count != (ssize_t)sizeof(digest)) { errno = EIO; return -1; }
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < sizeof(digest); i++) { output[i * 2] = hex[digest[i] >> 4]; output[i * 2 + 1] = hex[digest[i] & 15u]; }
  output[64] = '\0'; return 0;
}
static int verify_directory(struct rtem_journal *j) {
  struct stat s;
  if (fstat(j->directory_fd, &s) < 0 || !S_ISDIR(s.st_mode) || s.st_dev != j->device || s.st_ino != j->inode ||
      s.st_uid != j->owner_uid || s.st_gid != j->owner_gid || (s.st_mode & 0777) != 0700) { errno = EPERM; return -1; }
  return 0;
}
static int record_name(uint64_t seq, const char sha[65], const char *kind, char out[192]) {
  int n = snprintf(out, 192, "materialization-%020llu-%s.%s", (unsigned long long)seq, sha, kind);
  return n > 0 && n < 192 ? 0 : -1;
}
static int parse_name(const char *name, uint64_t *seq, char sha[65], char kind[8]) {
  unsigned long long n = 0; char extra = '\0';
  if (sscanf(name, "materialization-%20llu-%64[a-f0-9].%7[A-Z]%c", &n, sha, kind, &extra) != 3 || n == 0 ||
      strlen(sha) != 64 || (strcmp(kind, "INTENT") && strcmp(kind, "RECEIPT"))) return 0;
  char canonical[192]; if (record_name((uint64_t)n, sha, kind, canonical) < 0 || strcmp(canonical, name)) return 0;
  *seq = (uint64_t)n; return 1;
}
static int read_record(struct rtem_journal *j, const char *name, char bytes[RTEM_MAX_RECORD_BYTES], size_t *size) {
  int fd = openat(j->directory_fd, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK); struct stat before, after;
  if (fd < 0 || fstat(fd, &before) < 0 || !S_ISREG(before.st_mode) || before.st_nlink != 1 ||
      before.st_uid != j->owner_uid || before.st_gid != j->owner_gid || (before.st_mode & 0777) != 0600 ||
      before.st_dev != j->device || before.st_size <= 0 || before.st_size > (off_t)RTEM_MAX_RECORD_BYTES) {
    if (fd >= 0) close(fd);
    errno = EPERM; return -1;
  }
  ssize_t count = pread(fd, bytes, (size_t)before.st_size, 0); char extra; ssize_t more = pread(fd, &extra, 1, before.st_size);
  int stable = fstat(fd, &after) == 0 && before.st_dev == after.st_dev && before.st_ino == after.st_ino &&
    before.st_size == after.st_size && before.st_mtim.tv_sec == after.st_mtim.tv_sec && before.st_mtim.tv_nsec == after.st_mtim.tv_nsec;
  close(fd);
  if (count != before.st_size || more != 0 || !stable || memchr(bytes, '\0', (size_t)count) || bytes[count - 1] != '\n') {
    errno = EPROTO; return -1;
  }
  *size = (size_t)count; return 0;
}
static int take_line(const char **cursor, const char *end, const char *key, char *out, size_t cap) {
  size_t k = strlen(key); const char *start = *cursor, *nl = memchr(start, '\n', (size_t)(end - start));
  if (!nl || (size_t)(nl - start) <= k || memcmp(start, key, k) || start[k] != '=') { errno = EPROTO; return -1; }
  size_t n = (size_t)(nl - start - k - 1); if (!n || n >= cap) { errno = EPROTO; return -1; }
  memcpy(out, start + k + 1, n); out[n] = '\0'; *cursor = nl + 1; return 0;
}
static int fixed_line(const char **cursor, const char *end, const char *key, const char *expected) {
  char v[192]; if (take_line(cursor, end, key, v, sizeof(v)) < 0 || strcmp(v, expected)) { errno = EPROTO; return -1; }
  return 0;
}
static int parse_u64_20(const char *v, uint64_t *out) {
  if (strlen(v) != 20) return 0;
  unsigned long long n = 0;
  for (size_t i = 0; i < 20; i++) { if (v[i] < '0' || v[i] > '9') return 0; unsigned d = (unsigned)(v[i] - '0');
    if (n > (ULLONG_MAX - d) / 10u) return 0;
    n = n * 10u + d;
  }
  if (!n) return 0;
  *out = (uint64_t)n; return 1;
}
static enum rtem_role parse_role(const char *v) {
  if (!strcmp(v, "NETWORK")) return RTEM_ROLE_NETWORK;
  if (!strcmp(v, "POSTGRES")) return RTEM_ROLE_POSTGRES;
  if (!strcmp(v, "MINIO")) return RTEM_ROLE_MINIO;
  return 0;
}
static const char *role_name(enum rtem_role r) { return r == RTEM_ROLE_NETWORK ? "NETWORK" : r == RTEM_ROLE_POSTGRES ? "POSTGRES" : "MINIO"; }
static enum rtem_operation parse_operation(const char *v) {
  if (!strcmp(v, "ENSURE_INTERNAL_NETWORK")) return RTEM_OPERATION_ENSURE_INTERNAL_NETWORK;
  if (!strcmp(v, "CREATE_POSTGRES")) return RTEM_OPERATION_CREATE_POSTGRES;
  if (!strcmp(v, "CREATE_MINIO")) return RTEM_OPERATION_CREATE_MINIO;
  return 0;
}
static const char *operation_name(enum rtem_operation op) {
  return op == RTEM_OPERATION_ENSURE_INTERNAL_NETWORK ? "ENSURE_INTERNAL_NETWORK" :
    op == RTEM_OPERATION_CREATE_POSTGRES ? "CREATE_POSTGRES" : "CREATE_MINIO";
}
static int operation_role(enum rtem_operation op, enum rtem_role role) {
  return (op == RTEM_OPERATION_ENSURE_INTERNAL_NETWORK && role == RTEM_ROLE_NETWORK) ||
    (op == RTEM_OPERATION_CREATE_POSTGRES && role == RTEM_ROLE_POSTGRES) ||
    (op == RTEM_OPERATION_CREATE_MINIO && role == RTEM_ROLE_MINIO);
}
static int valid_identity(const struct rtem_identity *i) {
  return i && uuid(i->operation_id) && i->generation && operation_role(i->operation, i->role) && handle(i->target_handle) &&
    handle(i->resource_handle) && lower_hex(i->profile_sha256, 64) && lower_hex(i->admission_sha256, 64) &&
    lower_hex(i->command_sha256, 64) && lower_hex(i->command_nonce, 32);
}
static int parse_identity(const char **cursor, const char *end, struct rtem_identity *i) {
  char generation[32], operation[40], role[16];
  if (take_line(cursor, end, "operation", operation, sizeof(operation)) < 0 ||
      take_line(cursor, end, "operation_id", i->operation_id, sizeof(i->operation_id)) < 0 ||
      take_line(cursor, end, "target_handle", i->target_handle, sizeof(i->target_handle)) < 0 ||
      take_line(cursor, end, "generation", generation, sizeof(generation)) < 0 ||
      take_line(cursor, end, "role", role, sizeof(role)) < 0 ||
      take_line(cursor, end, "resource_handle", i->resource_handle, sizeof(i->resource_handle)) < 0 ||
      take_line(cursor, end, "profile_sha256", i->profile_sha256, sizeof(i->profile_sha256)) < 0 ||
      take_line(cursor, end, "admission_sha256", i->admission_sha256, sizeof(i->admission_sha256)) < 0 ||
      take_line(cursor, end, "command_sha256", i->command_sha256, sizeof(i->command_sha256)) < 0 ||
      take_line(cursor, end, "command_nonce", i->command_nonce, sizeof(i->command_nonce)) < 0) return -1;
  i->operation = parse_operation(operation); i->role = parse_role(role);
  if (!parse_u64_20(generation, &i->generation) || !valid_identity(i)) { errno = EPROTO; return -1; }
  return 0;
}
static int strict_resource_id(const char *v) { return lower_hex(v, 64); }
static int strict_image_id(const char *v) { return strlen(v) == 71 && !memcmp(v, "sha256:", 7) && lower_hex(v + 7, 64); }
static int parse_record(const char *bytes, size_t size, const char *file_kind, uint64_t file_sequence,
    const char file_sha[65], struct parsed_record *r) {
  const char *cursor = bytes, *end = bytes + size; char kind[16], sequence[32]; memset(r, 0, sizeof(*r));
  if (fixed_line(&cursor, end, "format", "darshan-recovery-target-materialization-v2") < 0 ||
      take_line(&cursor, end, "kind", kind, sizeof(kind)) < 0 || take_line(&cursor, end, "sequence", sequence, sizeof(sequence)) < 0 ||
      !parse_u64_20(sequence, &r->sequence) || r->sequence != file_sequence || strcmp(kind, file_kind) ||
      (strcmp(kind, "INTENT") && strcmp(kind, "RECEIPT")) || parse_identity(&cursor, end, &r->identity) < 0) { errno = EPROTO; return -1; }
  r->kind = !strcmp(kind, "INTENT") ? PARSED_INTENT : PARSED_RECEIPT;
  if (r->kind == PARSED_RECEIPT) {
    char outcome[16], resource[80], image[80], image_config[80], config[80], labels[80], consumers[80], daemon[80];
    if (take_line(&cursor, end, "intent_sha256", r->intent_sha256, sizeof(r->intent_sha256)) < 0 ||
        take_line(&cursor, end, "observation_sha256", r->observation_sha256, sizeof(r->observation_sha256)) < 0 ||
        take_line(&cursor, end, "outcome", outcome, sizeof(outcome)) < 0 || take_line(&cursor, end, "resource_id", resource, sizeof(resource)) < 0 ||
        take_line(&cursor, end, "image_id", image, sizeof(image)) < 0 || take_line(&cursor, end, "image_config_sha256", image_config, sizeof(image_config)) < 0 ||
        take_line(&cursor, end, "effective_configuration_sha256", config, sizeof(config)) < 0 ||
        take_line(&cursor, end, "owner_labels_sha256", labels, sizeof(labels)) < 0 ||
        take_line(&cursor, end, "consumer_set_sha256", consumers, sizeof(consumers)) < 0 ||
        take_line(&cursor, end, "daemon_identity_sha256", daemon, sizeof(daemon)) < 0 ||
        !lower_hex(r->intent_sha256, 64) || !lower_hex(r->observation_sha256, 64) ||
        (strcmp(outcome, "COMPLETE") && strcmp(outcome, "AMBIGUOUS"))) { errno = EPROTO; return -1; }
    r->authoritative_complete = !strcmp(outcome, "COMPLETE");
    if (r->authoritative_complete) {
      int network = r->identity.role == RTEM_ROLE_NETWORK;
      if (!strict_resource_id(resource) || (network ? strcmp(image, "null") != 0 : !strict_image_id(image)) ||
          !lower_hex(image_config, 64) || !lower_hex(config, 64) || !lower_hex(labels, 64) || !lower_hex(consumers, 64) || !lower_hex(daemon, 64)) {
        errno = EPROTO; return -1;
      }
      r->actual.observed = 1; strcpy(r->actual.resource_id, resource); if (!network) strcpy(r->actual.image_id, image);
      strcpy(r->actual.image_config_sha256, image_config); strcpy(r->actual.effective_configuration_sha256, config);
      strcpy(r->actual.owner_labels_sha256, labels); strcpy(r->actual.consumer_set_sha256, consumers); strcpy(r->actual.daemon_identity_sha256, daemon);
    } else if (strcmp(resource, "null") || strcmp(image, "null") || strcmp(image_config, "null") || strcmp(config, "null") ||
        strcmp(labels, "null") || strcmp(consumers, "null") || strcmp(daemon, "null")) { errno = EPROTO; return -1; }
  }
  if (take_line(&cursor, end, "previous_head_sha256", r->previous_head_sha256, sizeof(r->previous_head_sha256)) < 0 ||
      !lower_hex(r->previous_head_sha256, 64) || cursor != end) { errno = EPROTO; return -1; }
  strcpy(r->record_sha256, file_sha); return 0;
}
static int same_identity(const struct rtem_identity *a, const struct rtem_identity *b) {
  return a->generation == b->generation && a->operation == b->operation && a->role == b->role &&
    !strcmp(a->operation_id, b->operation_id) && !strcmp(a->target_handle, b->target_handle) &&
    !strcmp(a->resource_handle, b->resource_handle) && !strcmp(a->profile_sha256, b->profile_sha256) &&
    !strcmp(a->admission_sha256, b->admission_sha256) && !strcmp(a->command_sha256, b->command_sha256) && !strcmp(a->command_nonce, b->command_nonce);
}
static int same_actual(const struct rtem_actual_resource *a, const struct rtem_actual_resource *b) {
  return a->observed == b->observed && !strcmp(a->resource_id, b->resource_id) && !strcmp(a->image_id, b->image_id) &&
    !strcmp(a->image_config_sha256, b->image_config_sha256) && !strcmp(a->effective_configuration_sha256, b->effective_configuration_sha256) &&
    !strcmp(a->owner_labels_sha256, b->owner_labels_sha256) && !strcmp(a->consumer_set_sha256, b->consumer_set_sha256) &&
    !strcmp(a->daemon_identity_sha256, b->daemon_identity_sha256);
}
static struct pending_intent *find_intent_hash(struct scan_state *s, const char sha[65]) {
  for (size_t i = 0; i < s->intent_count; i++)
    if (!strcmp(s->intents[i].record_sha256, sha)) return &s->intents[i];
  return NULL;
}
static struct pending_intent *find_intent_command(struct scan_state *s, const char sha[65]) {
  for (size_t i = 0; i < s->intent_count; i++)
    if (!strcmp(s->intents[i].identity.command_sha256, sha)) return &s->intents[i];
  return NULL;
}
static int apply_transition(struct scan_state *s, const struct parsed_record *r) {
  if (r->kind == PARSED_INTENT) {
    if (s->intent_count >= RTEM_MAX_RECORDS || find_intent_command(s, r->identity.command_sha256)) { errno = EPROTO; return -1; }
    struct pending_intent *p = &s->intents[s->intent_count++]; memset(p, 0, sizeof(*p)); p->identity = r->identity;p->sequence=r->sequence;
    strcpy(p->record_sha256, r->record_sha256); return 0;
  }
  struct pending_intent *p = find_intent_hash(s, r->intent_sha256);
  if (!p || p->terminal || !same_identity(&p->identity, &r->identity)) { errno = EPROTO; return -1; }
  p->terminal = 1; p->receipt = *r; return 0;
}
static int scan_journal(struct rtem_journal *j, struct scan_state *state) {
  if (!j || j->directory_fd < 0 || verify_directory(j) < 0) return -1;
  struct scan_state local; if (!state) state = &local; memset(state, 0, sizeof(*state));
  int duplicate = openat(j->directory_fd, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW); if (duplicate < 0) return -1;
  DIR *dir = fdopendir(duplicate); if (!dir) { close(duplicate); return -1; }
  struct found { uint64_t sequence; char name[192], sha[65], kind[8]; } found[RTEM_MAX_RECORDS]; size_t count = 0; struct dirent *entry; errno = 0;
  while ((entry = readdir(dir))) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    uint64_t seq; char sha[65], kind[8]; int parsed = parse_name(entry->d_name, &seq, sha, kind);
    if (!parsed || count >= RTEM_MAX_RECORDS) { closedir(dir); errno = parsed ? E2BIG : EPROTO; return -1; }
    found[count].sequence = seq; strcpy(found[count].sha, sha); strcpy(found[count].kind, kind); strcpy(found[count].name, entry->d_name); count++;
  }
  if (errno) { int e = errno; closedir(dir); errno = e; return -1; } closedir(dir);
  for (size_t a = 0; a < count; a++) for (size_t b = a + 1; b < count; b++) if (found[b].sequence < found[a].sequence) {
    struct found tmp = found[a]; found[a] = found[b]; found[b] = tmp;
  }
  char head[65]; strcpy(head, zero_sha256); size_t total = 0;
  for (size_t i = 0; i < count; i++) {
    if (found[i].sequence != i + 1) { errno = EPROTO; return -1; }
    char bytes[RTEM_MAX_RECORD_BYTES], actual[65]; size_t size; struct parsed_record record;
    if (read_record(j, found[i].name, bytes, &size) < 0 || sha256(bytes, size, actual) < 0 || strcmp(actual, found[i].sha) ||
        parse_record(bytes, size, found[i].kind, found[i].sequence, found[i].sha, &record) < 0 ||
        strcmp(record.previous_head_sha256, head) || apply_transition(state, &record) < 0) { errno = EPROTO; return -1; }
    if (total > RTEM_MAX_TOTAL_BYTES - size) { errno = E2BIG; return -1; } total += size; strcpy(head, actual);
  }
  j->record_count = count; j->total_bytes = total; j->next_sequence = count + 1; strcpy(j->head_sha256, head); return verify_directory(j);
}
int rtem_rescan(struct rtem_journal *j) { return scan_journal(j, NULL); }
int rtem_open_journal(int fd, uid_t uid, gid_t gid, struct rtem_journal *j) {
  if (fd < 0 || !j) { errno = EINVAL; return -1; } memset(j, 0, sizeof(*j)); j->directory_fd = -1; struct stat s;
  if (fstat(fd, &s) < 0 || !S_ISDIR(s.st_mode) || s.st_uid != uid || s.st_gid != gid || (s.st_mode & 0777) != 0700) { errno = EPERM; return -1; }
  int retained = fcntl(fd, F_DUPFD_CLOEXEC, 3); if (retained < 0) return -1;
  j->directory_fd = retained; j->device = s.st_dev; j->inode = s.st_ino; j->owner_uid = uid; j->owner_gid = gid; strcpy(j->head_sha256, zero_sha256);
  if (scan_journal(j, NULL) < 0) { close(retained); j->directory_fd = -1; return -1; } return 0;
}
static int test_fault(const char *point) {
#ifdef RECOVERY_TARGET_ENGINE_EXECUTOR_TESTING
  const char *selected = getenv("RTEM_TEST_PUBLISH_FAULT"); if (selected && !strcmp(selected, point)) { errno = EIO; return -1; }
#else
  (void)point;
#endif
  return 0;
}
static int confirm_exact_replay_durable(struct rtem_journal *j,uint64_t sequence,
    const char hash[65],const char *kind) {
  char name[192],bytes[RTEM_MAX_RECORD_BYTES],actual[65];size_t size;
  if(record_name(sequence,hash,kind,name)<0||read_record(j,name,bytes,&size)<0||
      sha256(bytes,size,actual)<0||strcmp(actual,hash)){errno=EPROTO;return-1;}
  int fd=openat(j->directory_fd,name,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);
  if(fd<0)return-1;
  if(test_fault("replay-before-file-fsync")<0||fsync(fd)<0||test_fault("replay-after-file-fsync")<0){int e=errno?errno:EIO;close(fd);errno=e;return-1;}
  close(fd);
  if(test_fault("replay-before-directory-fsync")<0||fsync(j->directory_fd)<0||
      test_fault("replay-after-directory-fsync")<0||verify_directory(j)<0)return-1;
  return 0;
}
static int publish(struct rtem_journal *j, const char *kind, const char *bytes, size_t size, struct rtem_publication *p) {
  if (scan_journal(j, NULL) < 0 || j->record_count >= RTEM_MAX_RECORDS || j->total_bytes > RTEM_MAX_TOTAL_BYTES - size) {
    if (!errno) errno = E2BIG;
    return -1;
  }
  char hash[65], name[192]; if (sha256(bytes, size, hash) < 0 || record_name(j->next_sequence, hash, kind, name) < 0) return -1;
  int existing = openat(j->directory_fd, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
  if (existing >= 0) { close(existing); char actual[RTEM_MAX_RECORD_BYTES]; size_t actual_size;
    if (read_record(j, name, actual, &actual_size) < 0 || actual_size != size || memcmp(actual, bytes, size)) { errno = EEXIST; return -1; }
    if(confirm_exact_replay_durable(j,j->next_sequence,hash,kind)<0)return-1;
    p->sequence = j->next_sequence; p->exact_replay = 1; strcpy(p->record_sha256, hash); return 0; }
  if (errno != ENOENT || test_fault("before-open") < 0) return -1;
  int fd = openat(j->directory_fd, ".", O_TMPFILE | O_RDWR | O_CLOEXEC, 0600); if (fd < 0) return -1;
  ssize_t wrote = write(fd, bytes, size);
  if (wrote != (ssize_t)size || test_fault("after-write") < 0 || fsync(fd) < 0 || test_fault("after-file-fsync") < 0 ||
      linkat(fd, "", j->directory_fd, name, AT_EMPTY_PATH) < 0 || test_fault("after-link") < 0 || fsync(j->directory_fd) < 0 ||
      test_fault("after-directory-fsync") < 0) { int e = errno ? errno : EIO; close(fd); errno = e; return -1; }
  close(fd); p->sequence = j->next_sequence; p->exact_replay = 0; strcpy(p->record_sha256, hash);
  if (scan_journal(j, NULL) < 0 || strcmp(j->head_sha256, hash)) { errno = EIO; return -1; } return 0;
}
int rtem_publish_intent(struct rtem_journal *j, const struct rtem_identity *identity, const char expected[65], struct rtem_publication *p) {
  struct scan_state state;
  if (!j || !valid_identity(identity) || !lower_hex(expected, 64) || !p || scan_journal(j, &state) < 0) { errno = ESTALE; return -1; }
  struct pending_intent *existing = find_intent_command(&state, identity->command_sha256);
  if (existing) { if (!same_identity(&existing->identity, identity)) { errno = EEXIST; return -1; }
    if(confirm_exact_replay_durable(j,existing->sequence,existing->record_sha256,"INTENT")<0)return-1;
    p->exact_replay = 1; strcpy(p->record_sha256, existing->record_sha256); p->sequence = existing->sequence; return 0; }
  if (strcmp(expected, j->head_sha256)) { errno = ESTALE; return -1; }
  char bytes[RTEM_MAX_RECORD_BYTES]; int n = snprintf(bytes, sizeof(bytes),
    "format=darshan-recovery-target-materialization-v2\nkind=INTENT\nsequence=%020llu\noperation=%s\noperation_id=%s\ntarget_handle=%s\ngeneration=%020llu\nrole=%s\nresource_handle=%s\nprofile_sha256=%s\nadmission_sha256=%s\ncommand_sha256=%s\ncommand_nonce=%s\nprevious_head_sha256=%s\n",
    (unsigned long long)j->next_sequence, operation_name(identity->operation), identity->operation_id, identity->target_handle,
    (unsigned long long)identity->generation, role_name(identity->role), identity->resource_handle, identity->profile_sha256,
    identity->admission_sha256, identity->command_sha256, identity->command_nonce, j->head_sha256);
  if (n <= 0 || (size_t)n >= sizeof(bytes)) { errno = E2BIG; return -1; } return publish(j, "INTENT", bytes, (size_t)n, p);
}
static int receipt_matches(const struct parsed_record *r, const char observation[65], const struct rtem_actual_resource *a, int complete) {
  return r->authoritative_complete == !!complete && !strcmp(r->observation_sha256, observation) && same_actual(&r->actual, a);
}
int rtem_publish_receipt(struct rtem_journal *j, const struct rtem_identity *identity, const char intent[65],
    const char observation[65], const struct rtem_actual_resource *actual, int complete, struct rtem_publication *p) {
  struct scan_state state;
  if (!j || !valid_identity(identity) || !lower_hex(intent, 64) || !lower_hex(observation, 64) || !actual || !p || scan_journal(j, &state) < 0) {
    errno = EINVAL; return -1;
  }
  int valid_actual = actual->observed && strict_resource_id(actual->resource_id) &&
    (identity->role == RTEM_ROLE_NETWORK ? !actual->image_id[0] : strict_image_id(actual->image_id)) &&
    lower_hex(actual->image_config_sha256, 64) && lower_hex(actual->effective_configuration_sha256, 64) &&
    lower_hex(actual->owner_labels_sha256, 64) && lower_hex(actual->consumer_set_sha256, 64) && lower_hex(actual->daemon_identity_sha256, 64);
  if ((complete && !valid_actual) || (!complete && actual->observed)) { errno = ENODATA; return -1; }
  struct pending_intent *pending = find_intent_hash(&state, intent);
  if (!pending || !same_identity(&pending->identity, identity)) { errno = ENOENT; return -1; }
  if (pending->terminal) { if (!receipt_matches(&pending->receipt, observation, actual, complete)) { errno = EEXIST; return -1; }
    if(confirm_exact_replay_durable(j,pending->receipt.sequence,pending->receipt.record_sha256,"RECEIPT")<0)return-1;
    p->exact_replay = 1; p->sequence = pending->receipt.sequence; strcpy(p->record_sha256, pending->receipt.record_sha256); return 0; }
  const char *resource = complete ? actual->resource_id : "null", *image = complete && actual->image_id[0] ? actual->image_id : "null";
  const char *image_config = complete ? actual->image_config_sha256 : "null", *config = complete ? actual->effective_configuration_sha256 : "null";
  const char *labels = complete ? actual->owner_labels_sha256 : "null", *consumers = complete ? actual->consumer_set_sha256 : "null";
  const char *daemon = complete ? actual->daemon_identity_sha256 : "null"; char bytes[RTEM_MAX_RECORD_BYTES];
  int n = snprintf(bytes, sizeof(bytes),
    "format=darshan-recovery-target-materialization-v2\nkind=RECEIPT\nsequence=%020llu\noperation=%s\noperation_id=%s\ntarget_handle=%s\ngeneration=%020llu\nrole=%s\nresource_handle=%s\nprofile_sha256=%s\nadmission_sha256=%s\ncommand_sha256=%s\ncommand_nonce=%s\nintent_sha256=%s\nobservation_sha256=%s\noutcome=%s\nresource_id=%s\nimage_id=%s\nimage_config_sha256=%s\neffective_configuration_sha256=%s\nowner_labels_sha256=%s\nconsumer_set_sha256=%s\ndaemon_identity_sha256=%s\nprevious_head_sha256=%s\n",
    (unsigned long long)j->next_sequence, operation_name(identity->operation), identity->operation_id, identity->target_handle,
    (unsigned long long)identity->generation, role_name(identity->role), identity->resource_handle, identity->profile_sha256,
    identity->admission_sha256, identity->command_sha256, identity->command_nonce, intent, observation, complete ? "COMPLETE" : "AMBIGUOUS",
    resource, image, image_config, config, labels, consumers, daemon, j->head_sha256);
  if (n <= 0 || (size_t)n >= sizeof(bytes)) { errno = E2BIG; return -1; } return publish(j, "RECEIPT", bytes, (size_t)n, p);
}
int rtem_close_journal(struct rtem_journal *j) {
  if (!j) { errno = EINVAL; return -1; } int result = 0; if (j->directory_fd >= 0) result = close(j->directory_fd);
  memset(j, 0, sizeof(*j)); j->directory_fd = -1; return result;
}
