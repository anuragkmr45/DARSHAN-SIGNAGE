#define _GNU_SOURCE
#include "recovery-target-credential-authority.h"

#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <linux/if_alg.h>
#include <linux/stat.h>
#include <poll.h>
#include <sys/file.h>
#include <sys/prctl.h>
#include <sys/random.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/xattr.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifndef F_OFD_SETLK
#define F_OFD_SETLK 37
#endif
#ifndef F_OFD_GETLK
#define F_OFD_GETLK 36
#endif

#define RTCA_SCOPE_FILE "credential-provision.scope"
#define RTCA_INTENT_FILE "credential-provision-01.intent"
#define RTCA_FILES_FILE "credential-provision-02.files-durable"
#define RTCA_ADMISSION_FILE "credential-admission-v1.receipt"
#define RTCA_ADMITTED_FILE "credential-provision-03.admitted"
#define RTCA_PROVENANCE_XATTR "user.darshan.recovery.credential.scope"
#define RTCA_COMMITMENT_XATTR "user.darshan.recovery.credential.commitment"
#define RTCA_COMMITMENT_KEY_XATTR "user.darshan.recovery.credential.commitment-key"

static const char *const role_names[RTCA_ROLE_COUNT] = {
  "POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD", "MINIO_ROOT_USER"
};
static const char *const role_files[RTCA_ROLE_COUNT] = {
  "postgres-password", "minio-root-password", "minio-root-user"
};

static void wipe(void *value, size_t size) {
  volatile unsigned char *cursor = value;
  while (size--) *cursor++ = 0;
}
static int lower_hex(const char *value, size_t size) {
  if (!value || strlen(value) != size) return 0;
  for (size_t index = 0; index < size; index++)
    if (!((value[index] >= '0' && value[index] <= '9') || (value[index] >= 'a' && value[index] <= 'f'))) return 0;
  return 1;
}
static int handle(const char *value) {
  size_t size = value ? strlen(value) : 0;
  if (size < 25 || size >= 128 || memcmp(value, "tra:v1:", 7)) return 0;
  for (size_t index = 7; index < size; index++) if (!((value[index] >= 'A' && value[index] <= 'Z') ||
      (value[index] >= 'a' && value[index] <= 'z') || (value[index] >= '0' && value[index] <= '9') ||
      value[index] == '_' || value[index] == '-' || value[index] == ':')) return 0;
  return 1;
}
static int authority_handle(const char *value) {
  size_t size = value ? strlen(value) : 0;
  if (size < 28 || size >= 128 || memcmp(value, "rtea:v1:", 8)) return 0;
  for (size_t index = 8; index < size; index++) {
    if (!((value[index] >= 'A' && value[index] <= 'Z') ||
        (value[index] >= 'a' && value[index] <= 'z') ||
        (value[index] >= '0' && value[index] <= '9') || value[index] == '_' ||
        value[index] == '-' || value[index] == ':')) return 0;
  }
  return 1;
}
static int sha256_bytes(const void *bytes, size_t size, char output[65]) {
  int algorithm = socket(AF_ALG, SOCK_SEQPACKET | SOCK_CLOEXEC, 0);
  if (algorithm < 0) return -1;
  struct sockaddr_alg address = { .salg_family = AF_ALG, .salg_type = "hash", .salg_name = "sha256" };
  if (bind(algorithm, (struct sockaddr *)&address, sizeof(address)) < 0) { int e = errno; close(algorithm); errno = e; return -1; }
  int operation = accept4(algorithm, NULL, NULL, SOCK_CLOEXEC); close(algorithm); if (operation < 0) return -1;
  if (send(operation, bytes, size, 0) != (ssize_t)size) { int e = errno ? errno : EIO; close(operation); errno = e; return -1; }
  unsigned char digest[32]; ssize_t count = read(operation, digest, sizeof(digest)); close(operation);
  if (count != (ssize_t)sizeof(digest)) { errno = EIO; return -1; }
  static const char hex[] = "0123456789abcdef";
  for (size_t index = 0; index < sizeof(digest); index++) { output[index * 2] = hex[digest[index] >> 4]; output[index * 2 + 1] = hex[digest[index] & 15u]; }
  output[64] = '\0'; return 0;
}
static int domain_sha256(const void *bytes, size_t size, char output[65]) {
  static const char domain[] = "darshan-recovery-credential-provision-scope-wire-v1\0";
  size_t total = sizeof(domain) - 1 + size; unsigned char *joined = malloc(total);
  if (!joined) return -1;
  memcpy(joined, domain, sizeof(domain) - 1); memcpy(joined + sizeof(domain) - 1, bytes, size);
  int result = sha256_bytes(joined, total, output); wipe(joined, total); free(joined); return result;
}
static int sha256_parts(const void *left,size_t left_size,const void *right,size_t right_size,char output[65]) {
  if(left_size>SIZE_MAX-right_size){errno=EOVERFLOW;return-1;}size_t size=left_size+right_size;unsigned char *joined=malloc(size);if(!joined)return-1;memcpy(joined,left,left_size);memcpy(joined+left_size,right,right_size);int result=sha256_bytes(joined,size,output);wipe(joined,size);free(joined);return result;
}
static int take(const char **cursor, const char *end, const char *key, char *output, size_t capacity) {
  const char *start = *cursor, *newline = memchr(start, '\n', (size_t)(end - start)); size_t key_size = strlen(key);
  if (!newline || (size_t)(newline - start) <= key_size || memcmp(start, key, key_size) || start[key_size] != '=') { errno = EPROTO; return -1; }
  size_t size = (size_t)(newline - start - key_size - 1); if (!size || size >= capacity) { errno = EPROTO; return -1; }
  memcpy(output, start + key_size + 1, size); output[size] = '\0'; *cursor = newline + 1; return 0;
}
static int fixed(const char **cursor, const char *end, const char *key, const char *expected) {
  char value[160]; return take(cursor, end, key, value, sizeof(value)) == 0 && !strcmp(value, expected) ? 0 : (errno = EPROTO, -1);
}
static int u64_20(const char *value, uint64_t *output) {
  if (strlen(value) != 20) return 0;
  uint64_t result = 0;
  for (size_t index = 0; index < 20; index++) { unsigned digit = (unsigned)(value[index] - '0');
    if (digit > 9 || result > (UINT64_MAX - digit) / 10u) return 0;
    result = result * 10u + digit; }
  if (!result) return 0;
  *output = result; return 1;
}
static int directory_identity(int fd, uint64_t *device, uint64_t *inode, uint64_t *mount_id) {
  struct stat state; struct statx extended;
#ifdef RECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING
  uid_t owner = geteuid(); gid_t group = getegid();
#else
  uid_t owner = 0; gid_t group = 0;
#endif
  if (fstat(fd, &state) < 0 || !S_ISDIR(state.st_mode) || state.st_uid != owner || state.st_gid != group ||
      (state.st_mode & 0777) != 0700 || statx(fd, "", AT_EMPTY_PATH | AT_STATX_SYNC_AS_STAT, STATX_MNT_ID, &extended) < 0) {
    errno = EPERM; return -1;
  }
  *device = (uint64_t)state.st_dev; *inode = (uint64_t)state.st_ino; *mount_id = extended.stx_mnt_id; return 0;
}
static int verify_directories(struct rtca_context *context) {
  uint64_t device, inode, mount;
  if (directory_identity(context->credential_directory_fd, &device, &inode, &mount) < 0 ||
      device != context->credential_directory_device || inode != context->credential_directory_inode || mount != context->credential_directory_mount_id ||
      directory_identity(context->journal_directory_fd, &device, &inode, &mount) < 0 ||
      device != context->journal_directory_device || inode != context->journal_directory_inode ||
      mount != context->journal_directory_mount_id) { errno = ESTALE; return -1; }
  return 0;
}
static int allowed_name(const char *name, int journal) {
  if (!strcmp(name,".") || !strcmp(name,"..")) return 1;
  if (!journal) return !strcmp(name,role_files[0]) || !strcmp(name,role_files[1]) || !strcmp(name,role_files[2]);
  return !strcmp(name,RTCA_SCOPE_FILE) || !strcmp(name,RTCA_INTENT_FILE) || !strcmp(name,RTCA_FILES_FILE) ||
    !strcmp(name,RTCA_ADMISSION_FILE) || !strcmp(name,RTCA_ADMITTED_FILE);
}
static int strict_directory_scan(int directory, int journal) {
  int duplicate=openat(directory,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(duplicate<0)return-1;DIR *scan=fdopendir(duplicate);if(!scan){close(duplicate);return-1;}
  struct dirent *entry;errno=0;while((entry=readdir(scan))){if(!allowed_name(entry->d_name,journal)){closedir(scan);errno=EPROTO;return-1;}if(strcmp(entry->d_name,".")&&strcmp(entry->d_name,"..")){struct stat state;if(fstatat(directory,entry->d_name,&state,AT_SYMLINK_NOFOLLOW)<0||!S_ISREG(state.st_mode)||state.st_nlink!=1||(state.st_mode&0777)!=(journal?0600:0400)){closedir(scan);errno=EPROTO;return-1;}}}
  int e=errno;closedir(scan);if(e){errno=e;return-1;}return 0;
}
static int parse_scope(struct rtca_context *context, const void *wire, size_t size) {
  if (!wire || !size || size > RTCA_MAX_SCOPE_BYTES || memchr(wire, '\0', size)) { errno = EMSGSIZE; return -1; }
  const char *cursor = wire, *end = cursor + size; char generation[32], supervisor[32], deadline[32];
  if (fixed(&cursor,end,"domain","darshan-recovery-credential-provision-scope-wire-v1") < 0 ||
      fixed(&cursor,end,"operation","PREPARE") < 0 || take(&cursor,end,"operation_id",context->request.operation_id,sizeof(context->request.operation_id)) < 0 ||
      take(&cursor,end,"scope_semantic_sha256",context->scope_semantic_sha256,sizeof(context->scope_semantic_sha256)) < 0 ||
      take(&cursor,end,"generation",generation,sizeof(generation)) < 0 || take(&cursor,end,"target_handle",context->request.target_handle,sizeof(context->request.target_handle)) < 0 ||
      take(&cursor,end,"authority_target_handle",context->authority_target_handle,sizeof(context->authority_target_handle)) < 0 ||
      take(&cursor,end,"authority_handle",context->authority_handle,sizeof(context->authority_handle)) < 0 ||
      take(&cursor,end,"profile_v2_sha256",context->request.profile_sha256,sizeof(context->request.profile_sha256)) < 0 ||
      take(&cursor,end,"precredential_template_sha256",context->precredential_template_sha256,sizeof(context->precredential_template_sha256)) < 0 ||
      take(&cursor,end,"allocation_identity_sha256",context->allocation_identity_sha256,sizeof(context->allocation_identity_sha256)) < 0 ||
      take(&cursor,end,"allocation_ledger_head_sha256",context->allocation_ledger_head_sha256,sizeof(context->allocation_ledger_head_sha256)) < 0 ||
      take(&cursor,end,"authorization_sha256",context->request.authorization_sha256,sizeof(context->request.authorization_sha256)) < 0 ||
      take(&cursor,end,"outer_envelope_sha256",context->request.outer_envelope_sha256,sizeof(context->request.outer_envelope_sha256)) < 0 ||
      take(&cursor,end,"credential_policy_sha256",context->credential_policy_sha256,sizeof(context->credential_policy_sha256)) < 0 ||
      take(&cursor,end,"authority_instance_sha256",context->request.supervisor_instance_sha256,sizeof(context->request.supervisor_instance_sha256)) < 0 ||
      take(&cursor,end,"supervisor_generation",supervisor,sizeof(supervisor)) < 0 ||
      take(&cursor,end,"challenge_nonce",context->request.challenge_nonce,sizeof(context->request.challenge_nonce)) < 0 ||
      take(&cursor,end,"deadline_unix_ms",deadline,sizeof(deadline)) < 0 ||
      take(&cursor,end,"previous_journal_head_sha256",context->previous_journal_head_sha256,sizeof(context->previous_journal_head_sha256)) < 0 ||
      take(&cursor,end,"postgres_password_handle",context->role_handles[0],sizeof(context->role_handles[0])) < 0 ||
      take(&cursor,end,"minio_root_password_handle",context->role_handles[1],sizeof(context->role_handles[1])) < 0 ||
      take(&cursor,end,"minio_root_user_handle",context->role_handles[2],sizeof(context->role_handles[2])) < 0 || cursor != end ||
      !u64_20(generation,&context->request.generation) || !u64_20(supervisor,&context->request.supervisor_generation) ||
      !u64_20(deadline,&context->deadline_unix_ms) || !lower_hex(context->scope_semantic_sha256,64) ||
      !handle(context->request.target_handle) || !authority_handle(context->authority_target_handle) || !handle(context->authority_handle) ||
      !handle(context->role_handles[0]) || !handle(context->role_handles[1]) || !handle(context->role_handles[2]) ||
      !strcmp(context->role_handles[0],context->role_handles[1]) || !strcmp(context->role_handles[0],context->role_handles[2]) ||
      !strcmp(context->role_handles[1],context->role_handles[2])) { errno = EPROTO; return -1; }
  const char *digests[] = { context->request.profile_sha256, context->precredential_template_sha256, context->allocation_identity_sha256,
    context->allocation_ledger_head_sha256, context->request.authorization_sha256,
    context->request.outer_envelope_sha256, context->credential_policy_sha256, context->request.supervisor_instance_sha256,
    context->previous_journal_head_sha256 };
  for (size_t index=0; index<sizeof(digests)/sizeof(digests[0]); index++) if (!lower_hex(digests[index],64)) { errno=EPROTO; return -1; }
  if (!lower_hex(context->request.challenge_nonce,32) || domain_sha256(wire,size,context->scope_wire_sha256)<0) return -1;
  return 0;
}
static int scope_semantic_sha256(struct rtca_context *context,char output[65]) {
  char bytes[RTCA_MAX_SCOPE_BYTES];int length=snprintf(bytes,sizeof(bytes),"domain=darshan-recovery-credential-provision-scope-semantic-v1\noperation=PREPARE\noperation_id=%s\ngeneration=%020llu\ntarget_handle=%s\nauthority_target_handle=%s\nauthority_handle=%s\nprofile_v2_sha256=%s\nprecredential_template_sha256=%s\nallocation_identity_sha256=%s\nallocation_ledger_head_sha256=%s\nauthorization_sha256=%s\nouter_envelope_sha256=%s\ncredential_policy_sha256=%s\nauthority_instance_sha256=%s\nsupervisor_generation=%020llu\nchallenge_nonce=%s\ndeadline_unix_ms=%020llu\nprevious_journal_head_sha256=%s\npostgres_password_handle=%s\nminio_root_password_handle=%s\nminio_root_user_handle=%s\n",context->request.operation_id,(unsigned long long)context->request.generation,context->request.target_handle,context->authority_target_handle,context->authority_handle,context->request.profile_sha256,context->precredential_template_sha256,context->allocation_identity_sha256,context->allocation_ledger_head_sha256,context->request.authorization_sha256,context->request.outer_envelope_sha256,context->credential_policy_sha256,context->request.supervisor_instance_sha256,(unsigned long long)context->request.supervisor_generation,context->request.challenge_nonce,(unsigned long long)context->deadline_unix_ms,context->previous_journal_head_sha256,context->role_handles[0],context->role_handles[1],context->role_handles[2]);
  if(length<=0||(size_t)length>=sizeof(bytes)){errno=E2BIG;return-1;}return sha256_bytes(bytes,(size_t)length,output);
}
static int same_request(const struct rtea_request *actual, const struct rtea_request *verified,const char *authority_target) {
  return actual->operation_id[0] && verified->operation == RTEA_OPERATION_PREPARE &&
    actual->generation == verified->generation && actual->supervisor_generation == verified->supervisor_generation &&
    !strcmp(actual->operation_id,verified->operation_id) && !strcmp(authority_target,verified->target_handle) &&
    !strcmp(actual->profile_sha256,verified->profile_sha256) &&
    !strcmp(actual->authorization_sha256,verified->authorization_sha256) && !strcmp(actual->outer_envelope_sha256,verified->outer_envelope_sha256) &&
    !strcmp(actual->supervisor_instance_sha256,verified->supervisor_instance_sha256) && !strcmp(actual->challenge_nonce,verified->challenge_nonce);
}
static int fault(const char *name) {
#ifdef RECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING
  const char *selected=getenv("RTCA_TEST_FAULT"); if(selected&&!strcmp(selected,name)){errno=!strcmp(name,"enospc")?ENOSPC:EIO;return-1;}
#else
  (void)name;
#endif
  return 0;
}
static int write_complete(int fd,const void *bytes,size_t size) {
  const unsigned char *cursor=bytes;size_t done=0;
  while(done<size){size_t requested=size-done;
#ifdef RECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING
    const char *selected=getenv("RTCA_TEST_FAULT");if(selected&&!strcmp(selected,"short-write")&&requested>1)requested=1;
#endif
    ssize_t count=write(fd,cursor+done,requested);if(count<0){if(errno==EINTR)continue;return-1;}if(!count){errno=EIO;return-1;}done+=(size_t)count;
#ifdef RECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING
    if(requested==1&&done==1){errno=EIO;return-1;}
#endif
  }return 0;
}
static int publish_bytes(int directory,const char *name,const void *bytes,size_t size,mode_t mode,const char *kind,char digest[65]) {
  if(sha256_bytes(bytes,size,digest)<0)return-1;
  int existing=openat(directory,name,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);
  if(existing>=0){struct stat state;char *actual=NULL;int ok=0;if(fstat(existing,&state)==0&&S_ISREG(state.st_mode)&&state.st_size==(off_t)size&&state.st_nlink==1&&(state.st_mode&0777)==mode){actual=malloc(size);if(actual&&pread(existing,actual,size,0)==(ssize_t)size&&!memcmp(actual,bytes,size)&&fsync(existing)==0&&fsync(directory)==0)ok=1;}if(actual){wipe(actual,size);free(actual);}close(existing);if(ok)return 1;errno=EEXIST;return-1;}
  if(errno!=ENOENT||fault("enospc")<0)return-1;
  int fd=openat(directory,".",O_TMPFILE|O_RDWR|O_CLOEXEC,mode);if(fd<0)return-1;
  if(fault("write")<0||write_complete(fd,bytes,size)<0||fault("chmod")<0||fchmod(fd,mode)<0||fault("file-fsync")<0||fsync(fd)<0||fault("link")<0||linkat(fd,"",directory,name,AT_EMPTY_PATH)<0||fault("directory-fsync")<0||fsync(directory)<0){int e=errno?errno:EIO;close(fd);errno=e;return-1;}close(fd);(void)kind;return 0;
}
static int random_bytes(unsigned char *bytes,size_t size) { size_t done=0;while(done<size){ssize_t count=getrandom(bytes+done,size-done,0);if(count<0){if(errno==EINTR)continue;return-1;}if(!count){errno=EIO;return-1;}done+=(size_t)count;}return 0; }
static void hex_encode(const unsigned char *input,size_t size,char *output){static const char hex[]="0123456789abcdef";for(size_t i=0;i<size;i++){output[i*2]=hex[input[i]>>4];output[i*2+1]=hex[input[i]&15u];}}
static int content_commitment(const struct rtca_context *context,size_t index,const void *bytes,size_t size,unsigned char output[32]){int algorithm=socket(AF_ALG,SOCK_SEQPACKET|SOCK_CLOEXEC,0);if(algorithm<0)return-1;struct sockaddr_alg address={.salg_family=AF_ALG,.salg_type="hash",.salg_name="hmac(sha256)"};if(bind(algorithm,(struct sockaddr *)&address,sizeof(address))<0||setsockopt(algorithm,SOL_ALG,ALG_SET_KEY,context->commitment_key,sizeof(context->commitment_key))<0){int saved=errno;close(algorithm);errno=saved;return-1;}int operation=accept4(algorithm,NULL,NULL,SOCK_CLOEXEC);close(algorithm);if(operation<0)return-1;static const char domain[]="darshan-recovery-private-credential-content-v1\0";unsigned char role=(unsigned char)(index+1);if(send(operation,domain,sizeof(domain)-1,MSG_MORE)!=(ssize_t)(sizeof(domain)-1)||send(operation,&role,1,MSG_MORE)!=1||send(operation,bytes,size,0)!=(ssize_t)size||read(operation,output,32)!=32){int saved=errno?errno:EIO;close(operation);errno=saved;return-1;}close(operation);return 0;}
static int valid_credential_content(struct rtca_context *context,int fd,size_t index){size_t expected=index==2?41u:97u;struct stat state;if(fstat(fd,&state)<0||state.st_size!=(off_t)expected){errno=EPROTO;return-1;}unsigned char bytes[97],stored[32],actual[32];ssize_t count=pread(fd,bytes,expected,0);int valid=count==(ssize_t)expected&&bytes[expected-1]=='\n';if(valid&&index==2){valid=!memcmp(bytes,"darshan_",8);for(size_t i=8;i<40&&valid;i++)valid=(bytes[i]>='0'&&bytes[i]<='9')||(bytes[i]>='a'&&bytes[i]<='f');}else if(valid){for(size_t i=0;i<96&&valid;i++)valid=(bytes[i]>='0'&&bytes[i]<='9')||(bytes[i]>='a'&&bytes[i]<='f');}ssize_t commitment=fgetxattr(fd,RTCA_COMMITMENT_XATTR,stored,sizeof(stored));if(!valid||commitment!=(ssize_t)sizeof(stored)||content_commitment(context,index,bytes,expected,actual)<0){wipe(bytes,sizeof(bytes));wipe(stored,sizeof(stored));wipe(actual,sizeof(actual));errno=EPROTO;return-1;}unsigned difference=0;for(size_t i=0;i<sizeof(stored);i++)difference|=(unsigned)(stored[i]^actual[i]);wipe(bytes,sizeof(bytes));wipe(stored,sizeof(stored));wipe(actual,sizeof(actual));if(difference){errno=EPROTO;return-1;}return 0;}
static int adoption_freshness(struct rtca_context *context,size_t index){
#ifdef RECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING
  if(index==0&&getenv("RTCA_TEST_CANCEL_AFTER_ADOPT_FSYNC"))shutdown(context->peer_channel_fd,SHUT_RDWR);
#else
  (void)index;
#endif
  return rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u);
}
static int descriptor(int fd,enum rtca_role role,const char *authority,struct rtca_descriptor_identity *output){struct stat state;struct statx extended;
  if(fstat(fd,&state)<0||!S_ISREG(state.st_mode)||state.st_nlink!=1||(state.st_mode&0777)!=0400||statx(fd,"",AT_EMPTY_PATH|AT_STATX_SYNC_AS_STAT,STATX_MNT_ID,&extended)<0){errno=EPERM;return-1;}
#ifdef RECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING
  uid_t uid=geteuid();gid_t gid=getegid();
#else
  uid_t uid=role==RTCA_ROLE_POSTGRES_PASSWORD?999u:1000u;gid_t gid=uid;
#endif
  if(state.st_uid!=uid||state.st_gid!=gid){errno=EPERM;return-1;}memset(output,0,sizeof(*output));output->role=role;strcpy(output->authority_handle,authority);output->device_major=(uint64_t)major(state.st_dev);output->device_minor=(uint64_t)minor(state.st_dev);output->inode=(uint64_t)state.st_ino;output->mount_id=extended.stx_mnt_id;output->owner_uid=state.st_uid;output->owner_gid=state.st_gid;output->mode=0400;
  char canonical[512];int n=snprintf(canonical,sizeof(canonical),"domain=darshan-recovery-credential-descriptor-v1\nrole=%s\nauthority_handle=%s\ndevice_major=%llu\ndevice_minor=%llu\ninode=%llu\nmount_id=%llu\nowner_uid=%llu\nowner_gid=%llu\nmode=0400\n",role_names[role-1],authority,(unsigned long long)output->device_major,(unsigned long long)output->device_minor,(unsigned long long)output->inode,(unsigned long long)output->mount_id,(unsigned long long)output->owner_uid,(unsigned long long)output->owner_gid);
  return n>0&&(size_t)n<sizeof(canonical)?sha256_bytes(canonical,(size_t)n,output->identity_sha256):-1;}
static int open_credential(struct rtca_context *context,size_t index,struct rtca_descriptor_identity *identity){int fd=openat(context->credential_directory_fd,role_files[index],O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);if(fd<0)return-1;char provenance[65];ssize_t count=fgetxattr(fd,RTCA_PROVENANCE_XATTR,provenance,64);provenance[64]='\0';struct rtca_descriptor_identity before,after;if(count!=64||strcmp(provenance,context->scope_wire_sha256)||descriptor(fd,(enum rtca_role)(index+1),context->role_handles[index],&before)<0||valid_credential_content(context,fd,index)<0||fault(index==2?"adopt-final-file-fsync":"adopt-file-fsync")<0||fsync(fd)<0||adoption_freshness(context,index)<0||descriptor(fd,(enum rtca_role)(index+1),context->role_handles[index],&after)<0||memcmp(&before,&after,sizeof(before))||valid_credential_content(context,fd,index)<0||fault(index==2?"adopt-final-directory-fsync":"adopt-directory-fsync")<0||fsync(context->credential_directory_fd)<0||verify_directories(context)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0){int e=errno?errno:EPROTO;close(fd);errno=e;return-1;}*identity=after;close(fd);return 0;}
static int provision_role(struct rtca_context *context,size_t index,struct rtca_descriptor_identity *identity){int existing=open_credential(context,index,identity);if(existing==0)return 1;if(errno!=ENOENT)return-1;unsigned char random[48];char value[112];size_t size;
  if(random_bytes(random,index==2?16:48)<0)return-1;
  if(index==2){memcpy(value,"darshan_",8);hex_encode(random,16,value+8);size=40;}else{hex_encode(random,48,value);size=96;}value[size++]='\n';
  int fd=openat(context->credential_directory_fd,".",O_TMPFILE|O_RDWR|O_CLOEXEC,0600);if(fd<0){wipe(random,sizeof(random));wipe(value,sizeof(value));return-1;}
#ifdef RECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING
  uid_t uid=geteuid();gid_t gid=getegid();
#else
  uid_t uid=index==0?999u:1000u;gid_t gid=uid;
#endif
  unsigned char commitment[32];int failed=fault("write")<0||write_complete(fd,value,size)<0||content_commitment(context,index,value,size,commitment)<0||
    fsetxattr(fd,RTCA_PROVENANCE_XATTR,context->scope_wire_sha256,64,XATTR_CREATE)<0||
    fsetxattr(fd,RTCA_COMMITMENT_XATTR,commitment,sizeof(commitment),XATTR_CREATE)<0||
    fault("chown")<0||fchown(fd,uid,gid)<0||fault("chmod")<0||fchmod(fd,0400)<0||
    fault("file-fsync")<0||fsync(fd)<0||fault("link")<0||
    linkat(fd,"",context->credential_directory_fd,role_files[index],AT_EMPTY_PATH)<0||
    fault(index==2?"final-credential-directory-fsync":"credential-directory-fsync")<0||
    fsync(context->credential_directory_fd)<0;
  int e=errno?errno:EIO;wipe(random,sizeof(random));wipe(value,sizeof(value));wipe(commitment,sizeof(commitment));close(fd);if(failed){errno=e;return-1;}return open_credential(context,index,identity);}
static int format_intent(struct rtca_context *context,char *bytes,size_t capacity){return snprintf(bytes,capacity,"format=darshan-recovery-credential-provision-journal-v1\nstate=INTENT\noperation_id=%s\ngeneration=%020llu\ntarget_handle=%s\nscope_semantic_sha256=%s\nscope_wire_sha256=%s\nauthorization_sha256=%s\nallocation_identity_sha256=%s\nallocation_ledger_head_sha256=%s\ncredential_policy_sha256=%s\nauthority_instance_sha256=%s\nprevious_head_sha256=%s\n",context->request.operation_id,(unsigned long long)context->request.generation,context->request.target_handle,context->scope_semantic_sha256,context->scope_wire_sha256,context->request.authorization_sha256,context->allocation_identity_sha256,context->allocation_ledger_head_sha256,context->credential_policy_sha256,context->request.supervisor_instance_sha256,context->previous_journal_head_sha256);}
static int append_descriptors(char *bytes,size_t capacity,size_t used,const struct rtca_descriptor_identity descriptors[3]){for(size_t i=0;i<3;i++){int n=snprintf(bytes+used,capacity-used,"role_%zu=%s\nhandle_%zu=%s\nidentity_%zu=%s\ndevice_major_%zu=%llu\ndevice_minor_%zu=%llu\ninode_%zu=%llu\nmount_%zu=%llu\nuid_%zu=%llu\ngid_%zu=%llu\nmode_%zu=0400\n",i+1,role_names[i],i+1,descriptors[i].authority_handle,i+1,descriptors[i].identity_sha256,i+1,(unsigned long long)descriptors[i].device_major,i+1,(unsigned long long)descriptors[i].device_minor,i+1,(unsigned long long)descriptors[i].inode,i+1,(unsigned long long)descriptors[i].mount_id,i+1,(unsigned long long)descriptors[i].owner_uid,i+1,(unsigned long long)descriptors[i].owner_gid,i+1);if(n<=0||(size_t)n>=capacity-used)return-1;used+=(size_t)n;}return(int)used;}
static int format_files(struct rtca_context *context,const char *intent,const struct rtca_descriptor_identity descriptors[3],char *bytes,size_t capacity){int n=snprintf(bytes,capacity,"format=darshan-recovery-credential-provision-journal-v1\nstate=FILES_DURABLE\noperation_id=%s\ngeneration=%020llu\ntarget_handle=%s\nscope_semantic_sha256=%s\nscope_wire_sha256=%s\nintent_record_sha256=%s\n",context->request.operation_id,(unsigned long long)context->request.generation,context->request.target_handle,context->scope_semantic_sha256,context->scope_wire_sha256,intent);if(n<=0||(size_t)n>=capacity)return-1;return append_descriptors(bytes,capacity,(size_t)n,descriptors);}
static int format_admission(struct rtca_context *context,const char *intent,const char *files,const struct rtca_descriptor_identity descriptors[3],char *bytes,size_t capacity){int n=snprintf(bytes,capacity,"format=darshan-recovery-credential-admission-v1\nstatus=FULLY_ENROLLED\noperation_id=%s\ngeneration=%020llu\ntarget_handle=%s\nauthority_handle=%s\nscope_semantic_sha256=%s\nscope_wire_sha256=%s\nintent_record_sha256=%s\nfiles_durable_record_sha256=%s\nrequest_sha256=%s\nauthorization_sha256=%s\nallocation_identity_sha256=%s\nallocation_ledger_head_sha256=%s\ncredential_policy_sha256=%s\nauthority_instance_sha256=%s\n",context->request.operation_id,(unsigned long long)context->request.generation,context->request.target_handle,context->authority_handle,context->scope_semantic_sha256,context->scope_wire_sha256,intent,files,context->request.request_sha256,context->request.authorization_sha256,context->allocation_identity_sha256,context->allocation_ledger_head_sha256,context->credential_policy_sha256,context->request.supervisor_instance_sha256);if(n<=0||(size_t)n>=capacity)return-1;return append_descriptors(bytes,capacity,(size_t)n,descriptors);}
static int format_admitted(struct rtca_context *context,const char *intent,const char *files,const char *receipt,char *bytes,size_t capacity){return snprintf(bytes,capacity,"format=darshan-recovery-credential-provision-journal-v1\nstate=ADMITTED\noperation_id=%s\ngeneration=%020llu\ntarget_handle=%s\nscope_semantic_sha256=%s\nscope_wire_sha256=%s\nintent_record_sha256=%s\nfiles_durable_record_sha256=%s\nadmission_receipt_sha256=%s\n",context->request.operation_id,(unsigned long long)context->request.generation,context->request.target_handle,context->scope_semantic_sha256,context->scope_wire_sha256,intent,files,receipt);}
static void fill_admission(struct rtca_context *context,const char *intent,const char *files,const char *receipt,const struct rtca_descriptor_identity descriptors[3]){memset(&context->admission,0,sizeof(context->admission));context->admission.state=RTCA_STATE_ADMITTED;strcpy(context->admission.operation_id,context->request.operation_id);context->admission.generation=context->request.generation;strcpy(context->admission.target_handle,context->request.target_handle);strcpy(context->admission.authority_handle,context->authority_handle);strcpy(context->admission.scope_semantic_sha256,context->scope_semantic_sha256);strcpy(context->admission.scope_wire_sha256,context->scope_wire_sha256);strcpy(context->admission.authorization_sha256,context->request.authorization_sha256);strcpy(context->admission.request_sha256,context->request.request_sha256);strcpy(context->admission.allocation_identity_sha256,context->allocation_identity_sha256);strcpy(context->admission.allocation_ledger_head_sha256,context->allocation_ledger_head_sha256);strcpy(context->admission.credential_policy_sha256,context->credential_policy_sha256);strcpy(context->admission.authority_instance_sha256,context->request.supervisor_instance_sha256);strcpy(context->admission.intent_record_sha256,intent);strcpy(context->admission.files_durable_record_sha256,files);strcpy(context->admission.admission_receipt_sha256,receipt);memcpy(context->admission.descriptors,descriptors,sizeof(context->admission.descriptors));}

struct existing_topology {int scope;int intent;int files;int admission;int admitted;size_t credentials;};
static int exists_at(int directory,const char *name,int *exists){struct stat state;if(fstatat(directory,name,&state,AT_SYMLINK_NOFOLLOW)==0){*exists=1;return 0;}if(errno==ENOENT){*exists=0;return 0;}return-1;}
static int existing_topology(struct rtca_context *context,struct existing_topology *topology){memset(topology,0,sizeof(*topology));if(exists_at(context->journal_directory_fd,RTCA_SCOPE_FILE,&topology->scope)<0||exists_at(context->journal_directory_fd,RTCA_INTENT_FILE,&topology->intent)<0||exists_at(context->journal_directory_fd,RTCA_FILES_FILE,&topology->files)<0||exists_at(context->journal_directory_fd,RTCA_ADMISSION_FILE,&topology->admission)<0||exists_at(context->journal_directory_fd,RTCA_ADMITTED_FILE,&topology->admitted)<0)return-1;for(size_t i=0;i<3;i++){int present;if(exists_at(context->credential_directory_fd,role_files[i],&present)<0)return-1;if(present)topology->credentials++;}if(!topology->scope&&(topology->intent||topology->files||topology->admission||topology->admitted||topology->credentials)){errno=EPROTO;return-1;}if(topology->scope&&((!topology->intent&&(topology->files||topology->admission||topology->admitted||topology->credentials))||(topology->files&&topology->credentials!=3)||(!topology->files&&(topology->admission||topology->admitted))||(!topology->admission&&topology->admitted))){errno=EPROTO;return-1;}return 0;}
static int exact_record(int directory,const char *name,const void *expected,size_t size){int fd=openat(directory,name,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);if(fd<0)return-1;struct stat state;unsigned char *actual=malloc(size?size:1);int ok=fstat(fd,&state)==0&&S_ISREG(state.st_mode)&&state.st_nlink==1&&(state.st_mode&0777)==0600&&state.st_size==(off_t)size&&actual&&pread(fd,actual,size,0)==(ssize_t)size&&!memcmp(actual,expected,size)&&fsync(fd)==0;if(actual){wipe(actual,size);free(actual);}close(fd);if(!ok){errno=EPROTO;return-1;}return 0;}
static int validate_existing_journal(struct rtca_context *context){struct existing_topology topology;if(existing_topology(context,&topology)<0||!topology.scope)return-1;if(!topology.intent){context->state=RTCA_STATE_ABSENT;return 0;}char intent[4096],files[4096],receipt[4096],admitted[4096],intent_hash[65],files_hash[65],receipt_hash[65];int il=format_intent(context,intent,sizeof(intent));if(il<=0||sha256_bytes(intent,(size_t)il,intent_hash)<0||exact_record(context->journal_directory_fd,RTCA_INTENT_FILE,intent,(size_t)il)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;context->state=RTCA_STATE_INTENT;struct rtca_descriptor_identity descriptors[3];size_t present=0;for(size_t i=0;i<3;i++){if(open_credential(context,i,&descriptors[i])==0){if(i!=present){errno=EPROTO;return-1;}present++;if(rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;}else if(errno!=ENOENT)return-1;}if(present!=topology.credentials||(topology.files&&present!=3)){errno=EPROTO;return-1;}if(!topology.files)return 0;int fl=format_files(context,intent_hash,descriptors,files,sizeof(files));if(fl<=0||sha256_bytes(files,(size_t)fl,files_hash)<0||exact_record(context->journal_directory_fd,RTCA_FILES_FILE,files,(size_t)fl)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;context->state=RTCA_STATE_FILES_DURABLE;if(!topology.admission)return 0;int rl=format_admission(context,intent_hash,files_hash,descriptors,receipt,sizeof(receipt));if(rl<=0||sha256_bytes(receipt,(size_t)rl,receipt_hash)<0||exact_record(context->journal_directory_fd,RTCA_ADMISSION_FILE,receipt,(size_t)rl)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;if(!topology.admitted)return 0;int al=format_admitted(context,intent_hash,files_hash,receipt_hash,admitted,sizeof(admitted));if(al<=0||exact_record(context->journal_directory_fd,RTCA_ADMITTED_FILE,admitted,(size_t)al)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;fill_admission(context,intent_hash,files_hash,receipt_hash,descriptors);context->state=RTCA_STATE_ADMITTED;return 0;}

static int clock_ns(clockid_t clock,uint64_t *output){struct timespec value;if(clock_gettime(clock,&value)<0||value.tv_sec<0||(uint64_t)value.tv_sec>UINT64_MAX/1000000000u){errno=EOVERFLOW;return-1;}*output=(uint64_t)value.tv_sec*1000000000u+(uint64_t)value.tv_nsec;return 0;}
static int initial_realtime_ns(uint64_t fixture_now_ms,uint64_t *output){
#ifdef RECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING
  const char *fixture_ns=getenv("RTCA_TEST_OPEN_NOW_UNIX_NS");
  if(fixture_ns){char *end=NULL;unsigned long long parsed=strtoull(fixture_ns,&end,10);if(!end||*end){errno=EINVAL;return-1;}*output=(uint64_t)parsed;return 0;}
  if(fixture_now_ms>UINT64_MAX/1000000u){errno=EOVERFLOW;return-1;}*output=fixture_now_ms*1000000u;return 0;
#else
  (void)fixture_now_ms;return clock_ns(CLOCK_REALTIME,output);
#endif
}
static int durable_scope_anchor(struct rtca_context *context,int anchor,int created){struct stat before,after,named;unsigned char key[32],recheck[32];const char *phase=created?"anchor-create":"anchor-replay";char point[64];memset(key,0,sizeof(key));memset(recheck,0,sizeof(recheck));if(fstat(anchor,&before)<0||!S_ISREG(before.st_mode)||before.st_nlink!=1||(before.st_mode&0777)!=0600||before.st_size!=0||fstatat(context->journal_directory_fd,RTCA_SCOPE_FILE,&named,AT_SYMLINK_NOFOLLOW)<0||named.st_dev!=before.st_dev||named.st_ino!=before.st_ino){errno=EPROTO;return-1;}if(created){if(random_bytes(key,sizeof(key))<0||fsetxattr(anchor,RTCA_COMMITMENT_KEY_XATTR,key,sizeof(key),XATTR_CREATE)<0){wipe(key,sizeof(key));return-1;}}else if(fgetxattr(anchor,RTCA_COMMITMENT_KEY_XATTR,key,sizeof(key))!=(ssize_t)sizeof(key)){wipe(key,sizeof(key));errno=EPROTO;return-1;}snprintf(point,sizeof(point),"%s-before-file-fsync",phase);if(fault(point)<0){wipe(key,sizeof(key));return-1;}snprintf(point,sizeof(point),"%s-file-fsync",phase);if(fault(point)<0||fsync(anchor)<0){wipe(key,sizeof(key));return-1;}snprintf(point,sizeof(point),"%s-after-file-fsync",phase);if(fault(point)<0){wipe(key,sizeof(key));return-1;}snprintf(point,sizeof(point),"%s-directory-fsync",phase);if(fault(point)<0||fsync(context->journal_directory_fd)<0){wipe(key,sizeof(key));return-1;}snprintf(point,sizeof(point),"%s-after-directory-fsync",phase);if(fault(point)<0){wipe(key,sizeof(key));return-1;}if(fstat(anchor,&after)<0||after.st_dev!=before.st_dev||after.st_ino!=before.st_ino||after.st_nlink!=1||(after.st_mode&0777)!=0600||after.st_size!=0||fstatat(context->journal_directory_fd,RTCA_SCOPE_FILE,&named,AT_SYMLINK_NOFOLLOW)<0||named.st_dev!=after.st_dev||named.st_ino!=after.st_ino||fgetxattr(anchor,RTCA_COMMITMENT_KEY_XATTR,recheck,sizeof(recheck))!=(ssize_t)sizeof(recheck)||memcmp(key,recheck,sizeof(key))||verify_directories(context)<0){wipe(key,sizeof(key));wipe(recheck,sizeof(recheck));errno=EPROTO;return-1;}memcpy(context->commitment_key,key,sizeof(key));wipe(key,sizeof(key));wipe(recheck,sizeof(recheck));return 0;}
static int validate_session_descriptors(const struct rtca_context *context){struct stat state;int domain=0,type=0,accepting=0;socklen_t integer=sizeof(int);struct sockaddr_un local,remote;socklen_t local_size=sizeof(local),remote_size=sizeof(remote);if(rtea_validate_active_session(&context->authority_session)<0)return-1;if(fstat(context->authority_session_fd,&state)<0||!S_ISREG(state.st_mode)||state.st_nlink!=1||(state.st_mode&0777)!=0600||(uint64_t)state.st_dev!=context->authority_device||(uint64_t)state.st_ino!=context->authority_inode||getsockopt(context->peer_channel_fd,SOL_SOCKET,SO_DOMAIN,&domain,&integer)<0||domain!=AF_UNIX||getsockopt(context->peer_channel_fd,SOL_SOCKET,SO_TYPE,&type,&integer)<0||type!=SOCK_SEQPACKET||getsockopt(context->peer_channel_fd,SOL_SOCKET,SO_ACCEPTCONN,&accepting,&integer)<0||accepting||getsockname(context->peer_channel_fd,(struct sockaddr *)&local,&local_size)<0||getpeername(context->peer_channel_fd,(struct sockaddr *)&remote,&remote_size)<0||local_size!=offsetof(struct sockaddr_un,sun_path)||remote_size!=offsetof(struct sockaddr_un,sun_path)){errno=EACCES;return-1;}return 0;}
int rtca_validate_provision_scope(struct rtca_context *context,uint64_t fixture_now_ms){struct pollfd peer={0};uint64_t realtime=0,monotonic=0;
#ifdef RECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING
  const char *fixture_ns=getenv("RTCA_TEST_NOW_UNIX_NS");if(fixture_ns){char *end=NULL;unsigned long long parsed=strtoull(fixture_ns,&end,10);if(!end||*end){errno=EINVAL;return-1;}realtime=(uint64_t)parsed;}else if(fixture_now_ms){if(fixture_now_ms>UINT64_MAX/1000000u){errno=EOVERFLOW;return-1;}realtime=fixture_now_ms*1000000u;}else if(clock_ns(CLOCK_REALTIME,&realtime)<0)return-1;
#else
  (void)fixture_now_ms;if(clock_ns(CLOCK_REALTIME,&realtime)<0)return-1;
#endif
  if(clock_ns(CLOCK_MONOTONIC,&monotonic)<0)return-1;
  if(!context||context->scope_fd<0||context->authority_session_fd<0||context->peer_channel_fd<0||validate_session_descriptors(context)<0||verify_directories(context)<0||strict_directory_scan(context->credential_directory_fd,0)<0||strict_directory_scan(context->journal_directory_fd,1)<0||realtime>=context->deadline_realtime_ns||monotonic>=context->deadline_monotonic_ns){if(context&&(realtime>=context->deadline_realtime_ns||monotonic>=context->deadline_monotonic_ns))errno=ETIMEDOUT;return-1;}peer.fd=context->peer_channel_fd;peer.events=POLLIN|POLLHUP|POLLERR;if(poll(&peer,1,0)<0)return-1;if(peer.revents&(POLLHUP|POLLERR|POLLNVAL)){errno=ECANCELED;return-1;}return 0;}
int rtca_open_context(int credential_fd,int journal_fd,const struct rtea_session *session,const void *prepare_frame,size_t prepare_frame_size,const void *wire,size_t size,uint64_t now,struct rtca_context *context){
  if(!context||!session||!prepare_frame||!prepare_frame_size){errno=EINVAL;return-1;}memset(context,0,sizeof(*context));context->scope_fd=context->authority_session_fd=context->peer_channel_fd=context->credential_directory_fd=context->journal_directory_fd=-1;
  struct rlimit zero={0,0};if(setrlimit(RLIMIT_CORE,&zero)<0||prctl(PR_SET_DUMPABLE,0,0,0,0)<0)return-1;
  int credentials=fcntl(credential_fd,F_DUPFD_CLOEXEC,3),journal=fcntl(journal_fd,F_DUPFD_CLOEXEC,3);if(credentials<0||journal<0){if(credentials>=0)close(credentials);if(journal>=0)close(journal);return-1;}context->credential_directory_fd=credentials;context->journal_directory_fd=journal;
  if(directory_identity(credentials,&context->credential_directory_device,&context->credential_directory_inode,&context->credential_directory_mount_id)<0||directory_identity(journal,&context->journal_directory_device,&context->journal_directory_inode,&context->journal_directory_mount_id)<0||(context->credential_directory_device==context->journal_directory_device&&context->credential_directory_inode==context->journal_directory_inode)||(context->credential_directory_mount_id==context->journal_directory_mount_id&&context->credential_directory_inode==context->journal_directory_inode)||strict_directory_scan(credentials,0)<0||strict_directory_scan(journal,1)<0){rtca_close_context(context);errno=EPERM;return-1;}
  struct rtea_request verified;char expected_proof[65],semantic[65];uint64_t open_realtime=0;const char prefix[]="rtea:v1:session:";
  if(initial_realtime_ns(now,&open_realtime)<0){rtca_close_context(context);return-1;}
  if(rtea_parse_request(prepare_frame,prepare_frame_size,&verified)<0||parse_scope(context,wire,size)<0||scope_semantic_sha256(context,semantic)<0||strcmp(semantic,context->scope_semantic_sha256)||strcmp(context->scope_wire_sha256,verified.request_sha256)||!same_request(&context->request,&verified,context->authority_target_handle)||session->operation!=RTEA_OPERATION_PREPARE||session->readonly||strncmp(session->session_handle,prefix,sizeof(prefix)-1)||!lower_hex(session->session_handle+sizeof(prefix)-1,64)||sha256_parts(prepare_frame,prepare_frame_size,session->session_handle+sizeof(prefix)-1,64,expected_proof)<0||strcmp(expected_proof,session->lease_proof_sha256)||strcmp(session->authority_instance_sha256,verified.supervisor_instance_sha256)||session->supervisor_generation!=verified.supervisor_generation||strcmp(session->challenge_nonce,verified.challenge_nonce)||rtea_validate_active_session(session)<0||context->deadline_unix_ms>verified.deadline_unix_ms){rtca_close_context(context);errno=EACCES;return-1;}
  strcpy(context->request.installation_id,verified.installation_id);strcpy(context->request.site_id,verified.site_id);strcpy(context->request.host_installation_id,verified.host_installation_id);strcpy(context->request.request_sha256,verified.request_sha256);
  context->authority_session_fd=fcntl(session->authority_fd,F_DUPFD_CLOEXEC,3);context->peer_channel_fd=fcntl(session->peer_channel_fd,F_DUPFD_CLOEXEC,3);context->authority_session=*session;context->authority_session.authority_fd=context->authority_session_fd;context->authority_session.peer_channel_fd=context->peer_channel_fd;context->authority_device=session->authority_dev;context->authority_inode=session->authority_ino;if(context->authority_session_fd<0||context->peer_channel_fd<0||context->deadline_unix_ms>UINT64_MAX/1000000u){rtca_close_context(context);errno=EACCES;return-1;}context->deadline_realtime_ns=context->deadline_unix_ms*1000000u;if(open_realtime>=context->deadline_realtime_ns||validate_session_descriptors(context)<0){rtca_close_context(context);errno=EACCES;return-1;}uint64_t monotonic;if(clock_ns(CLOCK_MONOTONIC,&monotonic)<0||context->deadline_realtime_ns-open_realtime>UINT64_MAX-monotonic){rtca_close_context(context);errno=EOVERFLOW;return-1;}context->deadline_monotonic_ns=monotonic+(context->deadline_realtime_ns-open_realtime);context->request.operation=RTEA_OPERATION_PREPARE;
  struct existing_topology topology;if(existing_topology(context,&topology)<0){rtca_close_context(context);return-1;}int created=0;int anchor=openat(journal,RTCA_SCOPE_FILE,O_RDWR|O_CLOEXEC|O_NOFOLLOW);if(anchor<0&&errno==ENOENT){anchor=openat(journal,RTCA_SCOPE_FILE,O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0600);if(anchor>=0)created=1;}struct stat state;if(anchor<0||fstat(anchor,&state)<0||!S_ISREG(state.st_mode)||state.st_nlink!=1||(state.st_mode&0777)!=0600||state.st_size!=0){if(anchor>=0)close(anchor);rtca_close_context(context);errno=EPERM;return-1;}struct flock lock={.l_type=F_WRLCK,.l_whence=SEEK_SET,.l_start=0,.l_len=1};if(fcntl(anchor,F_OFD_SETLK,&lock)<0){close(anchor);rtca_close_context(context);return-1;}context->scope_fd=anchor;
  if(durable_scope_anchor(context,anchor,created)<0){rtca_close_context(context);return-1;}
  if(rtca_validate_provision_scope(context,now)<0||validate_existing_journal(context)<0||rtca_validate_provision_scope(context,now)<0){rtca_close_context(context);return-1;}return 0;
}
int rtca_reconcile_provisioning(struct rtca_context *context,struct rtca_admission *admission){if(!context||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0||validate_existing_journal(context)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;if(context->state==RTCA_STATE_ADMITTED&&admission)*admission=context->admission;return 0;}
int rtca_provision_fixed_roles(struct rtca_context *context,struct rtca_admission *admission){if(!context||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0||validate_existing_journal(context)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;char intent[4096],hash[65];int length=format_intent(context,intent,sizeof(intent));if(length<=0||publish_bytes(context->journal_directory_fd,RTCA_INTENT_FILE,intent,(size_t)length,0600,"intent",hash)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;context->state=RTCA_STATE_INTENT;struct rtca_descriptor_identity descriptors[3];for(size_t i=0;i<3;i++)if(provision_role(context,i,&descriptors[i])<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;char files[4096];int fl=format_files(context,hash,descriptors,files,sizeof(files));char files_hash[65];if(fl<=0||publish_bytes(context->journal_directory_fd,RTCA_FILES_FILE,files,(size_t)fl,0600,"files",files_hash)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;context->state=RTCA_STATE_FILES_DURABLE;char receipt[4096];int rl=format_admission(context,hash,files_hash,descriptors,receipt,sizeof(receipt));char receipt_hash[65];if(rl<=0||publish_bytes(context->journal_directory_fd,RTCA_ADMISSION_FILE,receipt,(size_t)rl,0600,"receipt",receipt_hash)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;char admitted_bytes[4096];int al=format_admitted(context,hash,files_hash,receipt_hash,admitted_bytes,sizeof(admitted_bytes));char ignored[65];if(al<=0||publish_bytes(context->journal_directory_fd,RTCA_ADMITTED_FILE,admitted_bytes,(size_t)al,0600,"admitted",ignored)<0||rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;fill_admission(context,hash,files_hash,receipt_hash,descriptors);context->state=RTCA_STATE_ADMITTED;if(rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;if(admission)*admission=context->admission;return 0;}
int rtca_read_exact_admission(struct rtca_context *context,struct rtca_admission *admission){if(!context||!admission){errno=EINVAL;return-1;}if(rtca_reconcile_provisioning(context,admission)<0)return-1;if(context->state!=RTCA_STATE_ADMITTED){errno=ENODATA;return-1;}if(rtca_validate_provision_scope(context,(uint64_t)time(NULL)*1000u)<0)return-1;*admission=context->admission;return 0;}
static int format_use_witness(const struct rtca_admission *admission,char *bytes,size_t capacity){return snprintf(bytes,capacity,"domain=darshan-recovery-credential-use-witness-v1\noperation_id=%s\ngeneration=%020llu\ntarget_handle=%s\nadmission_receipt_sha256=%s\nauthority_instance_sha256=%s\npostgres_descriptor_sha256=%s\nminio_password_descriptor_sha256=%s\nminio_user_descriptor_sha256=%s\n",admission->operation_id,(unsigned long long)admission->generation,admission->target_handle,admission->admission_receipt_sha256,admission->authority_instance_sha256,admission->descriptors[0].identity_sha256,admission->descriptors[1].identity_sha256,admission->descriptors[2].identity_sha256);}
int rtca_validate_admitted_use_context(struct rtca_admitted_use_context *use){
  struct rtca_admission exact;if(!use||!use->admitted_owner||use->authority_session_fd<0||use->peer_channel_fd<0||use->credential_directory_fd<0||rtea_validate_active_session(&use->authority_session)<0||rtca_read_exact_admission(use->admitted_owner,&exact)<0||memcmp(&exact,&use->admission,sizeof(exact))){errno=EACCES;return-1;}uint64_t realtime=0,monotonic=0;if(clock_ns(CLOCK_REALTIME,&realtime)<0||clock_ns(CLOCK_MONOTONIC,&monotonic)<0)return-1;if(realtime>=use->deadline_realtime_ns||monotonic>=use->deadline_monotonic_ns){errno=ETIMEDOUT;return-1;}char canonical[1024],actual[65];int length=format_use_witness(&use->admission,canonical,sizeof(canonical));if(length<=0||(size_t)length>=sizeof(canonical)||sha256_bytes(canonical,(size_t)length,actual)<0||strcmp(actual,use->witness_sha256)){errno=EPROTO;return-1;}for(size_t i=0;i<RTCA_ROLE_COUNT;i++){struct rtca_descriptor_identity identity;if(use->credential_fds[i]<0||descriptor(use->credential_fds[i],(enum rtca_role)(i+1),use->admission.descriptors[i].authority_handle,&identity)<0||memcmp(&identity,&use->admission.descriptors[i],sizeof(identity))||valid_credential_content(use->admitted_owner,use->credential_fds[i],i)<0){errno=ESTALE;return-1;}}if(rtca_read_exact_admission(use->admitted_owner,&exact)<0||memcmp(&exact,&use->admission,sizeof(exact))||clock_ns(CLOCK_REALTIME,&realtime)<0||clock_ns(CLOCK_MONOTONIC,&monotonic)<0)return-1;if(realtime>=use->deadline_realtime_ns||monotonic>=use->deadline_monotonic_ns){errno=ETIMEDOUT;return-1;}return 0;
}
int rtca_open_admitted_use_context(struct rtca_context *admitted,struct rtca_admitted_use_context *use){
  if(!admitted||!use){errno=EINVAL;return-1;}memset(use,0,sizeof(*use));use->admitted_owner=admitted;use->authority_session_fd=use->peer_channel_fd=use->credential_directory_fd=-1;for(size_t i=0;i<RTCA_ROLE_COUNT;i++)use->credential_fds[i]=-1;struct rtca_admission receipt;if(rtca_read_exact_admission(admitted,&receipt)<0)return-1;use->authority_session_fd=fcntl(admitted->authority_session_fd,F_DUPFD_CLOEXEC,3);use->peer_channel_fd=fcntl(admitted->peer_channel_fd,F_DUPFD_CLOEXEC,3);use->credential_directory_fd=fcntl(admitted->credential_directory_fd,F_DUPFD_CLOEXEC,3);if(use->authority_session_fd<0||use->peer_channel_fd<0||use->credential_directory_fd<0)goto fail;use->authority_session=admitted->authority_session;use->authority_session.authority_fd=use->authority_session_fd;use->authority_session.peer_channel_fd=use->peer_channel_fd;use->deadline_realtime_ns=admitted->deadline_realtime_ns;use->deadline_monotonic_ns=admitted->deadline_monotonic_ns;use->admission=receipt;for(size_t i=0;i<RTCA_ROLE_COUNT;i++){use->credential_fds[i]=openat(use->credential_directory_fd,role_files[i],O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);if(use->credential_fds[i]<0||valid_credential_content(admitted,use->credential_fds[i],i)<0)goto fail;}char canonical[1024];int length=format_use_witness(&receipt,canonical,sizeof(canonical));if(length<=0||(size_t)length>=sizeof(canonical)||sha256_bytes(canonical,(size_t)length,use->witness_sha256)<0||rtca_validate_admitted_use_context(use)<0)goto fail;return 0;
fail:(void)rtca_close_admitted_use_context(use);return-1;
}
int rtca_close_admitted_use_context(struct rtca_admitted_use_context *use){if(!use){errno=EINVAL;return-1;}int result=0;for(size_t i=0;i<RTCA_ROLE_COUNT;i++)if(use->credential_fds[i]>=0&&close(use->credential_fds[i])<0)result=-1;if(use->authority_session_fd>=0&&close(use->authority_session_fd)<0)result=-1;if(use->peer_channel_fd>=0&&close(use->peer_channel_fd)<0)result=-1;if(use->credential_directory_fd>=0&&close(use->credential_directory_fd)<0)result=-1;wipe(use,sizeof(*use));use->authority_session_fd=use->peer_channel_fd=use->credential_directory_fd=-1;for(size_t i=0;i<RTCA_ROLE_COUNT;i++)use->credential_fds[i]=-1;return result;}
int rtca_close_context(struct rtca_context *context){if(!context){errno=EINVAL;return-1;}int result=0;if(context->scope_fd>=0&&close(context->scope_fd)<0)result=-1;if(context->authority_session_fd>=0&&close(context->authority_session_fd)<0)result=-1;if(context->peer_channel_fd>=0&&close(context->peer_channel_fd)<0)result=-1;if(context->credential_directory_fd>=0&&close(context->credential_directory_fd)<0)result=-1;if(context->journal_directory_fd>=0&&close(context->journal_directory_fd)<0)result=-1;wipe(context,sizeof(*context));context->scope_fd=context->authority_session_fd=context->peer_channel_fd=context->credential_directory_fd=context->journal_directory_fd=-1;return result;}
