#define _GNU_SOURCE
#include "recovery-target-storage-authority.h"
#include <errno.h>
#include <fcntl.h>
#include <linux/stat.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/un.h>
#include <unistd.h>

static int check(int condition, const char *label, unsigned *passed) {
  if (!condition) { fprintf(stderr, "failed: %s errno=%d\n", label, errno); return -1; }
  (*passed)++; return 0;
}

static int directory(int parent, const char *name) {
  if (mkdirat(parent, name, 0700) < 0) return -1;
  return openat(parent, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
}

static int identity(int fd, uint64_t *device, uint64_t *inode, uint64_t *mount_id) {
  struct stat state; struct statx extended;
  if (fstat(fd, &state) < 0 || statx(fd, "", AT_EMPTY_PATH, STATX_INO | STATX_MNT_ID, &extended) < 0) return -1;
  *device = state.st_dev; *inode = state.st_ino; *mount_id = extended.stx_mnt_id; return 0;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int root = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW); if (root < 0) return 2;
  unsigned passed = 0; struct tsa_capacity capacity;
  if (check(tsa_checked_capacity(100, 4096, 20, 3000, 7, 400000, 13, &capacity) == 0 &&
      capacity.remaining_bytes == 406600 && capacity.remaining_inodes == 13 && capacity.admitted, "capacity", &passed) < 0) return 1;
  if (check(tsa_checked_capacity(UINT64_MAX, 2, 0, 0, 0, 0, 0, &capacity) < 0 && errno == EOVERFLOW,
      "capacity-overflow", &passed) < 0) return 1;
  char nonce[65], basename[133];
  const char *target_set = "1111111111111111111111111111111111111111111111111111111111111111";
  if (check(tsa_random_nonce(nonce) == 0 && tsa_allocation_basename(
      "1111111111111111111111111111111111111111111111111111111111111111", nonce, basename, sizeof(basename)) == 0 &&
      strlen(basename) == 131, "nonce-basename", &passed) < 0) return 1;
  if (check(tsa_validate_enrolled_root(root, 1) == 0, "compile-gated-directory-fixture", &passed) < 0) return 1;

  int allocation = directory(root, "allocation-good");
  char marker_digest[65];
  if (check(allocation >= 0 && tsa_create_allocation_tree(allocation, target_set, nonce) == 0 &&
      tsa_validate_allocation_tree(allocation, target_set, nonce, marker_digest) == 0 &&
      tsa_validate_allocation_tree(allocation, target_set, nonce, marker_digest) == 0, "exact-tree-repeatable", &passed) < 0) return 1;
  if(check(tsa_validate_allocation_tree(allocation,"2222222222222222222222222222222222222222222222222222222222222222",nonce,marker_digest)<0,
    "marker-binding-mismatch",&passed)<0)return 1;
  int unsafe = directory(root, "allocation-unsafe");
  if (unsafe < 0 || tsa_create_allocation_tree(unsafe, target_set, nonce) < 0) return 1;
  if (symlinkat("/etc/passwd", unsafe, "unexpected") < 0) return 1;
  if (check(tsa_validate_allocation_tree(unsafe, target_set, nonce, marker_digest) < 0, "unexpected-symlink", &passed) < 0) return 1;
  int hardlink = directory(root, "allocation-hardlink");
  if (hardlink < 0 || tsa_create_allocation_tree(hardlink, target_set, nonce) < 0 ||
      linkat(hardlink, ".darshan-target-allocation-v1", hardlink, "unexpected", 0) < 0) return 1;
  if (check(tsa_validate_allocation_tree(hardlink, target_set, nonce, marker_digest) < 0, "unexpected-hardlink", &passed) < 0) return 1;
  int fifo = directory(root, "allocation-fifo");
  if (fifo < 0 || tsa_create_allocation_tree(fifo, target_set, nonce) < 0 || mkfifoat(fifo, "unexpected", 0600) < 0) return 1;
  if (check(tsa_validate_allocation_tree(fifo, target_set, nonce, marker_digest) < 0, "unexpected-fifo", &passed) < 0) return 1;
  int socket_tree = directory(root, "allocation-socket");
  if (socket_tree < 0 || tsa_create_allocation_tree(socket_tree, target_set, nonce) < 0) return 1;
  int socket_fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0); struct sockaddr_un address = { .sun_family = AF_UNIX };
  int socket_path = snprintf(address.sun_path, sizeof(address.sun_path), "%s/allocation-socket/unexpected", argv[1]);
  if (socket_fd < 0 || socket_path <= 0 || (size_t)socket_path >= sizeof(address.sun_path) ||
      bind(socket_fd, (struct sockaddr *)&address, sizeof(address)) < 0) return 1;
  if (check(tsa_validate_allocation_tree(socket_tree, target_set, nonce, marker_digest) < 0, "unexpected-socket", &passed) < 0) return 1;
  close(socket_fd);
  int device = directory(root, "allocation-device"); if (device < 0 || tsa_create_allocation_tree(device, target_set, nonce) < 0) return 1;
  int device_result = mknodat(device, "unexpected", S_IFCHR | 0600, makedev(1, 3));
  if (check((device_result == 0 && tsa_validate_allocation_tree(device, target_set, nonce, marker_digest) < 0) ||
      (device_result < 0 && (errno == EPERM || errno == EACCES)), "unexpected-device-or-unprivileged-gate", &passed) < 0) return 1;
  int nested = directory(root, "allocation-nested"); if(nested<0||tsa_create_allocation_tree(nested,target_set,nonce)<0)return 1;
  int nested_postgres=openat(nested,"postgres",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);
  if(nested_postgres<0||mkdirat(nested_postgres,"nested",0700)<0)return 1;
  if(check(tsa_validate_allocation_tree(nested,target_set,nonce,marker_digest)<0,"nested-component-object",&passed)<0)return 1;
  close(nested_postgres);

  int ledger = directory(root, "ledger");
  const char *zero = "0000000000000000000000000000000000000000000000000000000000000000";
  int active = directory(root, "active"), quarantine = directory(root, "quarantine");
  if (active < 0 || quarantine < 0 || mkdirat(active, basename, 0700) < 0) return 1;
  int source = openat(active, basename, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (source < 0 || tsa_create_allocation_tree(source, target_set, nonce) < 0 ||
      tsa_validate_allocation_tree(source, target_set, nonce, marker_digest) < 0) return 1;
  struct tsa_ledger_record intent = { .sequence=0, .phase=TSA_LEDGER_INTENT, .action=TSA_ACTION_ALLOCATE,
    .stage=TSA_STAGE_ALLOCATING, .reservation_bytes=4096, .reservation_inodes=4 };
  memset(intent.installed_identity_sha256,'a',64);intent.installed_identity_sha256[64]='\0';memset(intent.site_identity_sha256,'b',64);intent.site_identity_sha256[64]='\0';
  memset(intent.host_identity_sha256,'c',64);intent.host_identity_sha256[64]='\0';memset(intent.policy_sha256,'d',64);intent.policy_sha256[64]='\0';
  memset(intent.profile_sha256,'e',64);intent.profile_sha256[64]='\0';memset(intent.specification_sha256,'f',64);intent.specification_sha256[64]='\0';
  memset(intent.evidence_context_sha256,'1',64);intent.evidence_context_sha256[64]='\0';memset(intent.reservation_id_sha256,'2',64);intent.reservation_id_sha256[64]='\0';
  memset(intent.request_sha256,'3',64);intent.request_sha256[64]='\0';memset(intent.body_sha256,'4',64);intent.body_sha256[64]='\0';memset(intent.authorization_sha256,'5',64);intent.authorization_sha256[64]='\0';
  memcpy(intent.target_set_sha256,target_set,65);memcpy(intent.nonce,nonce,65);memcpy(intent.marker_sha256,marker_digest,65);
  memcpy(intent.basename,basename,132);
  memcpy(intent.previous_sha256,zero,65);
  if(identity(source,&intent.source_dev,&intent.source_ino,&intent.source_mount_id)<0||
     identity(active,&intent.active_dev,&intent.active_ino,&intent.active_mount_id)<0||
     identity(quarantine,&intent.quarantine_dev,&intent.quarantine_ino,&intent.quarantine_mount_id)<0)return 1;
  char intent_hash[65];
  if (check(ledger >= 0 && tsa_append_ledger_record(ledger,&intent,intent_hash) == 0, "ledger-intent", &passed) < 0) return 1;
  struct tsa_ledger_record receipt=intent;receipt.phase=TSA_LEDGER_RECEIPT;receipt.stage=TSA_STAGE_FILESYSTEM_ALLOCATED;
  memcpy(receipt.previous_sha256,intent_hash,65);char receipt_hash[65];
  if(check(tsa_append_ledger_record(ledger,&receipt,receipt_hash)==0,"ledger-receipt",&passed)<0)return 1;
  int initial_receipt_ledger=directory(root,"ledger-initial-receipt");char rejected_hash[65];
  if(check(initial_receipt_ledger>=0&&tsa_append_ledger_record(initial_receipt_ledger,&receipt,rejected_hash)<0&&errno==EINVAL,
    "ledger-initial-receipt-rejected",&passed)<0)return 1;
  char ledger_head[65]; size_t ledger_entries = 0;struct tsa_ledger_record last;
  if (check(tsa_validate_ledger_chain(ledger, ledger_head, &ledger_entries,&last) == 0 && ledger_entries == 2 &&
      !strcmp(ledger_head, receipt_hash), "ledger-chain-repeatable", &passed) < 0) return 1;
  if (check(tsa_validate_ledger_chain(ledger, ledger_head, &ledger_entries,&last) == 0 &&
      tsa_append_ledger_record(ledger,&receipt,receipt_hash)==1, "ledger-exact-replay", &passed) < 0) return 1;
  const size_t offsets[]={offsetof(struct tsa_ledger_record,installed_identity_sha256),offsetof(struct tsa_ledger_record,site_identity_sha256),
    offsetof(struct tsa_ledger_record,host_identity_sha256),offsetof(struct tsa_ledger_record,policy_sha256),offsetof(struct tsa_ledger_record,profile_sha256),
    offsetof(struct tsa_ledger_record,specification_sha256),offsetof(struct tsa_ledger_record,evidence_context_sha256),offsetof(struct tsa_ledger_record,target_set_sha256),
    offsetof(struct tsa_ledger_record,nonce),offsetof(struct tsa_ledger_record,basename),offsetof(struct tsa_ledger_record,marker_sha256),
    offsetof(struct tsa_ledger_record,reservation_id_sha256),offsetof(struct tsa_ledger_record,request_sha256),offsetof(struct tsa_ledger_record,body_sha256),offsetof(struct tsa_ledger_record,authorization_sha256)};
  int matrix_ok=1;for(size_t index=0;index<sizeof(offsets)/sizeof(offsets[0]);index++){struct tsa_ledger_record changed=receipt;char *field=(char *)&changed+offsets[index];field[0]=field[0]=='a'?'b':'a';if(tsa_append_ledger_record(ledger,&changed,rejected_hash)>=0||(errno!=EEXIST&&errno!=EINVAL))matrix_ok=0;}
  const size_t numeric_offsets[]={offsetof(struct tsa_ledger_record,reservation_bytes),offsetof(struct tsa_ledger_record,reservation_inodes),offsetof(struct tsa_ledger_record,source_dev),offsetof(struct tsa_ledger_record,source_ino),offsetof(struct tsa_ledger_record,source_mount_id),offsetof(struct tsa_ledger_record,active_dev),offsetof(struct tsa_ledger_record,active_ino),offsetof(struct tsa_ledger_record,active_mount_id),offsetof(struct tsa_ledger_record,quarantine_dev),offsetof(struct tsa_ledger_record,quarantine_ino),offsetof(struct tsa_ledger_record,quarantine_mount_id)};
  for(size_t index=0;index<sizeof(numeric_offsets)/sizeof(numeric_offsets[0]);index++){struct tsa_ledger_record changed=receipt;uint64_t *field=(uint64_t *)((char *)&changed+numeric_offsets[index]);(*field)++;if(tsa_append_ledger_record(ledger,&changed,rejected_hash)>=0||errno!=EEXIST)matrix_ok=0;}
  if(check(matrix_ok&&tsa_validate_ledger_chain(ledger,ledger_head,&ledger_entries,&last)==0&&ledger_entries==2,"immutable-binding-change-matrix",&passed)<0)return 1;
  struct tsa_ledger_record conflicting=receipt;conflicting.stage=TSA_STAGE_QUARANTINED;
  if(check(tsa_append_ledger_record(ledger,&conflicting,rejected_hash)<0&&errno==EEXIST,"ledger-replay-conflict",&passed)<0)return 1;
  int enospc_ledger = directory(root, "ledger-enospc");
  if (setenv("TARGET_STORAGE_AUTHORITY_TEST_FAILURE", "ledger-write-enospc", 1) < 0) return 1;
  if (check(enospc_ledger >= 0 && tsa_append_ledger_record(enospc_ledger,&intent,intent_hash)<0 && errno == ENOSPC,
      "ledger-enospc-hook", &passed) < 0) return 1;
  if(check(tsa_append_ledger_record(enospc_ledger,&intent,intent_hash)<0&&errno==EAGAIN,
    "ledger-pending-exact-is-ambiguous",&passed)<0)return 1;
  if (setenv("TARGET_STORAGE_AUTHORITY_TEST_FAILURE", "ledger-rename", 1) < 0) return 1;
  int rename_ledger = directory(root, "ledger-rename");
  if (check(rename_ledger >= 0 && tsa_append_ledger_record(rename_ledger,&intent,intent_hash)<0 && errno == EIO,
      "ledger-rename-hook", &passed) < 0) return 1;
  if (unsetenv("TARGET_STORAGE_AUTHORITY_TEST_FAILURE") < 0) return 1;
  char quarantine_receipt[65];if(check(tsa_quarantine_from_ledger(ledger,active,quarantine,target_set,nonce,quarantine_receipt)==0,
    "ledger-authorized-quarantine",&passed)<0)return 1;
  if(check(tsa_validate_ledger_chain(ledger,ledger_head,&ledger_entries,&last)==0&&ledger_entries==4&&last.stage==TSA_STAGE_QUARANTINED,
    "quarantine-receipt-chain",&passed)<0)return 1;
  char replay_receipt[65];if(check(tsa_quarantine_from_ledger(ledger,active,quarantine,target_set,nonce,replay_receipt)==1&&
    !strcmp(replay_receipt,quarantine_receipt),"quarantine-exact-replay",&passed)<0)return 1;
  if(fchmod(active,0755)<0)return 1;
  if(check(tsa_quarantine_from_ledger(ledger,active,quarantine,target_set,nonce,replay_receipt)<0&&errno==EPERM,
    "quarantine-wrong-parent-mode",&passed)<0)return 1;
  if(fchmod(active,0700)<0)return 1;
  int wrong_parent=directory(root,"wrong-quarantine-parent");if(check(wrong_parent>=0&&tsa_quarantine_from_ledger(ledger,active,wrong_parent,target_set,nonce,replay_receipt)<0&&errno==EPERM,
    "quarantine-wrong-parent-identity",&passed)<0)return 1;
  const char *bad_names[]={"00000000000000000000-intent-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jsonx",
    "00000000000000000000-Intent-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
    "0000000000000000000-intent-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
    "00000000000000000000-intent-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.JSON",
    "00000000000000000000-intent-Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"};int filenames_ok=1;
  for(size_t index=0;index<sizeof(bad_names)/sizeof(bad_names[0]);index++){char dirname_value[32];snprintf(dirname_value,sizeof(dirname_value),"bad-ledger-%zu",index);int bad=directory(root,dirname_value);int file=openat(bad,bad_names[index],O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0600);if(file<0||write(file,"x",1)!=1){filenames_ok=0;}if(file>=0)close(file);if(tsa_validate_ledger_chain(bad,ledger_head,&ledger_entries,&last)>=0)filenames_ok=0;close(bad);}if(check(filenames_ok,"ledger-filename-negative-matrix",&passed)<0)return 1;
  close(allocation); close(unsafe); close(hardlink); close(fifo); close(socket_tree); close(device);close(nested);
  close(source);close(ledger);close(initial_receipt_ledger);close(enospc_ledger);close(rename_ledger);close(active);close(quarantine);close(wrong_parent);close(root);
  printf("%u storage authority checks passed\n", passed); return passed == 28 ? 0 : 1;
}
