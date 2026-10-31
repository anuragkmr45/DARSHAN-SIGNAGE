#ifndef DARSHAN_RECOVERY_TARGET_ENGINE_EXECUTOR_H
#define DARSHAN_RECOVERY_TARGET_ENGINE_EXECUTOR_H

#include "recovery-target-engine-authority.h"
#include "recovery-target-engine-materialization.h"

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define RTEE_MAX_COMMAND_BYTES 8192u
#define RTEE_MAX_INSPECTION_BYTES 65536u
#define RTEE_MAX_HANDLE_MAP 20u
#define RTEE_MAX_ASSETS 4u
#define RTEE_MAX_BINDS 5u

enum rtee_operation {
  RTEE_OPERATION_INSPECT_TARGET = 1,
  RTEE_OPERATION_ENSURE_INTERNAL_NETWORK = 2,
  RTEE_OPERATION_CREATE_POSTGRES = 3,
  RTEE_OPERATION_CREATE_MINIO = 4
};
enum rtee_role { RTEE_ROLE_NONE = 0, RTEE_ROLE_NETWORK = 1, RTEE_ROLE_POSTGRES = 2, RTEE_ROLE_MINIO = 3 };
enum rtee_handle_role {
  RTEE_HANDLE_PROFILE = 1, RTEE_HANDLE_EXECUTABLE, RTEE_HANDLE_CLIENT_CONFIG, RTEE_HANDLE_DAEMON_SOCKET,
  RTEE_HANDLE_NETWORK, RTEE_HANDLE_POSTGRES, RTEE_HANDLE_MINIO, RTEE_HANDLE_POSTGRES_BIND,
  RTEE_HANDLE_MINIO_BIND, RTEE_HANDLE_POSTGRES_PASSWORD, RTEE_HANDLE_MINIO_ROOT_PASSWORD,
  RTEE_HANDLE_MINIO_ROOT_USER, RTEE_HANDLE_POSTGRES_CONFIG, RTEE_HANDLE_MINIO_CONFIG,
  RTEE_HANDLE_POSTGRES_BOOTSTRAP, RTEE_HANDLE_MINIO_BOOTSTRAP
};

struct rtee_descriptor_identity {
  int fd;
  dev_t device;
  ino_t inode;
  uint64_t mount_id;
  uid_t owner_uid;
  gid_t owner_gid;
  mode_t mode;
  char content_sha256[65];
  char allocation_ledger_head_sha256[65];
};

struct rtee_handle_entry {
  enum rtee_handle_role role;
  char handle[128];
  char identity_sha256[65];
  int admitted;
};

struct rtee_asset_manifest {
  enum rtee_handle_role role;
  struct rtee_descriptor_identity descriptor;
  enum { RTEE_ASSET_FRESH = 1, RTEE_ASSET_COMPLETE = 2, RTEE_ASSET_PARTIAL = 3 } source_state;
  int dispatch_enabled;
};

struct rtee_enrollment {
  char profile_handle[128];
  char profile_sha256[65];
  char admission_sha256[65];
  char daemon_identity_sha256[65];
  char daemon_socket_identity_sha256[65];
  char postgres_image_id[72];
  char postgres_image_config_sha256[65];
  char minio_image_id[72];
  char minio_image_config_sha256[65];
  char network_configuration_sha256[65];
  char postgres_configuration_sha256[65];
  char minio_configuration_sha256[65];
  struct rtee_descriptor_identity executable;
  struct rtee_descriptor_identity client_config;
  struct rtee_asset_manifest assets[RTEE_MAX_ASSETS];
  size_t asset_count;
};

struct rtee_command {
  enum rtee_operation operation;
  enum rtee_role role;
  char command_id[37];
  char operation_id[37];
  char target_handle[128];
  uint64_t generation;
  char resource_handle[128];
  char profile_sha256[65];
  char admission_sha256[65];
  char request_sha256[65];
  char authorization_sha256[65];
  char command_nonce[33];
  char materialization_head_sha256[65];
  uint64_t deadline_unix_ms;
  char authority_instance_sha256[65];
  uint64_t authority_deadline_unix_ms;
  uint64_t supervisor_generation;
};

struct rtee_resource_projection {
  enum rtee_role role;
  enum { RTEE_RESOURCE_ABSENT = 1, RTEE_RESOURCE_CREATED = 2, RTEE_RESOURCE_STOPPED = 3,
    RTEE_RESOURCE_RUNNING = 4, RTEE_RESOURCE_ERROR = 5 } state;
  enum { RTEE_CONFIG_MATCH = 1, RTEE_CONFIG_MISMATCH = 2, RTEE_CONFIG_INCOMPLETE = 3 } configuration;
  char resource_id[72];
  char image_id[72];
  char image_config_sha256[65];
  char effective_configuration_sha256[65];
  char owner_labels_sha256[65];
  char consumer_set_sha256[65];
  char daemon_identity_sha256[65];
  char error_sha256[65];
};

struct rtee_inspection {
  char operation_id[37];
  char target_handle[128];
  uint64_t generation;
  char profile_sha256[65];
  char admission_sha256[65];
  char command_sha256[65];
  enum rtee_operation operation;
  enum rtee_role role;
  char resource_handle[128];
  char command_nonce[33];
  char materialization_head_sha256[65];
  int observation_complete;
  int absence_reliable;
  int containers_complete;
  int networks_complete;
  int mounts_complete;
  int consumers_complete;
  int daemon_complete;
  struct rtee_resource_projection network;
  struct rtee_resource_projection postgres;
  struct rtee_resource_projection minio;
};

struct rtee_context {
  struct rtea_request acquired_request;
  struct rtea_session authority_session;
  struct rtee_enrollment enrollment;
  struct rtee_handle_entry handles[RTEE_MAX_HANDLE_MAP];
  size_t handle_count;
  struct rtee_descriptor_identity binds[RTEE_MAX_BINDS];
  size_t bind_count;
  int active_child;
  int joined;
  pid_t child_pid;
  pid_t child_pgid;
};

int rtee_context_init(struct rtee_context *context, const void *immutable_acquired_frame, size_t immutable_acquired_frame_size,
  struct rtea_session *authority_session, const struct rtee_enrollment *enrollment,
  const struct rtee_handle_entry *handles, size_t handle_count,
  const struct rtee_descriptor_identity *binds, size_t bind_count);
int rtee_parse_command(const void *frame, size_t frame_size, struct rtee_command *command);
int rtee_parse_inspection_projection(const void *bytes, size_t size, struct rtee_inspection *inspection);
int rtee_dispatch_fixed(struct rtee_context *context, struct rtem_journal *materialization,
  const void *frame, size_t frame_size, int cancellation_fd,
  struct rtee_inspection *inspection);
int rtee_cancel_join(struct rtee_context *context);
int rtee_cancel_join_and_release(struct rtee_context *context);
int rtee_context_close(struct rtee_context *context);

#endif

