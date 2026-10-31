#ifndef DARSHAN_RECOVERY_TARGET_ENGINE_MATERIALIZATION_H
#define DARSHAN_RECOVERY_TARGET_ENGINE_MATERIALIZATION_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define RTEM_SHA256_HEX_LENGTH 64u
#define RTEM_MAX_RECORD_BYTES 16384u
#define RTEM_MAX_RECORDS 256u
#define RTEM_MAX_TOTAL_BYTES (4u * 1024u * 1024u)

enum rtem_role { RTEM_ROLE_NETWORK = 1, RTEM_ROLE_POSTGRES = 2, RTEM_ROLE_MINIO = 3 };
enum rtem_operation {
  RTEM_OPERATION_ENSURE_INTERNAL_NETWORK = 1,
  RTEM_OPERATION_CREATE_POSTGRES = 2,
  RTEM_OPERATION_CREATE_MINIO = 3
};

struct rtem_identity {
  char operation_id[37];
  char target_handle[128];
  uint64_t generation;
  enum rtem_operation operation;
  enum rtem_role role;
  char resource_handle[128];
  char profile_sha256[65];
  char admission_sha256[65];
  char command_sha256[65];
  char command_nonce[33];
};

struct rtem_actual_resource {
  int observed;
  char resource_id[72];
  char image_id[72];
  char image_config_sha256[65];
  char effective_configuration_sha256[65];
  char owner_labels_sha256[65];
  char consumer_set_sha256[65];
  char daemon_identity_sha256[65];
};

struct rtem_journal {
  int directory_fd;
  dev_t device;
  ino_t inode;
  uid_t owner_uid;
  gid_t owner_gid;
  uint64_t next_sequence;
  size_t record_count;
  size_t total_bytes;
  char head_sha256[65];
};

struct rtem_publication {
  uint64_t sequence;
  int exact_replay;
  char record_sha256[65];
};

int rtem_open_journal(int directory_fd, uid_t owner_uid, gid_t owner_gid,
  struct rtem_journal *journal);
int rtem_rescan(struct rtem_journal *journal);
int rtem_publish_intent(struct rtem_journal *journal,
  const struct rtem_identity *identity, const char expected_head_sha256[65],
  struct rtem_publication *publication);
int rtem_publish_receipt(struct rtem_journal *journal,
  const struct rtem_identity *identity, const char intent_sha256[65],
  const char observation_sha256[65], const struct rtem_actual_resource *actual,
  int authoritative_complete, struct rtem_publication *publication);
int rtem_close_journal(struct rtem_journal *journal);

#endif

