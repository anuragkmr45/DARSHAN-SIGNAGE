#ifndef DARSHAN_RECOVERY_TARGET_ENGINE_WIRE_V4_H
#define DARSHAN_RECOVERY_TARGET_ENGINE_WIRE_V4_H

#include <stddef.h>
#include <stdint.h>

#define RTEW_V4_MAX_BYTES 16384u

enum rtew_v4_operation { RTEW_V4_INSPECT_TARGET=1, RTEW_V4_ENSURE_INTERNAL_NETWORK=2,
  RTEW_V4_CREATE_POSTGRES=3, RTEW_V4_CREATE_MINIO=4 };
enum rtew_v4_role { RTEW_V4_NONE=0, RTEW_V4_NETWORK=1, RTEW_V4_POSTGRES=2, RTEW_V4_MINIO=3 };

struct rtew_command_v4 {
  enum rtew_v4_operation operation; enum rtew_v4_role role;
  char installation_id[37],site_id[64],host_installation_id[37],operation_id[37],target_handle[128];
  uint64_t generation,supervisor_generation,deadline_unix_ms;
  char acquired_request_sha256[65],profile_v4_sha256[65],resource_admission_v3_sha256[65];
  char credential_admission_receipt_sha256[65],credential_use_witness_sha256[65];
  char authority_instance_sha256[65],challenge_nonce[33],command_nonce[33];
  char materialization_head_sha256[65],asset_manifest_sha256[65];
};

struct rtew_inspection_v4 {
  enum rtew_v4_operation operation; enum rtew_v4_role role;
  char operation_id[37],target_handle[128]; uint64_t generation,supervisor_generation;
  char command_semantic_sha256[65],command_wire_sha256[65],command_nonce[33];
  char authority_instance_sha256[65],challenge_nonce[33],materialization_head_sha256[65];
  char asset_manifest_sha256[65],daemon_identity_sha256[65],daemon_response_sha256[65];
  int observation_complete,absence_reliable; uint64_t containers_count,networks_count,consumers_count;
  char network_projection_sha256[65],postgres_projection_sha256[65],minio_projection_sha256[65];
};

int rtew_parse_command_v4(const void *bytes,size_t size,struct rtew_command_v4 *command);
int rtew_encode_command_v4(const struct rtew_command_v4 *command,void *bytes,size_t capacity,size_t *size);
int rtew_command_wire_sha256_v4(const void *bytes,size_t size,char output[65]);
int rtew_command_semantic_sha256_v4(const struct rtew_command_v4 *command,char output[65]);
int rtew_parse_inspection_v4(const void *bytes,size_t size,struct rtew_inspection_v4 *inspection);
int rtew_encode_inspection_v4(const struct rtew_inspection_v4 *inspection,void *bytes,size_t capacity,size_t *size);
int rtew_inspection_wire_sha256_v4(const void *bytes,size_t size,char output[65]);

#endif
