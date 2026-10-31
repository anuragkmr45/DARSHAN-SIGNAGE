#define _GNU_SOURCE
#include "recovery-target-storage-authority.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/fs.h>
#include <linux/if_alg.h>
#include <linux/magic.h>
#include <linux/openat2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/statvfs.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef XFS_SUPER_MAGIC
#define XFS_SUPER_MAGIC 0x58465342
#endif
#ifndef TARGET_STORAGE_POSTGRES_UID
#define TARGET_STORAGE_POSTGRES_UID 70
#endif
#ifndef TARGET_STORAGE_POSTGRES_GID
#define TARGET_STORAGE_POSTGRES_GID 70
#endif
#ifndef TARGET_STORAGE_MINIO_UID
#define TARGET_STORAGE_MINIO_UID 71
#endif
#ifndef TARGET_STORAGE_MINIO_GID
#define TARGET_STORAGE_MINIO_GID 71
#endif
#define TARGET_STORAGE_ALLOCATION_MODE 0700
#define TARGET_STORAGE_POSTGRES_MODE 0700
#define TARGET_STORAGE_MINIO_MODE 0700

static int lower_hex_string(const char *value, size_t length) {
  if (!value || strlen(value) != length) return 0;
  for (size_t index = 0; index < length; index++)
    if (!((value[index] >= '0' && value[index] <= '9') || (value[index] >= 'a' && value[index] <= 'f'))) return 0;
  return 1;
}

static uid_t authority_uid(void) {
#ifdef TARGET_STORAGE_AUTHORITY_TESTING
  return geteuid();
#else
  return 0;
#endif
}

#ifdef TARGET_STORAGE_AUTHORITY_TESTING
static int test_failure(const char *point, int error_number) {
  const char *selected = getenv("TARGET_STORAGE_AUTHORITY_TEST_FAILURE");
  if (selected && strcmp(selected, point) == 0) { errno = error_number; return 1; }
  return 0;
}
#else
static int test_failure(const char *point, int error_number) { (void)point; (void)error_number; return 0; }
#endif

static int durable_sync(int fd, const char *point) {
  if (test_failure(point, EIO)) return -1;
  return fsync(fd);
}

static int sha256_bytes(const void *bytes, size_t size, char output[65]) {
  int algorithm = socket(AF_ALG, SOCK_SEQPACKET | SOCK_CLOEXEC, 0); if (algorithm < 0) return -1;
  struct sockaddr_alg address = { .salg_family = AF_ALG, .salg_type = "hash", .salg_name = "sha256" };
  if (bind(algorithm, (struct sockaddr *)&address, sizeof(address)) < 0) { int saved = errno; close(algorithm); errno = saved; return -1; }
  int operation = accept4(algorithm, NULL, NULL, SOCK_CLOEXEC); close(algorithm); if (operation < 0) return -1;
  const unsigned char *cursor = bytes; size_t offset = 0;
  while (offset < size) {
    ssize_t count = write(operation, cursor + offset, size - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) { int saved = errno ? errno : EIO; close(operation); errno = saved; return -1; }
    offset += (size_t)count;
  }
  unsigned char digest[32]; size_t received = 0;
  while (received < sizeof(digest)) {
    ssize_t count = read(operation, digest + received, sizeof(digest) - received);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) { int saved = errno ? errno : EIO; close(operation); errno = saved; return -1; }
    received += (size_t)count;
  }
  close(operation); static const char hex[] = "0123456789abcdef";
  for (size_t index = 0; index < sizeof(digest); index++) {
    output[index * 2] = hex[digest[index] >> 4]; output[index * 2 + 1] = hex[digest[index] & 15u];
  }
  output[64] = '\0'; return 0;
}

int tsa_checked_capacity(uint64_t f_bavail, uint64_t f_frsize, uint64_t f_favail,
    uint64_t outstanding_bytes, uint64_t outstanding_inodes,
    uint64_t required_bytes, uint64_t required_inodes, struct tsa_capacity *result) {
  if (!result || (f_frsize != 0 && f_bavail > UINT64_MAX / f_frsize)) { errno = EOVERFLOW; return -1; }
  uint64_t available_bytes = f_bavail * f_frsize;
  result->available_bytes = available_bytes; result->available_inodes = f_favail;
  result->outstanding_bytes = outstanding_bytes; result->outstanding_inodes = outstanding_inodes;
  result->remaining_bytes = available_bytes >= outstanding_bytes ? available_bytes - outstanding_bytes : 0;
  result->remaining_inodes = f_favail >= outstanding_inodes ? f_favail - outstanding_inodes : 0;
  result->admitted = result->remaining_bytes >= required_bytes && result->remaining_inodes >= required_inodes;
  return 0;
}

int tsa_random_nonce(char output[TSA_NONCE_HEX_LENGTH + 1]) {
  unsigned char bytes[32]; ssize_t count;
  if (!output) { errno = EINVAL; return -1; }
  do { count = getrandom(bytes, sizeof(bytes), 0); } while (count < 0 && errno == EINTR);
  if (count != (ssize_t)sizeof(bytes)) return -1;
  static const char hex[] = "0123456789abcdef";
  for (size_t index = 0; index < sizeof(bytes); index++) {
    output[index * 2] = hex[bytes[index] >> 4]; output[index * 2 + 1] = hex[bytes[index] & 15u];
  }
  output[64] = '\0'; return 0;
}

int tsa_allocation_basename(const char target_set_sha256[65], const char nonce[65], char *output, size_t output_size) {
  if (!lower_hex_string(target_set_sha256, 64) || !lower_hex_string(nonce, 64) || !output || output_size < 133) {
    errno = EINVAL; return -1;
  }
  int count = snprintf(output, output_size, "t-%s-%s", target_set_sha256, nonce);
  if (count != 131) { errno = EINVAL; return -1; }
  return 0;
}

int tsa_take_ofd_authority(int control_directory_fd) {
  int fd = openat(control_directory_fd, "storage-authority.lock", O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) return -1;
  struct stat state;
  if (fstat(fd, &state) < 0 || !S_ISREG(state.st_mode) || state.st_nlink != 1 || (state.st_mode & 0777) != 0600 ||
      state.st_uid != authority_uid()) { int saved = errno ? errno : EPERM; close(fd); errno = saved; return -1; }
  struct flock lock = { .l_type = F_WRLCK, .l_whence = SEEK_SET, .l_start = 0, .l_len = 0 };
  if (fcntl(fd, F_OFD_SETLK, &lock) < 0) { int saved = errno; close(fd); errno = saved; return -1; }
  return fd;
}

int tsa_validate_enrolled_root(int root_fd, int allow_test_directory_fixture) {
  struct stat state; struct statfs filesystem; struct statvfs capacity;
  if (fstat(root_fd, &state) < 0 || !S_ISDIR(state.st_mode) || fstatfs(root_fd, &filesystem) < 0 || fstatvfs(root_fd, &capacity) < 0)
    return -1;
#ifdef TARGET_STORAGE_AUTHORITY_TESTING
  if (allow_test_directory_fixture == 1) return 0;
#else
  if (allow_test_directory_fixture != 0) { errno = EPERM; return -1; }
#endif
  if (state.st_uid != 0 || (state.st_mode & 0777) != 0700 || (capacity.f_flag & ST_RDONLY) != 0 ||
      (filesystem.f_type != EXT4_SUPER_MAGIC && filesystem.f_type != XFS_SUPER_MAGIC)) { errno = EPERM; return -1; }
  /* Portable userspace cannot prove a stable filesystem UUID plus enforced project quota from these descriptors. */
  errno = ENOTSUP; return -1;
}

static int ensure_directory(int parent_fd, const char *name, uid_t uid, gid_t gid, mode_t mode) {
  if (mkdirat(parent_fd, name, mode) < 0) return -1;
  int fd = openat(parent_fd, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return -1;
  int result = fchown(fd, uid, gid) < 0 || fchmod(fd, mode) < 0 || durable_sync(fd, "component-fsync") < 0 ? -1 : 0;
  int saved = errno; close(fd); errno = saved; return result;
}

static int descriptor_identity(int fd, struct stat *state, uint64_t *mount_id) {
  struct statx extended;
  if (fstat(fd, state) < 0 || syscall(SYS_statx, fd, "", AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW,
      STATX_TYPE | STATX_MODE | STATX_INO | STATX_MNT_ID, &extended) < 0) return -1;
  *mount_id = extended.stx_mnt_id; return 0;
}

static int independent_directory(int retained_fd) {
  struct stat retained, opened; int fd = openat(retained_fd, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0 || fstat(retained_fd, &retained) < 0 || fstat(fd, &opened) < 0 ||
      retained.st_dev != opened.st_dev || retained.st_ino != opened.st_ino) { if (fd >= 0) close(fd); errno = ESTALE; return -1; }
  return fd;
}

static int scan_empty(int fd, dev_t device, uint64_t mount_id) {
  struct stat state; uint64_t observed_mount; if (descriptor_identity(fd, &state, &observed_mount) < 0 ||
      state.st_dev != device || observed_mount != mount_id) { errno = EXDEV; return -1; }
  int scan = independent_directory(fd); if (scan < 0) return -1; DIR *directory = fdopendir(scan);
  if (!directory) { close(scan); return -1; } struct dirent *entry; errno = 0;
  while ((entry = readdir(directory)) != NULL) if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, "..")) {
    closedir(directory); errno = EPERM; return -1;
  }
  int saved = errno; closedir(directory); if (saved) { errno = saved; return -1; } return 0;
}

static int marker_bytes(const char target[65], const char nonce[65], char *output, size_t capacity) {
  char basename[133]; if (tsa_allocation_basename(target, nonce, basename, sizeof(basename)) < 0) return -1;
  int length = snprintf(output, capacity, "format=darshan-target-allocation-marker-v1\ntarget_set_sha256=%s\nnonce=%s\nbasename=%s\n",
    target, nonce, basename); return length > 0 && (size_t)length < capacity ? length : -1;
}

int tsa_create_allocation_tree(int allocation_fd, const char target[65], const char nonce[65]) {
  char marker_record[512]; int marker_length = marker_bytes(target, nonce, marker_record, sizeof(marker_record));
  if (marker_length < 0 || fchmod(allocation_fd, 0700) < 0 || fchown(allocation_fd, authority_uid(), getegid()) < 0 ||
      ensure_directory(allocation_fd, "postgres", TARGET_STORAGE_POSTGRES_UID, TARGET_STORAGE_POSTGRES_GID, 0700) < 0 ||
      ensure_directory(allocation_fd, "minio", TARGET_STORAGE_MINIO_UID, TARGET_STORAGE_MINIO_GID, 0700) < 0) return -1;
  int marker = openat(allocation_fd, ".darshan-target-allocation-v1", O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (marker < 0) return -1;
  ssize_t written = test_failure("marker-write-enospc", ENOSPC) ? -1 : write(marker, marker_record, (size_t)marker_length);
  int result = written == marker_length && durable_sync(marker, "marker-fsync") == 0 && durable_sync(allocation_fd, "allocation-fsync") == 0 ? 0 : -1;
  int saved = errno; close(marker); errno = saved; return result;
}

static int validate_marker(int allocation_fd, const char target[65], const char nonce[65], char digest[65]) {
  char expected[512], actual[513]; int length = marker_bytes(target, nonce, expected, sizeof(expected));
  int fd = openat(allocation_fd, ".darshan-target-allocation-v1", O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
  struct stat before, after; if (length < 0 || fd < 0 || fstat(fd, &before) < 0 || !S_ISREG(before.st_mode) || before.st_nlink != 1 ||
      before.st_uid != authority_uid() || before.st_gid != getegid() || (before.st_mode & 0777) != 0600 || before.st_size != length) {
    if (fd >= 0) close(fd);
    errno = EPERM; return -1;
  }
  ssize_t count = read(fd, actual, sizeof(actual)); char extra; ssize_t more = read(fd, &extra, 1);
  if (count != length || more != 0 || memchr(actual, '\0', (size_t)count) || memcmp(actual, expected, (size_t)length) ||
      fstat(fd, &after) < 0 || before.st_dev != after.st_dev || before.st_ino != after.st_ino || before.st_size != after.st_size ||
      before.st_mtim.tv_sec != after.st_mtim.tv_sec || before.st_mtim.tv_nsec != after.st_mtim.tv_nsec) {
    close(fd); errno = EINVAL; return -1;
  }
  close(fd); return sha256_bytes(actual, (size_t)length, digest);
}

int tsa_validate_allocation_tree(int allocation_fd, const char target[65], const char nonce[65], char marker_digest[65]) {
  struct stat root; uint64_t mount_id; if (descriptor_identity(allocation_fd, &root, &mount_id) < 0 || !S_ISDIR(root.st_mode) ||
      root.st_uid != authority_uid() || root.st_gid != getegid() || (root.st_mode & 0777) != 0700 ||
      validate_marker(allocation_fd, target, nonce, marker_digest) < 0) { errno = EPERM; return -1; }
  const char *names[] = { "postgres", "minio" }; uid_t uids[] = { TARGET_STORAGE_POSTGRES_UID, TARGET_STORAGE_MINIO_UID };
  gid_t gids[] = { TARGET_STORAGE_POSTGRES_GID, TARGET_STORAGE_MINIO_GID };
  for (size_t index = 0; index < 2; index++) {
    int child = openat(allocation_fd, names[index], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW); struct stat state; uint64_t child_mount;
    if (child < 0 || descriptor_identity(child, &state, &child_mount) < 0 || state.st_uid != uids[index] || state.st_gid != gids[index] ||
        (state.st_mode & 0777) != 0700 || state.st_dev != root.st_dev || child_mount != mount_id || scan_empty(child, root.st_dev, mount_id) < 0) {
      if (child >= 0) close(child);
      errno = EPERM; return -1;
    }
    close(child);
  }
  int scan = independent_directory(allocation_fd); if (scan < 0) return -1; DIR *directory = fdopendir(scan); if (!directory) { close(scan); return -1; }
  unsigned objects = 0; struct dirent *entry; errno = 0;
  while ((entry = readdir(directory)) != NULL) { if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (strcmp(entry->d_name, ".darshan-target-allocation-v1") && strcmp(entry->d_name, "postgres") && strcmp(entry->d_name, "minio")) { closedir(directory); errno = EPERM; return -1; } objects++; }
  int saved = errno; closedir(directory); if (saved || objects != 3) { errno = saved ? saved : EPERM; return -1; } return 0;
}

static const char *phase_name(enum tsa_ledger_phase value) { return value == TSA_LEDGER_INTENT ? "INTENT" : value == TSA_LEDGER_RECEIPT ? "RECEIPT" : NULL; }
static const char *action_name(enum tsa_ledger_action value) { return value == TSA_ACTION_ALLOCATE ? "ALLOCATE" : value == TSA_ACTION_RETIRE_INTENT ? "RETIRE_INTENT" : NULL; }
static const char *stage_name(enum tsa_ledger_stage value) { return value == TSA_STAGE_ALLOCATING ? "ALLOCATING" : value == TSA_STAGE_FILESYSTEM_ALLOCATED ? "FILESYSTEM_ALLOCATED" : value == TSA_STAGE_QUARANTINED ? "QUARANTINED" : NULL; }
static int compare_identity_binding(const struct tsa_ledger_record *left,const struct tsa_ledger_record *right) {
  return strcmp(left->installed_identity_sha256,right->installed_identity_sha256)||strcmp(left->site_identity_sha256,right->site_identity_sha256)||
    strcmp(left->host_identity_sha256,right->host_identity_sha256)||strcmp(left->policy_sha256,right->policy_sha256)||strcmp(left->profile_sha256,right->profile_sha256)||
    strcmp(left->specification_sha256,right->specification_sha256)||strcmp(left->evidence_context_sha256,right->evidence_context_sha256)||
    strcmp(left->target_set_sha256,right->target_set_sha256)||strcmp(left->nonce,right->nonce)||strcmp(left->basename,right->basename)||
    strcmp(left->marker_sha256,right->marker_sha256)||strcmp(left->reservation_id_sha256,right->reservation_id_sha256)||
    left->reservation_bytes!=right->reservation_bytes||left->reservation_inodes!=right->reservation_inodes||strcmp(left->request_sha256,right->request_sha256)||
    strcmp(left->body_sha256,right->body_sha256)||strcmp(left->authorization_sha256,right->authorization_sha256)||
    left->source_dev!=right->source_dev||left->source_ino!=right->source_ino||left->source_mount_id!=right->source_mount_id||
    left->active_dev!=right->active_dev||left->active_ino!=right->active_ino||left->active_mount_id!=right->active_mount_id||
    left->quarantine_dev!=right->quarantine_dev||left->quarantine_ino!=right->quarantine_ino||left->quarantine_mount_id!=right->quarantine_mount_id;
}
static int encode_record(const struct tsa_ledger_record *record, char *output, size_t capacity) {
  const char *phase = phase_name(record->phase), *action = action_name(record->action), *stage = stage_name(record->stage);
  char expected_basename[133];
  if (!record || !phase || !action || !stage || record->sequence >= TSA_MAX_LEDGER_ENTRIES ||
      !lower_hex_string(record->installed_identity_sha256,64)||!lower_hex_string(record->site_identity_sha256,64)||!lower_hex_string(record->host_identity_sha256,64)||
      !lower_hex_string(record->policy_sha256,64)||!lower_hex_string(record->profile_sha256,64)||!lower_hex_string(record->specification_sha256,64)||
      !lower_hex_string(record->evidence_context_sha256,64)||!lower_hex_string(record->target_set_sha256,64)||!lower_hex_string(record->nonce,64)||
      !lower_hex_string(record->marker_sha256,64)||!lower_hex_string(record->previous_sha256,64)||!lower_hex_string(record->reservation_id_sha256,64)||
      !lower_hex_string(record->request_sha256,64)||!lower_hex_string(record->body_sha256,64)||!lower_hex_string(record->authorization_sha256,64)||
      tsa_allocation_basename(record->target_set_sha256,record->nonce,expected_basename,sizeof(expected_basename))<0||strcmp(record->basename,expected_basename)) { errno=EINVAL; return -1; }
  int length=snprintf(output,capacity,"format=darshan-target-storage-ledger-v1\nsequence=%020llu\nphase=%s\naction=%s\nstage=%s\ninstalled_identity_sha256=%s\nsite_identity_sha256=%s\nhost_identity_sha256=%s\npolicy_sha256=%s\nprofile_sha256=%s\nspecification_sha256=%s\nevidence_context_sha256=%s\ntarget_set_sha256=%s\nnonce=%s\nbasename=%s\nmarker_sha256=%s\nprevious_sha256=%s\nreservation_id_sha256=%s\nreservation_bytes=%020llu\nreservation_inodes=%020llu\nrequest_sha256=%s\nbody_sha256=%s\nauthorization_sha256=%s\nsource_dev=%020llu\nsource_ino=%020llu\nsource_mount_id=%020llu\nactive_dev=%020llu\nactive_ino=%020llu\nactive_mount_id=%020llu\nquarantine_dev=%020llu\nquarantine_ino=%020llu\nquarantine_mount_id=%020llu\ndestination_dev=%020llu\ndestination_ino=%020llu\ndestination_mount_id=%020llu\n",
    (unsigned long long)record->sequence,phase,action,stage,record->installed_identity_sha256,record->site_identity_sha256,record->host_identity_sha256,
    record->policy_sha256,record->profile_sha256,record->specification_sha256,record->evidence_context_sha256,record->target_set_sha256,record->nonce,
    record->basename,record->marker_sha256,record->previous_sha256,record->reservation_id_sha256,(unsigned long long)record->reservation_bytes,
    (unsigned long long)record->reservation_inodes,record->request_sha256,record->body_sha256,record->authorization_sha256,
    (unsigned long long)record->source_dev,(unsigned long long)record->source_ino,(unsigned long long)record->source_mount_id,
    (unsigned long long)record->active_dev,(unsigned long long)record->active_ino,(unsigned long long)record->active_mount_id,
    (unsigned long long)record->quarantine_dev,(unsigned long long)record->quarantine_ino,(unsigned long long)record->quarantine_mount_id,
    (unsigned long long)record->destination_dev,(unsigned long long)record->destination_ino,(unsigned long long)record->destination_mount_id);
  return length>0 && (size_t)length<capacity ? length : -1;
}

static int read_exact_file(int directory_fd,const char *name,char *bytes,size_t capacity,struct stat *identity) {
  int fd=openat(directory_fd,name,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK); struct stat before,after; if(fd<0||fstat(fd,&before)<0||!S_ISREG(before.st_mode)||before.st_nlink!=1||before.st_uid!=authority_uid()||before.st_gid!=getegid()||(before.st_mode&0777)!=0600||before.st_size<2||(size_t)before.st_size>=capacity){if(fd>=0)close(fd);errno=EPERM;return -1;}
  ssize_t total=0; while(total<=before.st_size){ssize_t n=read(fd,bytes+total,(size_t)before.st_size+1-(size_t)total);if(n<0&&errno==EINTR)continue;if(n<0){close(fd);return -1;}if(n==0)break;total+=n;}
  if(total!=before.st_size||memchr(bytes,'\0',(size_t)total)||fstat(fd,&after)<0||before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||before.st_size!=after.st_size||before.st_mtim.tv_sec!=after.st_mtim.tv_sec||before.st_mtim.tv_nsec!=after.st_mtim.tv_nsec){close(fd);errno=ESTALE;return -1;}bytes[total]='\0';close(fd);*identity=before;return (int)total;
}

static int exact_existing(int ledger_fd,const char *prefix,const char *final,const char *body,size_t size) {
  int scan=independent_directory(ledger_fd); if(scan<0)return -1;DIR *dir=fdopendir(scan);if(!dir){close(scan);return -1;}struct dirent *entry;int found=0,pending=0;errno=0;
  while((entry=readdir(dir))){if(!strncmp(entry->d_name,".pending-",9)){pending=1;continue;}if(!strncmp(entry->d_name,prefix,strlen(prefix))){if(strcmp(entry->d_name,final)){closedir(dir);errno=EEXIST;return -1;}found=1;}}
  int saved=errno;closedir(dir);if(saved){errno=saved;return -1;}if(found){char existing[TSA_MAX_LEDGER_ENTRY_BYTES];struct stat state;int length=read_exact_file(ledger_fd,final,existing,sizeof(existing),&state);if(length!=(int)size||memcmp(existing,body,size)){errno=EEXIST;return -1;}return 1;}if(pending){errno=EAGAIN;return -1;}return 0;
}

static int valid_transition(size_t index,const struct tsa_ledger_record *prior,const struct tsa_ledger_record *current);

int tsa_append_ledger_record(int ledger_fd,const struct tsa_ledger_record *record,char digest[65]) {
  char body[TSA_MAX_LEDGER_ENTRY_BYTES];int length=encode_record(record,body,sizeof(body));if(length<0||sha256_bytes(body,(size_t)length,digest)<0)return -1;
  const char *phase=record->phase==TSA_LEDGER_INTENT?"intent":"receipt";char prefix[64],pending[192],final[192];snprintf(prefix,sizeof(prefix),"%020llu-%s-",(unsigned long long)record->sequence,phase);
  snprintf(pending,sizeof(pending),".pending-%020llu-%s-%s",(unsigned long long)record->sequence,phase,digest);snprintf(final,sizeof(final),"%s%s.json",prefix,digest);
  int existing=exact_existing(ledger_fd,prefix,final,body,(size_t)length);if(existing!=0)return existing;
  char head[65];size_t entries;struct tsa_ledger_record prior;
  if(tsa_validate_ledger_chain(ledger_fd,head,&entries,&prior)<0||strcmp(record->previous_sha256,head)||!valid_transition(entries,&prior,record)) { errno=EINVAL;return -1; }
  int fd=openat(ledger_fd,pending,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600);if(fd<0)return -1;size_t offset=0;while(offset<(size_t)length){ssize_t n=test_failure("ledger-write-enospc",ENOSPC)?-1:write(fd,body+offset,(size_t)length-offset);if(n<0&&errno==EINTR)continue;if(n<=0){close(fd);return -1;}offset+=(size_t)n;}
  if(durable_sync(fd,"ledger-record-fsync")<0){int saved=errno;close(fd);errno=saved;return -1;}if(close(fd)<0)return -1;if(test_failure("ledger-rename",EIO)||syscall(SYS_renameat2,ledger_fd,pending,ledger_fd,final,RENAME_NOREPLACE)<0)return -1;return durable_sync(ledger_fd,"ledger-directory-fsync");
}

static int compare_names(const void *left, const void *right) {
  return strcmp(*(const char *const *)left, *(const char *const *)right);
}

static int parse_ledger_filename(const char *name,uint64_t *sequence,enum tsa_ledger_phase *phase,char digest[65]) {
  size_t length=strlen(name);const char *phase_text;size_t phase_length;
  if(length==97){phase_text="intent";phase_length=6;*phase=TSA_LEDGER_INTENT;}
  else if(length==98){phase_text="receipt";phase_length=7;*phase=TSA_LEDGER_RECEIPT;}else{errno=EINVAL;return -1;}
  uint64_t value=0;for(size_t index=0;index<20;index++){unsigned digit=(unsigned)(name[index]-'0');if(digit>9||value>(UINT64_MAX-digit)/10){errno=EINVAL;return -1;}value=value*10+digit;}
  if(name[20]!='-'||memcmp(name+21,phase_text,phase_length)||name[21+phase_length]!='-'){errno=EINVAL;return -1;}
  memcpy(digest,name+22+phase_length,64);digest[64]='\0';if(!lower_hex_string(digest,64)||memcmp(name+86+phase_length,".json",5)){errno=EINVAL;return -1;}
  char canonical[192];int count=snprintf(canonical,sizeof(canonical),"%020llu-%s-%s.json",(unsigned long long)value,phase_text,digest);
  if(count!=(int)length||memcmp(canonical,name,length+1)){errno=EINVAL;return -1;}*sequence=value;return 0;
}

static int valid_transition(size_t index,const struct tsa_ledger_record *prior,const struct tsa_ledger_record *current) {
  if(index==0)return current->sequence==0&&current->phase==TSA_LEDGER_INTENT&&current->action==TSA_ACTION_ALLOCATE&&current->stage==TSA_STAGE_ALLOCATING&&
    current->destination_dev==0&&current->destination_ino==0&&current->destination_mount_id==0;
  if(compare_identity_binding(prior,current))return 0;
  if(current->sequence==prior->sequence&&prior->phase==TSA_LEDGER_INTENT&&current->phase==TSA_LEDGER_RECEIPT&&current->action==prior->action) {
    return (current->action==TSA_ACTION_ALLOCATE&&current->stage==TSA_STAGE_FILESYSTEM_ALLOCATED&&current->destination_dev==0&&current->destination_ino==0&&current->destination_mount_id==0)||
      (current->action==TSA_ACTION_RETIRE_INTENT&&current->stage==TSA_STAGE_QUARANTINED&&current->destination_dev==current->source_dev&&current->destination_ino==current->source_ino&&current->destination_mount_id==current->source_mount_id);
  }
  return current->sequence==prior->sequence+1&&prior->phase==TSA_LEDGER_RECEIPT&&current->phase==TSA_LEDGER_INTENT&&
    current->action==TSA_ACTION_RETIRE_INTENT&&prior->stage==TSA_STAGE_FILESYSTEM_ALLOCATED&&current->stage==TSA_STAGE_FILESYSTEM_ALLOCATED&&
    current->destination_dev==0&&current->destination_ino==0&&current->destination_mount_id==0;
}

static int take_literal(const char **cursor,const char *end,const char *value){size_t size=strlen(value);if((size_t)(end-*cursor)<size||memcmp(*cursor,value,size)){errno=EINVAL;return -1;}*cursor+=size;return 0;}
static int take_hex_line(const char **cursor,const char *end,const char *label,char output[65]){if(take_literal(cursor,end,label)<0||(size_t)(end-*cursor)<65)return -1;memcpy(output,*cursor,64);output[64]='\0';*cursor+=64;if(!lower_hex_string(output,64)||*(*cursor)++!='\n'){errno=EINVAL;return -1;}return 0;}
static int take_u64_line(const char **cursor,const char *end,const char *label,uint64_t *output){if(take_literal(cursor,end,label)<0||(size_t)(end-*cursor)<21)return -1;uint64_t value=0;for(int index=0;index<20;index++){unsigned digit=(unsigned)((*cursor)[index]-'0');if(digit>9||value>(UINT64_MAX-digit)/10){errno=ERANGE;return -1;}value=value*10+digit;}*cursor+=20;if(*(*cursor)++!='\n'){errno=EINVAL;return -1;}*output=value;return 0;}
static int take_enum_line(const char **cursor,const char *end,const char *label,const char *first,const char *second,const char *third,int *value){if(take_literal(cursor,end,label)<0)return -1;const char *newline=memchr(*cursor,'\n',(size_t)(end-*cursor));if(!newline)return -1;size_t length=(size_t)(newline-*cursor);*value=length==strlen(first)&&!memcmp(*cursor,first,length)?1:length==strlen(second)&&!memcmp(*cursor,second,length)?2:third&&length==strlen(third)&&!memcmp(*cursor,third,length)?3:0;if(!*value){errno=EINVAL;return -1;}*cursor=newline+1;return 0;}
static int take_basename_line(const char **cursor,const char *end,char output[133]){if(take_literal(cursor,end,"basename=")<0||(size_t)(end-*cursor)<132)return -1;memcpy(output,*cursor,131);output[131]='\0';*cursor+=131;if(*(*cursor)++!='\n'){errno=EINVAL;return -1;}return 0;}

static int parse_record(const char *bytes,size_t size,struct tsa_ledger_record *r) {
  const char *cursor=bytes,*end=bytes+size;int value;memset(r,0,sizeof(*r));
  if(take_literal(&cursor,end,"format=darshan-target-storage-ledger-v1\n")<0||take_u64_line(&cursor,end,"sequence=",&r->sequence)<0||
    take_enum_line(&cursor,end,"phase=","INTENT","RECEIPT",NULL,&value)<0)return -1;
  r->phase=(enum tsa_ledger_phase)value;
  if(take_enum_line(&cursor,end,"action=","ALLOCATE","RETIRE_INTENT",NULL,&value)<0)return -1;
  r->action=(enum tsa_ledger_action)value;
  if(take_enum_line(&cursor,end,"stage=","ALLOCATING","FILESYSTEM_ALLOCATED","QUARANTINED",&value)<0)return -1;
  r->stage=(enum tsa_ledger_stage)value;
#define HEX_FIELD(label,field) if(take_hex_line(&cursor,end,label,r->field)<0)return -1
#define U64_FIELD(label,field) if(take_u64_line(&cursor,end,label,&r->field)<0)return -1
  HEX_FIELD("installed_identity_sha256=",installed_identity_sha256);HEX_FIELD("site_identity_sha256=",site_identity_sha256);HEX_FIELD("host_identity_sha256=",host_identity_sha256);
  HEX_FIELD("policy_sha256=",policy_sha256);HEX_FIELD("profile_sha256=",profile_sha256);HEX_FIELD("specification_sha256=",specification_sha256);HEX_FIELD("evidence_context_sha256=",evidence_context_sha256);
  HEX_FIELD("target_set_sha256=",target_set_sha256);HEX_FIELD("nonce=",nonce);if(take_basename_line(&cursor,end,r->basename)<0)return -1;HEX_FIELD("marker_sha256=",marker_sha256);HEX_FIELD("previous_sha256=",previous_sha256);
  HEX_FIELD("reservation_id_sha256=",reservation_id_sha256);U64_FIELD("reservation_bytes=",reservation_bytes);U64_FIELD("reservation_inodes=",reservation_inodes);HEX_FIELD("request_sha256=",request_sha256);HEX_FIELD("body_sha256=",body_sha256);HEX_FIELD("authorization_sha256=",authorization_sha256);
  U64_FIELD("source_dev=",source_dev);U64_FIELD("source_ino=",source_ino);U64_FIELD("source_mount_id=",source_mount_id);U64_FIELD("active_dev=",active_dev);U64_FIELD("active_ino=",active_ino);U64_FIELD("active_mount_id=",active_mount_id);U64_FIELD("quarantine_dev=",quarantine_dev);U64_FIELD("quarantine_ino=",quarantine_ino);U64_FIELD("quarantine_mount_id=",quarantine_mount_id);U64_FIELD("destination_dev=",destination_dev);U64_FIELD("destination_ino=",destination_ino);U64_FIELD("destination_mount_id=",destination_mount_id);
#undef HEX_FIELD
#undef U64_FIELD
  if(cursor!=end){errno=EINVAL;return -1;}char canonical[TSA_MAX_LEDGER_ENTRY_BYTES];int length=encode_record(r,canonical,sizeof(canonical));if(length!=(int)size||memcmp(canonical,bytes,size)){errno=EINVAL;return -1;}return 0;
}

int tsa_validate_ledger_chain(int ledger_fd, char head_sha256[65], size_t *entry_count,struct tsa_ledger_record *last) {
  if (!head_sha256 || !entry_count) { errno = EINVAL; return -1; }
  int scan_fd = independent_directory(ledger_fd); if (scan_fd < 0) return -1;
  DIR *directory = fdopendir(scan_fd); if (!directory) { close(scan_fd); return -1; }
  char names[TSA_MAX_LEDGER_ENTRIES][192]; char *order[TSA_MAX_LEDGER_ENTRIES]; size_t count = 0;
  struct dirent *entry; errno = 0;
  while ((entry = readdir(directory)) != NULL) {
    if (entry->d_name[0] == '.' && (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, ".."))) continue;
    if (!strncmp(entry->d_name, ".pending-", 9)) { closedir(directory); errno = EAGAIN; return -1; }
    if (count == TSA_MAX_LEDGER_ENTRIES || strlen(entry->d_name) >= sizeof(names[0])) { closedir(directory); errno = EFBIG; return -1; }
    strcpy(names[count], entry->d_name); order[count] = names[count]; count++;
  }
  int read_error = errno; closedir(directory); if (read_error) { errno = read_error; return -1; }
  qsort(order, count, sizeof(order[0]), compare_names);
  char previous[65]; memset(previous, '0', 64); previous[64] = '\0'; struct tsa_ledger_record prior={0};
  for (size_t index = 0; index < count; index++) {
    uint64_t sequence;enum tsa_ledger_phase filename_phase;char claimed[65];if(parse_ledger_filename(order[index],&sequence,&filename_phase,claimed)<0)return -1;
    char body[TSA_MAX_LEDGER_ENTRY_BYTES];struct stat state;int total=read_exact_file(ledger_fd,order[index],body,sizeof(body),&state);struct tsa_ledger_record current;
    char computed[65];if(total<0)return -1;if(parse_record(body,(size_t)total,&current)<0)return -1;
    if(sha256_bytes(body,(size_t)total,computed)<0||strcmp(computed,claimed)){errno=EBADMSG;return -1;}
    if(current.sequence!=sequence||strcmp(current.previous_sha256,previous)||filename_phase!=current.phase){errno=EILSEQ;return -1;}
    if(!valid_transition(index,&prior,&current)){errno=EDOM;return -1;}memcpy(previous,computed,65);prior=current;
  }
  memcpy(head_sha256, previous, 65); *entry_count = count;if(last){if(count)*last=prior;else memset(last,0,sizeof(*last));}return 0;
}

static int validate_parent(int fd,struct stat *state,uint64_t *mount_id){return descriptor_identity(fd,state,mount_id)<0||!S_ISDIR(state->st_mode)||state->st_uid!=authority_uid()||state->st_gid!=getegid()||(state->st_mode&0777)!=0700?-1:0;}

int tsa_quarantine_from_ledger(int ledger_fd,int active_fd,int quarantine_fd,const char target[65],const char nonce[65],char receipt_digest[65]) {
  char head[65],name[133],marker[65];size_t count;struct tsa_ledger_record last;struct stat active,quarantine,source,destination;uint64_t active_mount,quarantine_mount,source_mount;
  if(tsa_validate_ledger_chain(ledger_fd,head,&count,&last)<0||count==0||strcmp(last.target_set_sha256,target)||strcmp(last.nonce,nonce)||
    tsa_allocation_basename(target,nonce,name,sizeof(name))<0||validate_parent(active_fd,&active,&active_mount)<0||validate_parent(quarantine_fd,&quarantine,&quarantine_mount)<0||active.st_dev!=quarantine.st_dev||
    active.st_dev!=last.active_dev||active.st_ino!=last.active_ino||active_mount!=last.active_mount_id||quarantine.st_dev!=last.quarantine_dev||quarantine.st_ino!=last.quarantine_ino||quarantine_mount!=last.quarantine_mount_id){errno=EPERM;return -1;}
  if(last.phase==TSA_LEDGER_RECEIPT&&last.action==TSA_ACTION_RETIRE_INTENT&&last.stage==TSA_STAGE_QUARANTINED) {
    int replay_fd=openat(quarantine_fd,name,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);struct stat absent;char replay_marker[65];
    uint64_t replay_mount;if(replay_fd<0||descriptor_identity(replay_fd,&destination,&replay_mount)<0||destination.st_dev!=last.destination_dev||destination.st_ino!=last.destination_ino||replay_mount!=last.destination_mount_id||
      tsa_validate_allocation_tree(replay_fd,target,nonce,replay_marker)<0||strcmp(replay_marker,last.marker_sha256)||
      fstatat(active_fd,name,&absent,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT){if(replay_fd>=0)close(replay_fd);errno=ESTALE;return -1;}
    close(replay_fd);memcpy(receipt_digest,head,65);return 1;
  }
  if(last.phase!=TSA_LEDGER_RECEIPT||last.action!=TSA_ACTION_ALLOCATE||last.stage!=TSA_STAGE_FILESYSTEM_ALLOCATED){errno=EPERM;return -1;}
  int source_fd=openat(active_fd,name,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(source_fd<0||descriptor_identity(source_fd,&source,&source_mount)<0||tsa_validate_allocation_tree(source_fd,target,nonce,marker)<0||strcmp(marker,last.marker_sha256)||source.st_dev!=last.source_dev||source.st_ino!=last.source_ino||source_mount!=last.source_mount_id||active.st_dev!=last.active_dev||active.st_ino!=last.active_ino||active_mount!=last.active_mount_id||quarantine.st_dev!=last.quarantine_dev||quarantine.st_ino!=last.quarantine_ino||quarantine_mount!=last.quarantine_mount_id){if(source_fd>=0)close(source_fd);errno=EPERM;return -1;}close(source_fd);
  struct tsa_ledger_record intent=last;intent.sequence=last.sequence+1;intent.phase=TSA_LEDGER_INTENT;intent.action=TSA_ACTION_RETIRE_INTENT;intent.stage=TSA_STAGE_FILESYSTEM_ALLOCATED;memcpy(intent.previous_sha256,head,65);char intent_digest[65];int appended=tsa_append_ledger_record(ledger_fd,&intent,intent_digest);if(appended<0)return -1;
  if(test_failure("quarantine-rename",EIO)||syscall(SYS_renameat2,active_fd,name,quarantine_fd,name,RENAME_NOREPLACE)<0)return -1;
  int destination_fd=openat(quarantine_fd,name,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);struct stat absent;char destination_marker[65];uint64_t destination_mount;
  if(destination_fd<0||descriptor_identity(destination_fd,&destination,&destination_mount)<0||destination.st_dev!=source.st_dev||destination.st_ino!=source.st_ino||destination_mount!=source_mount||tsa_validate_allocation_tree(destination_fd,target,nonce,destination_marker)<0||strcmp(destination_marker,marker)||fstatat(active_fd,name,&absent,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT){if(destination_fd>=0)close(destination_fd);errno=ESTALE;return -1;}close(destination_fd);
  if(durable_sync(active_fd,"active-parent-fsync")<0||durable_sync(quarantine_fd,"quarantine-parent-fsync")<0)return -1;
  struct tsa_ledger_record receipt=intent;receipt.phase=TSA_LEDGER_RECEIPT;receipt.stage=TSA_STAGE_QUARANTINED;memcpy(receipt.previous_sha256,intent_digest,65);
  receipt.destination_dev=destination.st_dev;receipt.destination_ino=destination.st_ino;receipt.destination_mount_id=destination_mount;
  return tsa_append_ledger_record(ledger_fd,&receipt,receipt_digest)<0?-1:0;
}
