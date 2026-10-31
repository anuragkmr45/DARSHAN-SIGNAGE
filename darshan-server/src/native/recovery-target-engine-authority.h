#ifndef DARSHAN_RECOVERY_TARGET_ENGINE_AUTHORITY_H
#define DARSHAN_RECOVERY_TARGET_ENGINE_AUTHORITY_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define RTEA_SHA256_HEX_LENGTH 64u
#define RTEA_UUID_LENGTH 36u
#define RTEA_MAX_FRAME_BYTES 4096u
#define RTEA_MAX_RESULT_BYTES 1024u
#define RTEA_MAX_DEADLINE_SKEW_MS 240000u
#define RTEA_AUTHORITY_FILE "engine-authority.lock"

enum rtea_operation {
  RTEA_OPERATION_INSPECT = 1,
  RTEA_OPERATION_PREPARE = 2,
  RTEA_OPERATION_STOP_RETAIN = 3
};

struct rtea_enrollment {
  char installation_id[RTEA_UUID_LENGTH + 1];
  char site_id[64];
  char host_installation_id[RTEA_UUID_LENGTH + 1];
  char enrollment_sha256[RTEA_SHA256_HEX_LENGTH + 1];
  char profile_sha256[RTEA_SHA256_HEX_LENGTH + 1];
  char admission_sha256[RTEA_SHA256_HEX_LENGTH + 1];
  char authority_instance_sha256[RTEA_SHA256_HEX_LENGTH + 1];
  uid_t supervisor_peer_uid;
  uint64_t supervisor_generation;
  uint64_t reconciled_supervisor_generation;
};

struct rtea_request {
  enum rtea_operation operation;
  char installation_id[RTEA_UUID_LENGTH + 1];
  char site_id[64];
  char host_installation_id[RTEA_UUID_LENGTH + 1];
  char operation_id[RTEA_UUID_LENGTH + 1];
  uint64_t generation;
  char target_set_id[65];
  char target_handle[128];
  char profile_sha256[65];
  char enrollment_sha256[65];
  char admission_sha256[65];
  char outer_envelope_sha256[65];
  char request_sha256[65];
  char authorization_sha256[65];
  uint64_t deadline_unix_ms;
  char supervisor_instance_sha256[65];
  uint64_t supervisor_generation;
  uint64_t reconciled_generation;
  char challenge_nonce[33];
};

struct rtea_session {
  int authority_fd;
  int peer_channel_fd;
  uint64_t authority_dev;
  uint64_t authority_ino;
  enum rtea_operation operation;
  int readonly;
  int reconciliation_required;
  char session_handle[96];
  char lease_proof_sha256[65];
  char authority_instance_sha256[65];
  uint64_t supervisor_generation;
  char challenge_nonce[33];
};

int rtea_parse_request(const void *frame, size_t frame_size, struct rtea_request *request);
int rtea_validate_private_channel(int channel_fd, uid_t expected_peer_uid, pid_t *peer_pid);
int rtea_acquire_session(int authority_directory_fd, int channel_fd,
  const struct rtea_enrollment *enrollment, const void *frame, size_t frame_size,
  uint64_t fixture_now_unix_ms, struct rtea_session *session);
int rtea_encode_session_result(const struct rtea_session *session, char *output, size_t output_size);
int rtea_validate_active_session(const struct rtea_session *session);
int rtea_release_on_peer_death(struct rtea_session *session, int timeout_milliseconds);
int rtea_release_session(struct rtea_session *session);

#endif
