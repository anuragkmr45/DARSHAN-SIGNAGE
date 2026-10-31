#ifndef DARSHAN_RECOVERY_TARGET_CREDENTIAL_AUTHORITY_H
#define DARSHAN_RECOVERY_TARGET_CREDENTIAL_AUTHORITY_H

#include "recovery-target-engine-authority.h"

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define RTCA_MAX_SCOPE_BYTES 4096u
#define RTCA_ROLE_COUNT 3u

enum rtca_role {
  RTCA_ROLE_POSTGRES_PASSWORD = 1,
  RTCA_ROLE_MINIO_ROOT_PASSWORD = 2,
  RTCA_ROLE_MINIO_ROOT_USER = 3
};

enum rtca_state {
  RTCA_STATE_ABSENT = 0,
  RTCA_STATE_INTENT = 1,
  RTCA_STATE_FILES_DURABLE = 2,
  RTCA_STATE_ADMITTED = 3
};

struct rtca_descriptor_identity {
  enum rtca_role role;
  char authority_handle[128];
  uint64_t device_major;
  uint64_t device_minor;
  uint64_t inode;
  uint64_t mount_id;
  uid_t owner_uid;
  gid_t owner_gid;
  mode_t mode;
  char identity_sha256[65];
};

struct rtca_admission {
  enum rtca_state state;
  char operation_id[37];
  uint64_t generation;
  char target_handle[128];
  char authority_handle[128];
  char scope_semantic_sha256[65];
  char scope_wire_sha256[65];
  char authorization_sha256[65];
  char request_sha256[65];
  char allocation_identity_sha256[65];
  char allocation_ledger_head_sha256[65];
  char credential_policy_sha256[65];
  char authority_instance_sha256[65];
  char intent_record_sha256[65];
  char files_durable_record_sha256[65];
  char admission_receipt_sha256[65];
  struct rtca_descriptor_identity descriptors[RTCA_ROLE_COUNT];
};

struct rtca_context {
  int scope_fd;
  int authority_session_fd;
  int peer_channel_fd;
  struct rtea_session authority_session;
  uint64_t authority_device;
  uint64_t authority_inode;
  int credential_directory_fd;
  int journal_directory_fd;
  uint64_t credential_directory_device;
  uint64_t credential_directory_inode;
  uint64_t credential_directory_mount_id;
  uint64_t journal_directory_device;
  uint64_t journal_directory_inode;
  uint64_t journal_directory_mount_id;
  enum rtca_state state;
  struct rtea_request request;
  struct rtca_admission admission;
  char scope_wire_sha256[65];
  char scope_semantic_sha256[65];
  char precredential_template_sha256[65];
  char allocation_identity_sha256[65];
  char allocation_ledger_head_sha256[65];
  char credential_policy_sha256[65];
  char previous_journal_head_sha256[65];
  char authority_handle[128];
  char authority_target_handle[128];
  char role_handles[RTCA_ROLE_COUNT][128];
  uint64_t deadline_unix_ms;
  uint64_t deadline_realtime_ns;
  uint64_t deadline_monotonic_ns;
  unsigned char commitment_key[32];
};

/* Read-only execution witness. It deliberately contains no credential value,
 * commitment, HMAC key, path, or mutable provisioning authority. */
struct rtca_admitted_use_context {
  struct rtca_context *admitted_owner;
  int authority_session_fd;
  int peer_channel_fd;
  int credential_directory_fd;
  int credential_fds[RTCA_ROLE_COUNT];
  struct rtea_session authority_session;
  uint64_t deadline_realtime_ns;
  uint64_t deadline_monotonic_ns;
  struct rtca_admission admission;
  char witness_sha256[65];
};

int rtca_open_context(int credential_directory_fd, int journal_directory_fd,
  const struct rtea_session *session, const void *immutable_prepare_frame,
  size_t immutable_prepare_frame_size,
  const void *scope_wire, size_t scope_wire_size, uint64_t now_unix_ms,
  struct rtca_context *context);
int rtca_validate_provision_scope(struct rtca_context *context, uint64_t now_unix_ms);
int rtca_provision_fixed_roles(struct rtca_context *context, struct rtca_admission *admission);
int rtca_read_exact_admission(struct rtca_context *context, struct rtca_admission *admission);
int rtca_reconcile_provisioning(struct rtca_context *context, struct rtca_admission *admission);
int rtca_open_admitted_use_context(struct rtca_context *admitted,
  struct rtca_admitted_use_context *use_context);
int rtca_validate_admitted_use_context(struct rtca_admitted_use_context *use_context);
int rtca_close_admitted_use_context(struct rtca_admitted_use_context *use_context);
int rtca_close_context(struct rtca_context *context);

#endif
