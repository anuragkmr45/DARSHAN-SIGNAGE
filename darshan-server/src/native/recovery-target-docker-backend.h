#ifndef DARSHAN_RECOVERY_TARGET_DOCKER_BACKEND_H
#define DARSHAN_RECOVERY_TARGET_DOCKER_BACKEND_H
#include "recovery-target-credential-authority.h"
#include "recovery-target-docker-observation.h"
#define RTDB_HANDLE_COUNT 22u
enum rtdb_handle_role { RTDB_HANDLE_PROFILE_V2=1,RTDB_HANDLE_CREDENTIAL_PROFILE_V3=2,RTDB_HANDLE_EXECUTION_PROFILE_V4=3,
  RTDB_HANDLE_RESOURCE_ADMISSION_V2=4,RTDB_HANDLE_RESOURCE_ADMISSION_V3=5,RTDB_HANDLE_INSTALLED_ASSETS=6,
  RTDB_HANDLE_DOCKER_ELF=7,RTDB_HANDLE_CLIENT_CONFIG=8,RTDB_HANDLE_DAEMON_SOCKET=9,RTDB_HANDLE_INTERNAL_NETWORK=10,
  RTDB_HANDLE_POSTGRES_CONTAINER=11,RTDB_HANDLE_MINIO_CONTAINER=12,RTDB_HANDLE_POSTGRES_BIND=13,RTDB_HANDLE_MINIO_BIND=14,
  RTDB_HANDLE_POSTGRES_PASSWORD=15,RTDB_HANDLE_MINIO_ROOT_PASSWORD=16,RTDB_HANDLE_MINIO_ROOT_USER=17,
  RTDB_HANDLE_POSTGRES_CONFIG=18,RTDB_HANDLE_MINIO_CONFIG=19,RTDB_HANDLE_POSTGRES_BOOTSTRAP=20,
  RTDB_HANDLE_MINIO_BOOTSTRAP=21,RTDB_HANDLE_PROBE_ASSET_SET=22 };
struct rtdb_handle { enum rtdb_handle_role role; char handle[128]; char identity_sha256[65]; };
struct rtdb_command_admission { struct rtew_command_v4 command; struct rtdb_handle enrolled_handles[RTDB_HANDLE_COUNT]; size_t enrolled_handle_count; };
struct rtdb_context { struct rtea_session *authority_session; struct rtca_admitted_use_context *credential_use; struct rtdo_expected expected; struct rtdb_command_admission admission; struct rtdb_handle handles[RTDB_HANDLE_COUNT]; size_t handle_count; int active,closed; pid_t child_pid,child_pgid; };
int rtdb_open_context(struct rtea_session *authority_session,struct rtca_admitted_use_context *credential_use,const struct rtdb_handle *handles,size_t handle_count,const struct rtdb_command_admission *admission,const struct rtdo_expected *expected,struct rtdb_context *context);
int rtdb_validate(struct rtdb_context *context);
int rtdb_execute_fixed(struct rtdb_context *context,const void *command,size_t command_size,const void *synthetic_output,size_t synthetic_output_size,struct rtew_inspection_v4 *inspection);
int rtdb_observe(struct rtdb_context *context,const struct rtew_command_v4 *command,struct rtew_inspection_v4 *inspection);
int rtdb_cancel_join(struct rtdb_context *context);
int rtdb_close(struct rtdb_context *context);
#endif
