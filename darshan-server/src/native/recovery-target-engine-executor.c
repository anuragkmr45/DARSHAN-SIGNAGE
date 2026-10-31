#define _GNU_SOURCE
#include "recovery-target-engine-executor.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/if_alg.h>
#include <linux/stat.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static int lower_hex(const char *value, size_t length) {
  if (!value || strlen(value) != length) return 0;
  for (size_t index = 0; index < length; index++)
    if (!((value[index] >= '0' && value[index] <= '9') || (value[index] >= 'a' && value[index] <= 'f'))) return 0;
  return 1;
}
static int uuid(const char *value) {
  if (!value || strlen(value) != 36) return 0;
  for (size_t index = 0; index < 36; index++) {
    if (index == 8 || index == 13 || index == 18 || index == 23) { if (value[index] != '-') return 0; }
    else if (!((value[index] >= '0' && value[index] <= '9') || (value[index] >= 'a' && value[index] <= 'f'))) return 0;
  }
  return value[14] >= '1' && value[14] <= '8' && strchr("89ab", value[19]) != NULL;
}
static int handle(const char *value) {
  size_t length = value ? strlen(value) : 0;
  if (length < 25 || length > 120 || memcmp(value, "tra:v1:", 7) != 0) return 0;
  for (size_t index = 7; index < length; index++)
    if (!((value[index] >= 'A' && value[index] <= 'Z') || (value[index] >= 'a' && value[index] <= 'z') ||
        (value[index] >= '0' && value[index] <= '9') || value[index] == '_' || value[index] == '-' || value[index] == ':')) return 0;
  return 1;
}
static int u64(const char *value, uint64_t *output) {
  if (!value || !*value || (value[0] == '0' && value[1])) return 0;
  uint64_t result = 0;
  for (const char *cursor = value; *cursor; cursor++) { if (*cursor < '0' || *cursor > '9') return 0;
    unsigned digit = (unsigned)(*cursor - '0'); if (result > (UINT64_MAX - digit) / 10u) return 0; result = result * 10u + digit; }
  *output = result; return 1;
}
static int sha256(const void *bytes, size_t size, char output[65]) {
  int algorithm = socket(AF_ALG, SOCK_SEQPACKET | SOCK_CLOEXEC, 0); if (algorithm < 0) return -1;
  struct sockaddr_alg address = { .salg_family = AF_ALG, .salg_type = "hash", .salg_name = "sha256" };
  if (bind(algorithm, (struct sockaddr *)&address, sizeof(address)) < 0) { int saved = errno; close(algorithm); errno = saved; return -1; }
  int operation = accept4(algorithm, NULL, NULL, SOCK_CLOEXEC); close(algorithm); if (operation < 0) return -1;
  if (send(operation, bytes, size, 0) != (ssize_t)size) { int saved = errno ? errno : EIO; close(operation); errno = saved; return -1; }
  unsigned char digest[32]; ssize_t count = read(operation, digest, sizeof(digest)); close(operation);
  if (count != (ssize_t)sizeof(digest)) { errno = EIO; return -1; } static const char hex[] = "0123456789abcdef";
  for (size_t index = 0; index < sizeof(digest); index++) { output[index * 2] = hex[digest[index] >> 4]; output[index * 2 + 1] = hex[digest[index] & 15u]; }
  output[64] = '\0'; return 0;
}

static int sha256_parts(const void *left,size_t left_size,const void *right,size_t right_size,char output[65]){
  int algorithm=socket(AF_ALG,SOCK_SEQPACKET|SOCK_CLOEXEC,0);if(algorithm<0)return-1;
  struct sockaddr_alg address={.salg_family=AF_ALG,.salg_type="hash",.salg_name="sha256"};
  if(bind(algorithm,(struct sockaddr *)&address,sizeof(address))<0){int saved=errno;close(algorithm);errno=saved;return-1;}
  int operation=accept4(algorithm,NULL,NULL,SOCK_CLOEXEC);close(algorithm);if(operation<0)return-1;
  struct iovec parts[2]={{.iov_base=(void *)left,.iov_len=left_size},{.iov_base=(void *)right,.iov_len=right_size}};
  struct msghdr message={.msg_iov=parts,.msg_iovlen=2};if(sendmsg(operation,&message,0)!=(ssize_t)(left_size+right_size)){int saved=errno?errno:EIO;close(operation);errno=saved;return-1;}
  unsigned char digest[32];ssize_t count=read(operation,digest,sizeof(digest));close(operation);if(count!=(ssize_t)sizeof(digest)){errno=EIO;return-1;}
  static const char hex[]="0123456789abcdef";for(size_t index=0;index<sizeof(digest);index++){output[index*2]=hex[digest[index]>>4];output[index*2+1]=hex[digest[index]&15u];}output[64]='\0';return 0;
}

static int read_hash(int fd, char output[65]) {
  struct stat state; if (fstat(fd, &state) < 0 || !S_ISREG(state.st_mode) || state.st_size <= 0 || state.st_size > 16 * 1024 * 1024) { errno = EPERM; return -1; }
  size_t size = (size_t)state.st_size; unsigned char *bytes = malloc(size); if (!bytes) return -1;
  ssize_t count = pread(fd, bytes, size, 0), more; unsigned char extra; more = pread(fd, &extra, 1, state.st_size);
  struct stat after; int stable = fstat(fd, &after) == 0 && state.st_dev == after.st_dev && state.st_ino == after.st_ino &&
    state.st_size == after.st_size && state.st_mtim.tv_sec == after.st_mtim.tv_sec && state.st_mtim.tv_nsec == after.st_mtim.tv_nsec;
  int result = count == (ssize_t)size && more == 0 && stable ? sha256(bytes, size, output) : -1;
  free(bytes); if (result < 0 && !errno) errno = ESTALE; return result;
}

static int mount_id(int fd, uint64_t *output) {
  struct statx state; memset(&state, 0, sizeof(state));
  if (statx(fd, "", AT_EMPTY_PATH | AT_STATX_SYNC_AS_STAT, STATX_MNT_ID, &state) < 0 || !(state.stx_mask & STATX_MNT_ID)) return -1;
  *output = state.stx_mnt_id; return 0;
}

static int verify_descriptor(const struct rtee_descriptor_identity *identity, int regular, int hash_content) {
  struct stat state; uint64_t current_mount;
  if (!identity || identity->fd < 3 || fstat(identity->fd, &state) < 0 || mount_id(identity->fd, &current_mount) < 0 ||
      (regular ? !S_ISREG(state.st_mode) : !S_ISDIR(state.st_mode)) || (regular && state.st_nlink != 1) ||
      state.st_dev != identity->device || state.st_ino != identity->inode || current_mount != identity->mount_id ||
      state.st_uid != identity->owner_uid || state.st_gid != identity->owner_gid ||
      (state.st_mode & 07777) != identity->mode) { errno = EPERM; return -1; }
  if (hash_content) { char actual[65]; if (!lower_hex(identity->content_sha256, 64) || read_hash(identity->fd, actual) < 0 || strcmp(actual, identity->content_sha256)) { errno = ESTALE; return -1; } }
  return 0;
}

static const struct rtee_handle_entry *entry(const struct rtee_context *context, enum rtee_handle_role role) {
  for (size_t index = 0; index < context->handle_count; index++) if (context->handles[index].role == role) return &context->handles[index];
  return NULL;
}

static int credential_admitted(const struct rtee_context *context, enum rtee_role role) {
  const struct rtee_handle_entry *left = entry(context, role == RTEE_ROLE_POSTGRES ? RTEE_HANDLE_POSTGRES_PASSWORD : RTEE_HANDLE_MINIO_ROOT_PASSWORD);
  const struct rtee_handle_entry *right = role == RTEE_ROLE_MINIO ? entry(context, RTEE_HANDLE_MINIO_ROOT_USER) : left;
  return left && right && left->admitted && right->admitted;
}

int rtee_context_init(struct rtee_context *context, const void *immutable_acquired_frame, size_t immutable_acquired_frame_size,
    struct rtea_session *authority_session, const struct rtee_enrollment *enrollment,
    const struct rtee_handle_entry *handles, size_t handle_count,
    const struct rtee_descriptor_identity *binds, size_t bind_count) {
  struct rtea_request immutable_acquired_request; char expected_proof[65];
  const char session_prefix[]="rtea:v1:session:";
  if (!context || !immutable_acquired_frame || !immutable_acquired_frame_size || !authority_session || !enrollment || !handles ||
      rtea_parse_request(immutable_acquired_frame,immutable_acquired_frame_size,&immutable_acquired_request)<0 ||
      strncmp(authority_session->session_handle,session_prefix,sizeof(session_prefix)-1) ||
      sha256_parts(immutable_acquired_frame,immutable_acquired_frame_size,
        authority_session->session_handle+sizeof(session_prefix)-1,strlen(authority_session->session_handle+sizeof(session_prefix)-1),expected_proof)<0 ||
      strcmp(expected_proof,authority_session->lease_proof_sha256) || authority_session->operation!=immutable_acquired_request.operation ||
      authority_session->readonly!=(immutable_acquired_request.operation==RTEA_OPERATION_INSPECT) ||
      handle_count != 16 || bind_count > RTEE_MAX_BINDS || authority_session->authority_fd < 0 ||
      authority_session->peer_channel_fd < 0 || authority_session->supervisor_generation != immutable_acquired_request.supervisor_generation ||
      strcmp(authority_session->authority_instance_sha256, immutable_acquired_request.supervisor_instance_sha256) ||
      strcmp(authority_session->challenge_nonce,immutable_acquired_request.challenge_nonce) ||
      strcmp(enrollment->profile_sha256, immutable_acquired_request.profile_sha256) ||
      strcmp(enrollment->admission_sha256, immutable_acquired_request.admission_sha256) ||
      !handle(enrollment->profile_handle) || enrollment->asset_count != RTEE_MAX_ASSETS) { errno = EACCES; return -1; }
  memset(context, 0, sizeof(*context)); context->acquired_request = immutable_acquired_request;
  context->authority_session.authority_fd = -1; context->authority_session.peer_channel_fd = -1;
  context->enrollment = *enrollment; context->joined = 1;
  context->enrollment.executable.fd = -1; context->enrollment.client_config.fd = -1;
  for (size_t index = 0; index < RTEE_MAX_ASSETS; index++) context->enrollment.assets[index].descriptor.fd = -1;
  for (size_t index = 0; index < RTEE_MAX_BINDS; index++) context->binds[index].fd = -1;
  unsigned seen = 0;
  for (size_t index = 0; index < handle_count; index++) {
    if (handles[index].role < RTEE_HANDLE_PROFILE || handles[index].role > RTEE_HANDLE_MINIO_BOOTSTRAP ||
        seen & (1u << handles[index].role) || !handle(handles[index].handle) || !lower_hex(handles[index].identity_sha256, 64) ||
        !handles[index].admitted) { errno = EACCES; goto fail; }
    seen |= 1u << handles[index].role; context->handles[index] = handles[index];
  }
  context->handle_count = handle_count;
  const struct rtee_handle_entry *profile_entry = entry(context, RTEE_HANDLE_PROFILE);
  if (!profile_entry || strcmp(profile_entry->handle, enrollment->profile_handle)) { errno = EACCES; goto fail; }
  context->enrollment.executable.fd = fcntl(enrollment->executable.fd, F_DUPFD_CLOEXEC, 3);
  context->enrollment.client_config.fd = fcntl(enrollment->client_config.fd, F_DUPFD_CLOEXEC, 3);
  if (context->enrollment.executable.fd < 0 || context->enrollment.client_config.fd < 0 ||
      verify_descriptor(&context->enrollment.executable, 1, 1) < 0 || verify_descriptor(&context->enrollment.client_config, 0, 0) < 0) goto fail;
  unsigned char elf[5]; if (pread(context->enrollment.executable.fd, elf, sizeof(elf), 0) != (ssize_t)sizeof(elf) ||
      memcmp(elf, "\x7f" "ELF", 4) || elf[4] != 2) { errno = ENOEXEC; goto fail; }
  for (size_t index = 0; index < enrollment->asset_count; index++) {
    if (enrollment->assets[index].dispatch_enabled || (int)enrollment->assets[index].role != RTEE_HANDLE_POSTGRES_CONFIG + (int)index) { errno = EACCES; goto fail; }
    context->enrollment.assets[index].descriptor.fd = fcntl(enrollment->assets[index].descriptor.fd, F_DUPFD_CLOEXEC, 3);
    if (context->enrollment.assets[index].descriptor.fd < 0 || verify_descriptor(&context->enrollment.assets[index].descriptor, 1, 1) < 0) goto fail;
  }
  for (size_t index = 0; index < bind_count; index++) {
    context->binds[index] = binds[index]; context->binds[index].fd = fcntl(binds[index].fd, F_DUPFD_CLOEXEC, 3);
    if (context->binds[index].fd < 0 || verify_descriptor(&context->binds[index], 0, 0) < 0 ||
        !lower_hex(context->binds[index].allocation_ledger_head_sha256, 64)) goto fail;
    for (size_t prior = 0; prior < index; prior++) if (context->binds[prior].device == context->binds[index].device &&
        context->binds[prior].inode == context->binds[index].inode && context->binds[prior].mount_id == context->binds[index].mount_id) { errno = EEXIST; goto fail; }
  }
  context->bind_count = bind_count;
  int retained_authority = fcntl(authority_session->authority_fd, F_DUPFD_CLOEXEC, 3);
  int retained_peer = fcntl(authority_session->peer_channel_fd, F_DUPFD_CLOEXEC, 3);
  if (retained_authority < 0 || retained_peer < 0) {
    if (retained_authority >= 0) close(retained_authority);
    if (retained_peer >= 0) close(retained_peer);
    goto fail;
  }
  context->authority_session = *authority_session;
  context->authority_session.authority_fd = retained_authority; context->authority_session.peer_channel_fd = retained_peer;
  close(authority_session->authority_fd); close(authority_session->peer_channel_fd);
  authority_session->authority_fd = -1; authority_session->peer_channel_fd = -1;
#ifdef RECOVERY_TARGET_ENGINE_EXECUTOR_TESTING
  if (prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) < 0) goto fail;
#endif
  return 0;
fail:
  (void)rtee_context_close(context); return -1;
}

static int next_value(const char **cursor, const char *end, const char *key, char *output, size_t capacity) {
  size_t key_length = strlen(key); const char *start = *cursor;
  if ((size_t)(end - start) <= key_length || memcmp(start, key, key_length)) return 0;
  start += key_length; const char *newline = memchr(start, '\n', (size_t)(end - start));
  size_t length = newline ? (size_t)(newline - start) : capacity;
  if (!newline || !length || length >= capacity || memchr(start, '\0', length)) return 0;
  memcpy(output, start, length); output[length] = '\0'; *cursor = newline + 1; return 1;
}
static int next_u64(const char **cursor, const char *end, const char *key, uint64_t *output) { char value[32]; return next_value(cursor, end, key, value, sizeof(value)) && u64(value, output); }

int rtee_parse_command(const void *frame, size_t frame_size, struct rtee_command *command) {
  if (!frame || !command || !frame_size || frame_size > RTEE_MAX_COMMAND_BYTES) { errno = EMSGSIZE; return -1; }
  const char *cursor = frame, *end = cursor + frame_size; char format[80], operation[40], role[16]; memset(command, 0, sizeof(*command));
  if (cursor[frame_size - 1] != '\n' || memchr(cursor, '\r', frame_size) || memchr(cursor, '\0', frame_size) ||
      !next_value(&cursor,end,"format=",format,sizeof(format)) || strcmp(format,"darshan-recovery-target-native-engine-command-v3") ||
      !next_value(&cursor,end,"operation=",operation,sizeof(operation)) ||
      !next_value(&cursor,end,"command_id=",command->command_id,sizeof(command->command_id)) ||
      !next_value(&cursor,end,"operation_id=",command->operation_id,sizeof(command->operation_id)) ||
      !next_value(&cursor,end,"target_handle=",command->target_handle,sizeof(command->target_handle)) ||
      !next_u64(&cursor,end,"generation=",&command->generation) ||
      !next_value(&cursor,end,"role=",role,sizeof(role)) ||
      !next_value(&cursor,end,"resource_handle=",command->resource_handle,sizeof(command->resource_handle)) ||
      !next_value(&cursor,end,"profile_sha256=",command->profile_sha256,sizeof(command->profile_sha256)) ||
      !next_value(&cursor,end,"admission_sha256=",command->admission_sha256,sizeof(command->admission_sha256)) ||
      !next_value(&cursor,end,"request_sha256=",command->request_sha256,sizeof(command->request_sha256)) ||
      !next_value(&cursor,end,"authorization_sha256=",command->authorization_sha256,sizeof(command->authorization_sha256)) ||
      !next_value(&cursor,end,"command_nonce=",command->command_nonce,sizeof(command->command_nonce)) ||
      !next_value(&cursor,end,"materialization_head_sha256=",command->materialization_head_sha256,sizeof(command->materialization_head_sha256)) ||
      !next_u64(&cursor,end,"deadline_unix_ms=",&command->deadline_unix_ms) ||
      !next_value(&cursor,end,"authority_instance_sha256=",command->authority_instance_sha256,sizeof(command->authority_instance_sha256)) ||
      !next_u64(&cursor,end,"authority_deadline_unix_ms=",&command->authority_deadline_unix_ms) ||
      !next_u64(&cursor,end,"supervisor_generation=",&command->supervisor_generation) || cursor != end) { errno = EPROTO; return -1; }
  if (!strcmp(operation,"INSPECT_TARGET")) command->operation=RTEE_OPERATION_INSPECT_TARGET;
  else if (!strcmp(operation,"ENSURE_INTERNAL_NETWORK")) command->operation=RTEE_OPERATION_ENSURE_INTERNAL_NETWORK;
  else if (!strcmp(operation,"CREATE_POSTGRES")) command->operation=RTEE_OPERATION_CREATE_POSTGRES;
  else if (!strcmp(operation,"CREATE_MINIO")) command->operation=RTEE_OPERATION_CREATE_MINIO;
  else { errno=ENOTSUP; return -1; }
  if (!strcmp(role,"NONE")) command->role=RTEE_ROLE_NONE; else if (!strcmp(role,"NETWORK")) command->role=RTEE_ROLE_NETWORK;
  else if (!strcmp(role,"POSTGRES")) command->role=RTEE_ROLE_POSTGRES; else if (!strcmp(role,"MINIO")) command->role=RTEE_ROLE_MINIO; else { errno=EPROTO; return -1; }
  enum rtee_role expected = command->operation==RTEE_OPERATION_INSPECT_TARGET?RTEE_ROLE_NONE:
    command->operation==RTEE_OPERATION_ENSURE_INTERNAL_NETWORK?RTEE_ROLE_NETWORK:
    command->operation==RTEE_OPERATION_CREATE_POSTGRES?RTEE_ROLE_POSTGRES:RTEE_ROLE_MINIO;
  if (command->role != expected || !uuid(command->command_id) || !uuid(command->operation_id) || !handle(command->target_handle) ||
      !handle(command->resource_handle) || !command->generation || !lower_hex(command->profile_sha256,64) ||
      !lower_hex(command->admission_sha256,64) || !lower_hex(command->request_sha256,64) ||
      !lower_hex(command->authorization_sha256,64) || !lower_hex(command->command_nonce,32) ||
      !lower_hex(command->materialization_head_sha256,64) || !lower_hex(command->authority_instance_sha256,64) ||
      !command->deadline_unix_ms || !command->authority_deadline_unix_ms || !command->supervisor_generation) { errno=EPROTO; return -1; }
  return 0;
}

static int boolean(const char *value, int *output) { if (!strcmp(value,"true")){*output=1;return 1;} if(!strcmp(value,"false")){*output=0;return 1;} return 0; }
static int state(const char *value, int *output) {
  const char *states[]={"","ABSENT","CREATED","STOPPED","RUNNING","ERROR"}; for(int index=1;index<=5;index++)if(!strcmp(value,states[index])){*output=index;return 1;}return 0;
}
static int configuration(const char *value, int *output) {
  const char *states[]={"","MATCH","MISMATCH","INCOMPLETE"};for(int index=1;index<=3;index++)if(!strcmp(value,states[index])){*output=index;return 1;}return 0;
}
static int nullable_copy(const char *value,char *output,size_t capacity) { if(!strcmp(value,"null")){output[0]='\0';return 1;}size_t size=strlen(value);if(!size||size>=capacity)return 0;memcpy(output,value,size+1);return 1; }
static int projection(const char **cursor,const char *end,const char *prefix,enum rtee_role role,struct rtee_resource_projection *result) {
  char key[96],value[160];result->role=role;
#define NEXT(name, field, cap) do { if(snprintf(key,sizeof(key),"%s_" name "=",prefix)<=0||!next_value(cursor,end,key,field,cap))return 0; } while(0)
  NEXT("state",value,sizeof(value));if(!state(value,(int *)&result->state))return 0;
  NEXT("configuration",value,sizeof(value));if(!configuration(value,(int *)&result->configuration))return 0;
  NEXT("readiness",value,sizeof(value));if(strcmp(value,"NOT_EVALUATED"))return 0;
  NEXT("resource_id",value,sizeof(value));if(!nullable_copy(value,result->resource_id,sizeof(result->resource_id)))return 0;
  NEXT("image_id",value,sizeof(value));if(!nullable_copy(value,result->image_id,sizeof(result->image_id)))return 0;
  NEXT("image_config_sha256",value,sizeof(value));if(!nullable_copy(value,result->image_config_sha256,sizeof(result->image_config_sha256)))return 0;
  NEXT("effective_configuration_sha256",value,sizeof(value));if(!nullable_copy(value,result->effective_configuration_sha256,sizeof(result->effective_configuration_sha256)))return 0;
  NEXT("owner_labels_sha256",value,sizeof(value));if(!nullable_copy(value,result->owner_labels_sha256,sizeof(result->owner_labels_sha256)))return 0;
  NEXT("consumer_set_sha256",value,sizeof(value));if(!nullable_copy(value,result->consumer_set_sha256,sizeof(result->consumer_set_sha256)))return 0;
  NEXT("daemon_identity_sha256",value,sizeof(value));if(!nullable_copy(value,result->daemon_identity_sha256,sizeof(result->daemon_identity_sha256)))return 0;
  NEXT("error_sha256",value,sizeof(value));if(!nullable_copy(value,result->error_sha256,sizeof(result->error_sha256)))return 0;
#undef NEXT
  int absent=result->state==RTEE_RESOURCE_ABSENT;
  if(absent!=(result->resource_id[0]=='\0') || (absent&&(result->image_id[0]||result->image_config_sha256[0]||result->effective_configuration_sha256[0]||result->owner_labels_sha256[0]||result->daemon_identity_sha256[0])) ||
      (result->state==RTEE_RESOURCE_ERROR)!=(result->error_sha256[0]!='\0') ||
      (!absent&&(!lower_hex(result->resource_id,64)||!lower_hex(result->image_config_sha256,64)||
      !lower_hex(result->effective_configuration_sha256,64)||!lower_hex(result->owner_labels_sha256,64)||
      !lower_hex(result->consumer_set_sha256,64)||!lower_hex(result->daemon_identity_sha256,64))) ||
      (result->image_id[0]&&(strlen(result->image_id)!=71||memcmp(result->image_id,"sha256:",7)||!lower_hex(result->image_id+7,64))))return 0;
  return 1;
}

int rtee_parse_inspection_projection(const void *bytes, size_t size, struct rtee_inspection *inspection) {
  if(!bytes||!inspection||!size||size>RTEE_MAX_INSPECTION_BYTES){errno=EMSGSIZE;return -1;}const char *cursor=bytes,*end=cursor+size;char value[128];memset(inspection,0,sizeof(*inspection));
  char generation[32],operation[40],role[16];
  if(cursor[size-1]!='\n'||memchr(cursor,'\r',size)||memchr(cursor,'\0',size)||
      !next_value(&cursor,end,"format=",value,sizeof(value))||strcmp(value,"darshan-recovery-target-native-engine-inspect-v3")||
      !next_value(&cursor,end,"operation_id=",inspection->operation_id,sizeof(inspection->operation_id))||!uuid(inspection->operation_id)||
      !next_value(&cursor,end,"target_handle=",inspection->target_handle,sizeof(inspection->target_handle))||!handle(inspection->target_handle)||
      !next_value(&cursor,end,"generation=",generation,sizeof(generation))||!u64(generation,&inspection->generation)||!inspection->generation||
      !next_value(&cursor,end,"profile_sha256=",inspection->profile_sha256,sizeof(inspection->profile_sha256))||!lower_hex(inspection->profile_sha256,64)||
      !next_value(&cursor,end,"admission_sha256=",inspection->admission_sha256,sizeof(inspection->admission_sha256))||!lower_hex(inspection->admission_sha256,64)||
      !next_value(&cursor,end,"command_sha256=",inspection->command_sha256,sizeof(inspection->command_sha256))||!lower_hex(inspection->command_sha256,64)||
      !next_value(&cursor,end,"operation=",operation,sizeof(operation))||
      !next_value(&cursor,end,"role=",role,sizeof(role))||
      !next_value(&cursor,end,"resource_handle=",inspection->resource_handle,sizeof(inspection->resource_handle))||!handle(inspection->resource_handle)||
      !next_value(&cursor,end,"command_nonce=",inspection->command_nonce,sizeof(inspection->command_nonce))||!lower_hex(inspection->command_nonce,32)||
      !next_value(&cursor,end,"materialization_head_sha256=",inspection->materialization_head_sha256,sizeof(inspection->materialization_head_sha256))||!lower_hex(inspection->materialization_head_sha256,64)||
      !next_value(&cursor,end,"observation_complete=",value,sizeof(value))||!boolean(value,&inspection->observation_complete)||
      !next_value(&cursor,end,"absence_reliable=",value,sizeof(value))||!boolean(value,&inspection->absence_reliable)||
      !next_value(&cursor,end,"containers_complete=",value,sizeof(value))||!boolean(value,&inspection->containers_complete)||
      !next_value(&cursor,end,"networks_complete=",value,sizeof(value))||!boolean(value,&inspection->networks_complete)||
      !next_value(&cursor,end,"mounts_complete=",value,sizeof(value))||!boolean(value,&inspection->mounts_complete)||
      !next_value(&cursor,end,"consumers_complete=",value,sizeof(value))||!boolean(value,&inspection->consumers_complete)||
      !next_value(&cursor,end,"daemon_complete=",value,sizeof(value))||!boolean(value,&inspection->daemon_complete)||
      !projection(&cursor,end,"network",RTEE_ROLE_NETWORK,&inspection->network)||
      !projection(&cursor,end,"postgres",RTEE_ROLE_POSTGRES,&inspection->postgres)||
      !projection(&cursor,end,"minio",RTEE_ROLE_MINIO,&inspection->minio)||cursor!=end){errno=EPROTO;return -1;}
  if(!strcmp(operation,"INSPECT_TARGET"))inspection->operation=RTEE_OPERATION_INSPECT_TARGET;
  else if(!strcmp(operation,"ENSURE_INTERNAL_NETWORK"))inspection->operation=RTEE_OPERATION_ENSURE_INTERNAL_NETWORK;
  else if(!strcmp(operation,"CREATE_POSTGRES"))inspection->operation=RTEE_OPERATION_CREATE_POSTGRES;
  else if(!strcmp(operation,"CREATE_MINIO"))inspection->operation=RTEE_OPERATION_CREATE_MINIO;
  else {errno=EPROTO;return-1;}
  if(!strcmp(role,"NONE"))inspection->role=RTEE_ROLE_NONE;else if(!strcmp(role,"NETWORK"))inspection->role=RTEE_ROLE_NETWORK;
  else if(!strcmp(role,"POSTGRES"))inspection->role=RTEE_ROLE_POSTGRES;else if(!strcmp(role,"MINIO"))inspection->role=RTEE_ROLE_MINIO;else{errno=EPROTO;return-1;}
  enum rtee_role expected=inspection->operation==RTEE_OPERATION_INSPECT_TARGET?RTEE_ROLE_NONE:inspection->operation==RTEE_OPERATION_ENSURE_INTERNAL_NETWORK?RTEE_ROLE_NETWORK:inspection->operation==RTEE_OPERATION_CREATE_POSTGRES?RTEE_ROLE_POSTGRES:RTEE_ROLE_MINIO;
  if(inspection->role!=expected){errno=EPROTO;return-1;}
  if(inspection->absence_reliable&&(!inspection->observation_complete||!inspection->containers_complete||!inspection->networks_complete||
      !inspection->mounts_complete||!inspection->consumers_complete||!inspection->daemon_complete||inspection->network.state!=RTEE_RESOURCE_ABSENT||
      inspection->postgres.state!=RTEE_RESOURCE_ABSENT||inspection->minio.state!=RTEE_RESOURCE_ABSENT)){errno=EPROTO;return -1;}
  return 0;
}

static uint64_t now_unix_ms(void){struct timespec now;if(clock_gettime(CLOCK_REALTIME,&now)<0)return 0;return(uint64_t)now.tv_sec*1000u+(uint64_t)now.tv_nsec/1000000u;}
static int stale_or_cancelled(struct rtee_context *context,int cancellation_fd,uint64_t deadline){
  if(!now_unix_ms()||now_unix_ms()>=deadline){errno=ETIMEDOUT;return 1;}struct stat authority_state;
  if(context->authority_session.authority_fd<0||context->authority_session.peer_channel_fd<0||
      context->authority_session.supervisor_generation!=context->acquired_request.supervisor_generation||
      strcmp(context->authority_session.authority_instance_sha256,context->acquired_request.supervisor_instance_sha256)||
      fstat(context->authority_session.authority_fd,&authority_state)<0||
      (uint64_t)authority_state.st_dev!=context->authority_session.authority_dev||
      (uint64_t)authority_state.st_ino!=context->authority_session.authority_ino){errno=ESTALE;return 1;}
  struct pollfd fds[2]={{.fd=context->authority_session.peer_channel_fd,.events=POLLRDHUP|POLLHUP},{.fd=cancellation_fd,.events=POLLIN|POLLRDHUP|POLLHUP}};
  int count=cancellation_fd>=0?2:1,result;do{result=poll(fds,(nfds_t)count,0);}while(result<0&&errno==EINTR);if(result<0)return-1;
  if(result&&((fds[0].revents&(POLLRDHUP|POLLHUP|POLLERR|POLLNVAL))||(count==2&&fds[1].revents))){errno=ECANCELED;return 1;}return 0;
}

static int validate_command_context(struct rtee_context *context,const struct rtee_command *command){
  enum rtee_handle_role required=command->role==RTEE_ROLE_NETWORK?RTEE_HANDLE_NETWORK:command->role==RTEE_ROLE_POSTGRES?RTEE_HANDLE_POSTGRES:
    command->role==RTEE_ROLE_MINIO?RTEE_HANDLE_MINIO:RTEE_HANDLE_PROFILE;const struct rtee_handle_entry *mapped=entry(context,required);
  if(!mapped||strcmp(mapped->handle,command->resource_handle)||strcmp(command->target_handle,context->enrollment.profile_handle)||
      strcmp(command->operation_id,context->acquired_request.operation_id)||command->generation!=context->acquired_request.generation||
      strcmp(command->profile_sha256,context->acquired_request.profile_sha256)||strcmp(command->admission_sha256,context->acquired_request.admission_sha256)||
      strcmp(command->request_sha256,context->acquired_request.request_sha256)||
      strcmp(command->authorization_sha256,context->acquired_request.authorization_sha256)||
      strcmp(command->authority_instance_sha256,context->acquired_request.supervisor_instance_sha256)||
      command->authority_deadline_unix_ms!=context->acquired_request.deadline_unix_ms||
      command->deadline_unix_ms>context->acquired_request.deadline_unix_ms||
      command->supervisor_generation!=context->acquired_request.supervisor_generation||
      (command->operation!=RTEE_OPERATION_INSPECT_TARGET&&(context->acquired_request.operation!=RTEA_OPERATION_PREPARE||context->authority_session.readonly))||
      ((command->role==RTEE_ROLE_POSTGRES||command->role==RTEE_ROLE_MINIO)&&!credential_admitted(context,command->role))){errno=EACCES;return-1;}
  return 0;
}

#ifdef RECOVERY_TARGET_ENGINE_EXECUTOR_TESTING
static int ownership_sha256(const struct rtee_command *command,char output[65]){
  const char *role=command->role==RTEE_ROLE_NETWORK?"NETWORK":command->role==RTEE_ROLE_POSTGRES?"POSTGRES":command->role==RTEE_ROLE_MINIO?"MINIO":"NONE";
  char canonical[2048];int length=snprintf(canonical,sizeof(canonical),"{\"com.darshan.recovery.command-nonce\":\"%s\",\"com.darshan.recovery.generation\":\"%llu\",\"com.darshan.recovery.operation-id\":\"%s\",\"com.darshan.recovery.owner\":\"darshan-recovery\",\"com.darshan.recovery.profile-sha256\":\"%s\",\"com.darshan.recovery.resource-handle\":\"%s\",\"com.darshan.recovery.role\":\"%s\",\"com.darshan.recovery.target-handle\":\"%s\"}\n",
    command->command_nonce,(unsigned long long)command->generation,command->operation_id,command->profile_sha256,command->resource_handle,role,command->target_handle);
  if(length<=0||(size_t)length>=sizeof(canonical)){errno=E2BIG;return-1;}return sha256(canonical,(size_t)length,output);
}

static int validate_inspection_context(struct rtee_context *context,const struct rtee_command *command,
    const char command_sha[65],const struct rtee_inspection *inspection){
  char expected_owner[65],expected_consumers[65];
  if(ownership_sha256(command,expected_owner)<0||sha256("[]\n",3,expected_consumers)<0)return-1;
  if(strcmp(inspection->operation_id,command->operation_id)||strcmp(inspection->target_handle,command->target_handle)||
      inspection->generation!=command->generation||strcmp(inspection->profile_sha256,command->profile_sha256)||
      strcmp(inspection->admission_sha256,command->admission_sha256)||strcmp(inspection->command_sha256,command_sha)||
      inspection->operation!=command->operation||inspection->role!=command->role||
      strcmp(inspection->resource_handle,command->resource_handle)||strcmp(inspection->command_nonce,command->command_nonce)||
      strcmp(inspection->materialization_head_sha256,command->materialization_head_sha256)){errno=EACCES;return-1;}
  const struct rtee_resource_projection *selected=command->role==RTEE_ROLE_NETWORK?&inspection->network:
    command->role==RTEE_ROLE_POSTGRES?&inspection->postgres:command->role==RTEE_ROLE_MINIO?&inspection->minio:NULL;
  if(!selected){
    if(!inspection->absence_reliable||inspection->network.state!=RTEE_RESOURCE_ABSENT||
        inspection->postgres.state!=RTEE_RESOURCE_ABSENT||inspection->minio.state!=RTEE_RESOURCE_ABSENT){errno=EPROTO;return-1;}
    return 0;
  }
  const char *expected_image=command->role==RTEE_ROLE_POSTGRES?context->enrollment.postgres_image_id:
    command->role==RTEE_ROLE_MINIO?context->enrollment.minio_image_id:"";
  const char *expected_image_config=command->role==RTEE_ROLE_POSTGRES?context->enrollment.postgres_image_config_sha256:
    command->role==RTEE_ROLE_MINIO?context->enrollment.minio_image_config_sha256:context->enrollment.network_configuration_sha256;
  const char *expected_config=command->role==RTEE_ROLE_POSTGRES?context->enrollment.postgres_configuration_sha256:
    command->role==RTEE_ROLE_MINIO?context->enrollment.minio_configuration_sha256:context->enrollment.network_configuration_sha256;
  if(!inspection->observation_complete||!inspection->containers_complete||!inspection->networks_complete||
      !inspection->mounts_complete||!inspection->consumers_complete||!inspection->daemon_complete||
      selected->state!=RTEE_RESOURCE_CREATED||selected->configuration!=RTEE_CONFIG_MATCH||
      strcmp(selected->image_id,expected_image)||strcmp(selected->image_config_sha256,expected_image_config)||
      strcmp(selected->effective_configuration_sha256,expected_config)||strcmp(selected->owner_labels_sha256,expected_owner)||
      strcmp(selected->consumer_set_sha256,expected_consumers)||strcmp(selected->daemon_identity_sha256,context->enrollment.daemon_identity_sha256)){
    errno=EACCES;return-1;
  }
  const struct rtee_resource_projection *all[3]={&inspection->network,&inspection->postgres,&inspection->minio};
  for(size_t left=0;left<3;left++)for(size_t right=left+1;right<3;right++)
    if(all[left]->resource_id[0]&&all[right]->resource_id[0]&&!strcmp(all[left]->resource_id,all[right]->resource_id)){errno=EEXIST;return-1;}
  return 0;
}
#endif

static int all_descriptors_stable(struct rtee_context *context){
  if(verify_descriptor(&context->enrollment.executable,1,1)<0||verify_descriptor(&context->enrollment.client_config,0,0)<0)return-1;
  for(size_t index=0;index<context->enrollment.asset_count;index++)if(verify_descriptor(&context->enrollment.assets[index].descriptor,1,1)<0)return-1;
  for(size_t index=0;index<context->bind_count;index++)
    if(verify_descriptor(&context->binds[index],0,0)<0)return-1;
  return 0;
}

#ifdef RECOVERY_TARGET_ENGINE_EXECUTOR_TESTING
struct rtee_adopted { pid_t pid; char start_identity[32]; };
static int pid_start_identity(pid_t pid,char output[32]){
  char path[64];if(snprintf(path,sizeof(path),"/proc/%ld/stat",(long)pid)<=0)return-1;int fd=open(path,O_RDONLY|O_CLOEXEC);if(fd<0)return-1;
  char bytes[1024];ssize_t length=read(fd,bytes,sizeof(bytes)-1);close(fd);if(length<=0)return-1;bytes[length]='\0';char *cursor=strrchr(bytes,')');
  if(!cursor||cursor[1]!=' '){errno=EPROTO;return-1;}cursor+=2;for(unsigned field=3;field<22;field++){cursor=strchr(cursor,' ');if(!cursor){errno=EPROTO;return-1;}while(*cursor==' ')cursor++;}
  char *end=strchr(cursor,' ');if(!end)end=bytes+length;size_t size=(size_t)(end-cursor);if(!size||size>=32){errno=EPROTO;return-1;}
  for(size_t index=0;index<size;index++)if(cursor[index]<'0'||cursor[index]>'9'){errno=EPROTO;return-1;}
  memcpy(output,cursor,size);output[size]='\0';return 0;
}
static int signal_adopted(struct rtee_adopted *adopted,size_t count,int signal_number){
  for(size_t index=0;index<count;index++){char current[32];if(pid_start_identity(adopted[index].pid,current)<0){if(errno==ENOENT||errno==ESRCH)continue;return-1;}
    if(strcmp(current,adopted[index].start_identity)){errno=ESTALE;return-1;}if(kill(adopted[index].pid,signal_number)<0&&errno!=ESRCH)return-1;}return 0;
}
static int drain_children(pid_t pid,pid_t pgid,int *direct_status,int *direct_seen){
  int status;pid_t result;struct rtee_adopted adopted[64];size_t adopted_count=0;
  for(unsigned round=0;round<200;round++){
    for(;;){do{result=waitpid(-1,&status,WNOHANG);}while(result<0&&errno==EINTR);if(result<=0)break;
      if(result==pid){if(direct_seen&&*direct_seen){errno=EPROTO;return-1;}if(direct_status)*direct_status=status;if(direct_seen)*direct_seen=1;}
      else{size_t match=adopted_count;for(size_t index=0;index<adopted_count;index++)if(adopted[index].pid==result){match=index;break;}
        if(match==adopted_count){errno=ECHILD;return-1;}adopted[match]=adopted[--adopted_count];}}
    int waitpid_echild=result<0&&errno==ECHILD;
    char path[96],bytes[4096];(void)snprintf(path,sizeof(path),"/proc/self/task/%ld/children",(long)getpid());int fd=open(path,O_RDONLY|O_CLOEXEC);
    if(fd<0)return-1;
    ssize_t count=read(fd,bytes,sizeof(bytes)-1);close(fd);if(count<0)return-1;bytes[count]='\0';char *cursor=bytes;size_t discovered=0;
    while(*cursor){while(*cursor==' ')cursor++;if(!*cursor)break;char *end=NULL;long child=strtol(cursor,&end,10);if(end==cursor||child<=0){errno=EPROTO;return-1;}cursor=end;discovered++;
      if((pid_t)child==pid)continue;
      size_t match=adopted_count;for(size_t index=0;index<adopted_count;index++)if(adopted[index].pid==(pid_t)child){match=index;break;}
      if(match==adopted_count){if(adopted_count>=64){errno=E2BIG;return-1;}adopted[adopted_count].pid=(pid_t)child;if(pid_start_identity((pid_t)child,adopted[adopted_count].start_identity)<0)return-1;adopted_count++;}
      else{char current[32];if(pid_start_identity((pid_t)child,current)<0||strcmp(current,adopted[match].start_identity)){errno=ESTALE;return-1;}}}
    int group_alive=kill(-pgid,0)==0||errno==EPERM;if(!group_alive&&errno!=ESRCH)return-1;
    if(waitpid_echild&&discovered==0&&!group_alive&&adopted_count==0)return 0;
    if(round==20){if(kill(-pgid,SIGTERM)<0&&errno!=ESRCH)return-1;if(signal_adopted(adopted,adopted_count,SIGTERM)<0)return-1;}
    if(round>=80){if(kill(-pgid,SIGKILL)<0&&errno!=ESRCH)return-1;if(signal_adopted(adopted,adopted_count,SIGKILL)<0)return-1;}
    const struct timespec pause={0,10000000};(void)nanosleep(&pause,NULL);
  }errno=EBUSY;return-1;
}

static int run_fixture(struct rtee_context *context,const struct rtee_command *command,const char command_sha[65],int cancellation_fd,char output[RTEE_MAX_INSPECTION_BYTES],size_t *output_size){
  int pipefd[2];if(pipe2(pipefd,O_CLOEXEC|O_NONBLOCK)<0)return-1;pid_t pid=fork();if(pid==0){(void)setpgid(0,0);close(pipefd[0]);if(dup2(pipefd[1],STDOUT_FILENO)<0)_exit(78);close(pipefd[1]);
    int executable_fd=context->enrollment.executable.fd;
    if(executable_fd!=3){if(dup3(executable_fd,3,O_CLOEXEC)<0)_exit(78);executable_fd=3;}
    if(syscall(SYS_close_range,4U,~0U,0)<0||prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)<0)_exit(78);
    const char *operation=command->operation==RTEE_OPERATION_INSPECT_TARGET?"INSPECT_TARGET":command->operation==RTEE_OPERATION_ENSURE_INTERNAL_NETWORK?"ENSURE_INTERNAL_NETWORK":command->operation==RTEE_OPERATION_CREATE_POSTGRES?"CREATE_POSTGRES":"CREATE_MINIO";
    const char *role=command->role==RTEE_ROLE_NETWORK?"NETWORK":command->role==RTEE_ROLE_POSTGRES?"POSTGRES":command->role==RTEE_ROLE_MINIO?"MINIO":"NONE";
    const char *image=command->role==RTEE_ROLE_MINIO?context->enrollment.minio_image_id:context->enrollment.postgres_image_id;
    const char *image_config=command->role==RTEE_ROLE_MINIO?context->enrollment.minio_image_config_sha256:command->role==RTEE_ROLE_POSTGRES?context->enrollment.postgres_image_config_sha256:context->enrollment.network_configuration_sha256;
    const char *configuration_hash=command->role==RTEE_ROLE_MINIO?context->enrollment.minio_configuration_sha256:command->role==RTEE_ROLE_POSTGRES?context->enrollment.postgres_configuration_sha256:context->enrollment.network_configuration_sha256;
    char owner[65],consumers[65];if(ownership_sha256(command,owner)<0||sha256("[]\n",3,consumers)<0)_exit(78);
    char op[64],operation_id[64],target[160],generation[64],profile[96],admission[96],command_arg[96],role_arg[32],resource[160],nonce[64],head[96],owner_arg[96],daemon[96],image_arg[112],image_config_arg[96],configuration_arg[96],consumers_arg[96],delay_arg[32],exit_arg[32];
    (void)snprintf(op,sizeof(op),"--fixed-operation=%s",operation);(void)snprintf(operation_id,sizeof(operation_id),"--operation-id=%s",command->operation_id);(void)snprintf(target,sizeof(target),"--target-handle=%s",command->target_handle);
    (void)snprintf(generation,sizeof(generation),"--generation=%llu",(unsigned long long)command->generation);(void)snprintf(profile,sizeof(profile),"--profile=%s",command->profile_sha256);(void)snprintf(admission,sizeof(admission),"--admission=%s",command->admission_sha256);
    (void)snprintf(command_arg,sizeof(command_arg),"--command-sha=%s",command_sha);(void)snprintf(role_arg,sizeof(role_arg),"--role=%s",role);(void)snprintf(resource,sizeof(resource),"--resource=%s",command->resource_handle);(void)snprintf(nonce,sizeof(nonce),"--nonce=%s",command->command_nonce);(void)snprintf(head,sizeof(head),"--head=%s",command->materialization_head_sha256);
    (void)snprintf(owner_arg,sizeof(owner_arg),"--owner=%s",owner);(void)snprintf(daemon,sizeof(daemon),"--daemon=%s",context->enrollment.daemon_identity_sha256);(void)snprintf(image_arg,sizeof(image_arg),"--image=%s",image);(void)snprintf(image_config_arg,sizeof(image_config_arg),"--image-config=%s",image_config);(void)snprintf(configuration_arg,sizeof(configuration_arg),"--configuration=%s",configuration_hash);(void)snprintf(consumers_arg,sizeof(consumers_arg),"--consumers=%s",consumers);
    unsigned long delay=0;const char *delay_value=getenv("RTEE_TEST_FIXTURE_DELAY_MS");if(delay_value){char *delay_end=NULL;delay=strtoul(delay_value,&delay_end,10);if(!delay_end||*delay_end||delay>1000)_exit(78);} (void)snprintf(delay_arg,sizeof(delay_arg),"--delay-ms=%lu",delay);
    const char *exit_mode=getenv("RTEE_TEST_FIXTURE_EXIT_MODE");if(!exit_mode)exit_mode="success";if(strcmp(exit_mode,"success")&&strcmp(exit_mode,"nonzero")&&strcmp(exit_mode,"signal"))_exit(78);(void)snprintf(exit_arg,sizeof(exit_arg),"--exit-mode=%s",exit_mode);
    char *const argv[]={"darshan-recovery-engine-fixture",op,operation_id,target,generation,profile,admission,command_arg,role_arg,resource,nonce,head,owner_arg,daemon,image_arg,image_config_arg,configuration_arg,consumers_arg,delay_arg,exit_arg,NULL};
    char *const envp[]={"LANG=C","LC_ALL=C","DARSHAN_RECOVERY_FIXED_FIXTURE=1",NULL};syscall(SYS_execveat,executable_fd,"",argv,envp,AT_EMPTY_PATH);_exit(78);}
  close(pipefd[1]);if(pid<0){close(pipefd[0]);return-1;}if(setpgid(pid,pid)<0&&!(errno==EACCES&&getpgid(pid)==pid)){(void)kill(pid,SIGKILL);close(pipefd[0]);(void)waitpid(pid,NULL,0);return-1;}
  context->active_child=1;context->joined=0;context->child_pid=pid;context->child_pgid=pid;size_t total=0;int done=0,status=0,direct_seen=0,failed=0;int failure_errno=0;
  while(!done){int freshness=stale_or_cancelled(context,cancellation_fd,command->deadline_unix_ms);if(freshness!=0){failed=1;break;}struct pollfd readfd={.fd=pipefd[0],.events=POLLIN|POLLHUP};
    int ready=poll(&readfd,1,10);if(ready<0&&errno!=EINTR){failed=1;break;}if(ready>0){ssize_t count=read(pipefd[0],output+total,RTEE_MAX_INSPECTION_BYTES-total);if(count>0)total+=(size_t)count;else if(count==0)done=1;else if(errno!=EAGAIN&&errno!=EINTR){failed=1;break;}if(total==RTEE_MAX_INSPECTION_BYTES){errno=EFBIG;failed=1;break;}}
    pid_t waited=waitpid(pid,&status,WNOHANG);if(waited==pid){direct_seen=1;if(!(readfd.revents&POLLIN))done=1;}else if(waited<0&&errno!=ECHILD&&errno!=EINTR){failed=1;break;}}
  if(failed){failure_errno=errno?errno:EIO;(void)kill(-pid,SIGTERM);}
  int cleanup=drain_children(pid,pid,&status,&direct_seen);
  close(pipefd[0]);
  if(cleanup==0){context->active_child=0;context->joined=1;context->child_pid=0;context->child_pgid=0;}
  else{context->active_child=1;context->joined=0;if(!failure_errno)failure_errno=errno?errno:EIO;}
  if(failed||cleanup<0){errno=failure_errno;return-1;}
  if(getenv("RTEE_TEST_FORGET_DIRECT_STATUS"))direct_seen=0;
  if(!direct_seen){errno=ECHILD;return-1;}
  if(!WIFEXITED(status)||WEXITSTATUS(status)!=0){errno=EIO;return-1;}
  *output_size=total;return 0;
}
#endif

int rtee_dispatch_fixed(struct rtee_context *context,struct rtem_journal *materialization,const void *frame,size_t frame_size,int cancellation_fd,struct rtee_inspection *inspection){
  struct rtee_command command;if(!context||!inspection||rtee_parse_command(frame,frame_size,&command)<0||validate_command_context(context,&command)<0||
      all_descriptors_stable(context)<0||stale_or_cancelled(context,cancellation_fd,command.deadline_unix_ms)!=0)return-1;
  if(context->acquired_request.deadline_unix_ms<command.deadline_unix_ms)command.deadline_unix_ms=context->acquired_request.deadline_unix_ms;
  struct rtem_identity identity={0};struct rtem_publication intent={0};int has_intent=command.operation!=RTEE_OPERATION_INSPECT_TARGET;
  if(has_intent){if(!materialization){errno=EINVAL;return-1;}strcpy(identity.operation_id,command.operation_id);strcpy(identity.target_handle,command.target_handle);identity.generation=command.generation;
    identity.operation=command.operation==RTEE_OPERATION_ENSURE_INTERNAL_NETWORK?RTEM_OPERATION_ENSURE_INTERNAL_NETWORK:command.operation==RTEE_OPERATION_CREATE_POSTGRES?RTEM_OPERATION_CREATE_POSTGRES:RTEM_OPERATION_CREATE_MINIO;
    identity.role=command.role==RTEE_ROLE_NETWORK?RTEM_ROLE_NETWORK:command.role==RTEE_ROLE_POSTGRES?RTEM_ROLE_POSTGRES:RTEM_ROLE_MINIO;strcpy(identity.resource_handle,command.resource_handle);
    strcpy(identity.profile_sha256,command.profile_sha256);strcpy(identity.admission_sha256,command.admission_sha256);if(sha256(frame,frame_size,identity.command_sha256)<0)return-1;strcpy(identity.command_nonce,command.command_nonce);
    if(rtem_publish_intent(materialization,&identity,command.materialization_head_sha256,&intent)<0)return-1;
    if(stale_or_cancelled(context,cancellation_fd,command.deadline_unix_ms)!=0)return-1;}
#ifndef RECOVERY_TARGET_ENGINE_EXECUTOR_TESTING
  (void)cancellation_fd;(void)inspection;(void)intent;errno=ENOSYS;return-1;
#else
  char command_sha[65];if(sha256(frame,frame_size,command_sha)<0)return-1;
  char output[RTEE_MAX_INSPECTION_BYTES];size_t output_size=0;if(run_fixture(context,&command,command_sha,cancellation_fd,output,&output_size)<0)return-1;
  if(stale_or_cancelled(context,cancellation_fd,command.deadline_unix_ms)!=0||rtee_parse_inspection_projection(output,output_size,inspection)<0||
      validate_inspection_context(context,&command,command_sha,inspection)<0||all_descriptors_stable(context)<0)return-1;
  if(has_intent){const struct rtee_resource_projection *selected=command.role==RTEE_ROLE_NETWORK?&inspection->network:command.role==RTEE_ROLE_POSTGRES?&inspection->postgres:&inspection->minio;
    struct rtem_actual_resource actual={0};int complete=inspection->observation_complete&&inspection->containers_complete&&inspection->networks_complete&&inspection->mounts_complete&&inspection->consumers_complete&&inspection->daemon_complete&&selected->configuration==RTEE_CONFIG_MATCH&&selected->resource_id[0];
    if(complete){actual.observed=1;strcpy(actual.resource_id,selected->resource_id);strcpy(actual.image_id,selected->image_id);strcpy(actual.image_config_sha256,selected->image_config_sha256);strcpy(actual.effective_configuration_sha256,selected->effective_configuration_sha256);strcpy(actual.owner_labels_sha256,selected->owner_labels_sha256);strcpy(actual.consumer_set_sha256,selected->consumer_set_sha256);strcpy(actual.daemon_identity_sha256,selected->daemon_identity_sha256);}
    char observation[65];if(stale_or_cancelled(context,cancellation_fd,command.deadline_unix_ms)!=0||sha256(output,output_size,observation)<0||rtem_publish_receipt(materialization,&identity,intent.record_sha256,observation,&actual,complete,&intent)<0)return-1;}
  return stale_or_cancelled(context,cancellation_fd,command.deadline_unix_ms)==0?0:-1;
#endif
}

int rtee_cancel_join_and_release(struct rtee_context *context){
  if(!context||context->authority_session.authority_fd<0){errno=EINVAL;return-1;}
  if(rtee_cancel_join(context)<0)return-1;
  return rtea_release_session(&context->authority_session);
}

int rtee_cancel_join(struct rtee_context *context){
  if(!context){errno=EINVAL;return-1;}if(!context->active_child&&context->joined)return 0;
#ifdef RECOVERY_TARGET_ENGINE_EXECUTOR_TESTING
  if(context->child_pid<=0||context->child_pgid<=0){errno=ESTALE;return-1;}
  (void)kill(-context->child_pgid,SIGTERM);
  int ignored_status=0,ignored_seen=0;if(drain_children(context->child_pid,context->child_pgid,&ignored_status,&ignored_seen)<0)return-1;
  context->active_child=0;context->joined=1;context->child_pid=0;context->child_pgid=0;return 0;
#else
  errno=ENOSYS;return-1;
#endif
}

int rtee_context_close(struct rtee_context *context){
  if(!context)return 0;
  if(context->active_child||!context->joined){errno=EBUSY;return-1;}
  if(context->enrollment.executable.fd>=3)close(context->enrollment.executable.fd);
  if(context->enrollment.client_config.fd>=3)close(context->enrollment.client_config.fd);
  for(size_t index=0;index<context->enrollment.asset_count&&index<RTEE_MAX_ASSETS;index++)if(context->enrollment.assets[index].descriptor.fd>=3)close(context->enrollment.assets[index].descriptor.fd);
  for(size_t index=0;index<context->bind_count&&index<RTEE_MAX_BINDS;index++)if(context->binds[index].fd>=3)close(context->binds[index].fd);
  if(context->authority_session.authority_fd>=0)(void)rtea_release_session(&context->authority_session);
  memset(context,0,sizeof(*context));context->joined=1;return 0;
}

