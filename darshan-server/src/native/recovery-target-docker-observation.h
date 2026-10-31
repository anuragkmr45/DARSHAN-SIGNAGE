#ifndef DARSHAN_RECOVERY_TARGET_DOCKER_OBSERVATION_H
#define DARSHAN_RECOVERY_TARGET_DOCKER_OBSERVATION_H
#include "recovery-target-engine-wire-v4.h"
#include <stddef.h>
#define RTDO_MAX_RAW_BYTES 65536u
struct rtdo_expected { char daemon_identity_sha256[65],asset_manifest_sha256[65]; char network_name[96]; char postgres_image_id[72],minio_image_id[72]; char postgres_container_id_sha256[65],minio_container_id_sha256[65],consumer_set_sha256[65]; char postgres_config_sha256[65],minio_config_sha256[65],postgres_owner_sha256[65],minio_owner_sha256[65]; };
int rtdo_parse_synthetic_daemon_transcript(const void *raw,size_t raw_size,const struct rtew_command_v4 *command,const struct rtdo_expected *expected,struct rtew_inspection_v4 *inspection);
#endif
