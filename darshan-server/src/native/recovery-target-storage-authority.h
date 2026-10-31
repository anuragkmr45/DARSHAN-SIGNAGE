#ifndef DARSHAN_RECOVERY_TARGET_STORAGE_AUTHORITY_H
#define DARSHAN_RECOVERY_TARGET_STORAGE_AUTHORITY_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define TSA_SHA256_HEX_LENGTH 64u
#define TSA_NONCE_HEX_LENGTH 64u
#define TSA_MAX_LEDGER_ENTRY_BYTES 16384u
#define TSA_MAX_LEDGER_ENTRIES 4096u

enum tsa_component { TSA_COMPONENT_POSTGRES = 1, TSA_COMPONENT_MINIO = 2 };
enum tsa_ledger_phase { TSA_LEDGER_INTENT = 1, TSA_LEDGER_RECEIPT = 2 };
enum tsa_ledger_action { TSA_ACTION_ALLOCATE = 1, TSA_ACTION_RETIRE_INTENT = 2 };
enum tsa_ledger_stage { TSA_STAGE_ALLOCATING = 1, TSA_STAGE_FILESYSTEM_ALLOCATED = 2, TSA_STAGE_QUARANTINED = 3 };

struct tsa_ledger_record {
  uint64_t sequence;
  enum tsa_ledger_phase phase;
  enum tsa_ledger_action action;
  enum tsa_ledger_stage stage;
  char installed_identity_sha256[65];
  char site_identity_sha256[65];
  char host_identity_sha256[65];
  char policy_sha256[65];
  char profile_sha256[65];
  char specification_sha256[65];
  char evidence_context_sha256[65];
  char target_set_sha256[65];
  char nonce[65];
  char basename[133];
  char marker_sha256[65];
  char previous_sha256[65];
  char reservation_id_sha256[65];
  uint64_t reservation_bytes, reservation_inodes;
  char request_sha256[65], body_sha256[65], authorization_sha256[65];
  uint64_t source_dev, source_ino, source_mount_id;
  uint64_t active_dev, active_ino, active_mount_id;
  uint64_t quarantine_dev, quarantine_ino, quarantine_mount_id;
  uint64_t destination_dev, destination_ino, destination_mount_id;
};

struct tsa_capacity {
  uint64_t available_bytes;
  uint64_t available_inodes;
  uint64_t outstanding_bytes;
  uint64_t outstanding_inodes;
  uint64_t remaining_bytes;
  uint64_t remaining_inodes;
  int admitted;
};

int tsa_checked_capacity(uint64_t f_bavail, uint64_t f_frsize, uint64_t f_favail,
  uint64_t outstanding_bytes, uint64_t outstanding_inodes,
  uint64_t required_bytes, uint64_t required_inodes, struct tsa_capacity *result);
int tsa_random_nonce(char output[TSA_NONCE_HEX_LENGTH + 1]);
int tsa_allocation_basename(const char target_set_sha256[TSA_SHA256_HEX_LENGTH + 1],
  const char nonce[TSA_NONCE_HEX_LENGTH + 1], char *output, size_t output_size);
int tsa_take_ofd_authority(int control_directory_fd);
int tsa_validate_enrolled_root(int root_fd, int allow_test_directory_fixture);
int tsa_create_allocation_tree(int allocation_fd, const char target_set_sha256[65], const char nonce[65]);
int tsa_validate_allocation_tree(int allocation_fd, const char target_set_sha256[65], const char nonce[65],
  char marker_sha256[65]);
int tsa_append_ledger_record(int ledger_fd, const struct tsa_ledger_record *record, char record_sha256[65]);
int tsa_validate_ledger_chain(int ledger_fd, char head_sha256[65], size_t *entry_count, struct tsa_ledger_record *last);
int tsa_quarantine_from_ledger(int ledger_fd, int active_fd, int quarantine_fd,
  const char target_set_sha256[65], const char nonce[65], char receipt_sha256[65]);

#endif
