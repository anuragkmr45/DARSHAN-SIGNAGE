#define _GNU_SOURCE
#include "recovery-target-engine-authority.h"

#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <linux/if_alg.h>
#include <poll.h>
#include <pthread.h>
#include <stddef.h>
#include <stdio.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#ifndef F_OFD_GETLK
#define F_OFD_GETLK 36
#endif

#define RTEA_ACTIVE_SESSION_LIMIT 16u
struct active_session {
  int used;
  pid_t process_id;
  uint64_t authority_dev;
  uint64_t authority_ino;
  uint64_t peer_cookie;
  enum rtea_operation operation;
  int readonly;
  uint64_t supervisor_generation;
  char session_handle[96];
  char lease_proof_sha256[65];
  char authority_instance_sha256[65];
  char challenge_nonce[33];
};
static struct active_session active_sessions[RTEA_ACTIVE_SESSION_LIMIT];
static atomic_flag active_sessions_lock = ATOMIC_FLAG_INIT;
static _Atomic(pid_t) active_sessions_process_id;
static pthread_once_t active_sessions_atfork_once=PTHREAD_ONCE_INIT;
static int active_sessions_atfork_status;
static void lock_active_sessions(void){while(atomic_flag_test_and_set_explicit(&active_sessions_lock,memory_order_acquire)){} }
static void unlock_active_sessions(void){atomic_flag_clear_explicit(&active_sessions_lock,memory_order_release);}
static void prepare_active_sessions_fork(void){lock_active_sessions();}
static void parent_active_sessions_fork(void){unlock_active_sessions();}
static void reset_active_sessions_after_fork(void){memset(active_sessions,0,sizeof(active_sessions));atomic_store_explicit(&active_sessions_process_id,getpid(),memory_order_release);unlock_active_sessions();}
static void register_active_sessions_atfork(void){active_sessions_atfork_status=pthread_atfork(prepare_active_sessions_fork,parent_active_sessions_fork,reset_active_sessions_after_fork);}
static int peer_cookie(int fd,uint64_t *output){socklen_t size=sizeof(*output);return getsockopt(fd,SOL_SOCKET,SO_COOKIE,output,&size)<0||size!=sizeof(*output)?-1:0;}
static int exact_authority_ofd(const struct rtea_session *session){struct stat state,probe_state;struct flock own={.l_type=F_WRLCK,.l_whence=SEEK_SET,.l_start=0,.l_len=0};if(fstat(session->authority_fd,&state)<0||!S_ISREG(state.st_mode)||state.st_nlink!=1||(state.st_mode&0777)!=0600||(uint64_t)state.st_dev!=session->authority_dev||(uint64_t)state.st_ino!=session->authority_ino||fcntl(session->authority_fd,F_OFD_GETLK,&own)<0||own.l_type!=F_UNLCK)return-1;char path[64];int size=snprintf(path,sizeof(path),"/proc/self/fd/%d",session->authority_fd);if(size<=0||(size_t)size>=sizeof(path))return-1;int probe=open(path,O_RDWR|O_CLOEXEC|O_NOCTTY);if(probe<0)return-1;struct flock other={.l_type=F_WRLCK,.l_whence=SEEK_SET,.l_start=0,.l_len=0};int exact=fstat(probe,&probe_state)==0&&probe_state.st_dev==state.st_dev&&probe_state.st_ino==state.st_ino&&fcntl(probe,F_OFD_GETLK,&other)==0&&other.l_type==F_WRLCK;int saved=errno;close(probe);if(!exact){errno=saved?saved:EACCES;return-1;}return 0;}
static int active_entry_matches(const struct active_session *entry,const struct rtea_session *session,uint64_t cookie,pid_t process){return entry->used&&entry->process_id==process&&entry->authority_dev==session->authority_dev&&entry->authority_ino==session->authority_ino&&entry->peer_cookie==cookie&&entry->operation==session->operation&&entry->readonly==session->readonly&&entry->supervisor_generation==session->supervisor_generation&&!strcmp(entry->session_handle,session->session_handle)&&!strcmp(entry->lease_proof_sha256,session->lease_proof_sha256)&&!strcmp(entry->authority_instance_sha256,session->authority_instance_sha256)&&!strcmp(entry->challenge_nonce,session->challenge_nonce);}
static int register_active_session(const struct rtea_session *session){uint64_t cookie;pid_t process=getpid();if(pthread_once(&active_sessions_atfork_once,register_active_sessions_atfork)!=0||active_sessions_atfork_status||peer_cookie(session->peer_channel_fd,&cookie)<0){errno=EACCES;return-1;}lock_active_sessions();pid_t owner=atomic_load_explicit(&active_sessions_process_id,memory_order_acquire);if(!owner){atomic_store_explicit(&active_sessions_process_id,process,memory_order_release);owner=process;}if(owner!=process){unlock_active_sessions();errno=EACCES;return-1;}size_t slot=RTEA_ACTIVE_SESSION_LIMIT;for(size_t i=0;i<RTEA_ACTIVE_SESSION_LIMIT;i++)if(!active_sessions[i].used){slot=i;break;}if(slot==RTEA_ACTIVE_SESSION_LIMIT){unlock_active_sessions();errno=ENOSPC;return-1;}struct active_session *entry=&active_sessions[slot];memset(entry,0,sizeof(*entry));entry->used=1;entry->process_id=process;entry->authority_dev=session->authority_dev;entry->authority_ino=session->authority_ino;entry->peer_cookie=cookie;entry->operation=session->operation;entry->readonly=session->readonly;entry->supervisor_generation=session->supervisor_generation;strcpy(entry->session_handle,session->session_handle);strcpy(entry->lease_proof_sha256,session->lease_proof_sha256);strcpy(entry->authority_instance_sha256,session->authority_instance_sha256);strcpy(entry->challenge_nonce,session->challenge_nonce);unlock_active_sessions();return 0;}
struct claimed_session {int authority_fd;int peer_channel_fd;uint64_t authority_dev;uint64_t authority_ino;};
static int claim_active_session(struct rtea_session *session,struct claimed_session *claim){pid_t process=getpid();lock_active_sessions();if(!session||session->authority_fd<0||session->peer_channel_fd<0||atomic_load_explicit(&active_sessions_process_id,memory_order_acquire)!=process){unlock_active_sessions();errno=ESTALE;return-1;}uint64_t cookie;if(peer_cookie(session->peer_channel_fd,&cookie)<0||exact_authority_ofd(session)<0){unlock_active_sessions();errno=ESTALE;return-1;}size_t slot=RTEA_ACTIVE_SESSION_LIMIT;for(size_t i=0;i<RTEA_ACTIVE_SESSION_LIMIT;i++)if(active_entry_matches(&active_sessions[i],session,cookie,process)){slot=i;break;}if(slot==RTEA_ACTIVE_SESSION_LIMIT){unlock_active_sessions();errno=ESTALE;return-1;}claim->authority_fd=session->authority_fd;claim->peer_channel_fd=session->peer_channel_fd;claim->authority_dev=session->authority_dev;claim->authority_ino=session->authority_ino;memset(&active_sessions[slot],0,sizeof(active_sessions[slot]));memset(session,0,sizeof(*session));session->authority_fd=-1;session->peer_channel_fd=-1;unlock_active_sessions();return 0;}
static int duplicate_active_peer(const struct rtea_session *session){pid_t process=getpid();lock_active_sessions();if(!session||session->authority_fd<0||session->peer_channel_fd<0||atomic_load_explicit(&active_sessions_process_id,memory_order_acquire)!=process){unlock_active_sessions();errno=ESTALE;return-1;}uint64_t cookie;if(peer_cookie(session->peer_channel_fd,&cookie)<0||exact_authority_ofd(session)<0){unlock_active_sessions();errno=ESTALE;return-1;}int found=0;for(size_t i=0;i<RTEA_ACTIVE_SESSION_LIMIT;i++)if(active_entry_matches(&active_sessions[i],session,cookie,process)){found=1;break;}int duplicate=found?fcntl(session->peer_channel_fd,F_DUPFD_CLOEXEC,3):-1;unlock_active_sessions();if(!found){errno=ESTALE;return-1;}return duplicate;}

static uid_t authority_uid(void) {
#ifdef RECOVERY_TARGET_ENGINE_AUTHORITY_TESTING
  return geteuid();
#else
  return 0;
#endif
}

static gid_t authority_gid(void) {
#ifdef RECOVERY_TARGET_ENGINE_AUTHORITY_TESTING
  return getegid();
#else
  return 0;
#endif
}

static int lower_hex(const char *value, size_t length) {
  if (!value || strlen(value) != length) return 0;
  for (size_t index = 0; index < length; index++)
    if (!((value[index] >= '0' && value[index] <= '9') || (value[index] >= 'a' && value[index] <= 'f'))) return 0;
  return 1;
}

static int uuid(const char *value) {
  if (!value || strlen(value) != RTEA_UUID_LENGTH) return 0;
  for (size_t index = 0; index < RTEA_UUID_LENGTH; index++) {
    if (index == 8 || index == 13 || index == 18 || index == 23) { if (value[index] != '-') return 0; }
    else if (!((value[index] >= '0' && value[index] <= '9') || (value[index] >= 'a' && value[index] <= 'f'))) return 0;
  }
  return value[14] >= '1' && value[14] <= '8' && strchr("89ab", value[19]) != NULL;
}

static int identifier(const char *value, size_t maximum) {
  size_t length = value ? strlen(value) : 0;
  if (!length || length > maximum || !((value[0] >= 'a' && value[0] <= 'z') || (value[0] >= '0' && value[0] <= '9'))) return 0;
  for (size_t index = 1; index < length; index++)
    if (!((value[index] >= 'a' && value[index] <= 'z') || (value[index] >= '0' && value[index] <= '9') ||
        value[index] == '_' || value[index] == '-')) return 0;
  return 1;
}

static int handle(const char *value) {
  size_t length = value ? strlen(value) : 0;
  if (length < 28 || length > 120 || memcmp(value, "rtea:v1:", 8) != 0) return 0;
  for (size_t index = 8; index < length; index++)
    if (!((value[index] >= 'A' && value[index] <= 'Z') || (value[index] >= 'a' && value[index] <= 'z') ||
        (value[index] >= '0' && value[index] <= '9') || value[index] == '_' || value[index] == '-' || value[index] == ':')) return 0;
  return 1;
}

static int u64(const char *value, uint64_t *output) {
  if (!value || !*value || (value[0] == '0' && value[1])) return 0;
  uint64_t result = 0;
  for (const char *cursor = value; *cursor; cursor++) {
    if (*cursor < '0' || *cursor > '9') return 0;
    unsigned digit = (unsigned)(*cursor - '0');
    if (result > (UINT64_MAX - digit) / 10u) return 0;
    result = result * 10u + digit;
  }
  *output = result; return 1;
}

static int next_value(const char **cursor, const char *end, const char *key, char *output, size_t capacity) {
  size_t key_length = strlen(key); const char *start = *cursor;
  if ((size_t)(end - start) <= key_length || memcmp(start, key, key_length) != 0) return 0;
  start += key_length; const char *newline = memchr(start, '\n', (size_t)(end - start));
  size_t length = newline ? (size_t)(newline - start) : capacity;
  if (!newline || !length || length >= capacity || memchr(start, '\0', length)) return 0;
  memcpy(output, start, length); output[length] = '\0'; *cursor = newline + 1; return 1;
}

static int next_u64(const char **cursor, const char *end, const char *key, uint64_t *output) {
  char value[32]; return next_value(cursor, end, key, value, sizeof(value)) && u64(value, output);
}

int rtea_parse_request(const void *frame, size_t frame_size, struct rtea_request *request) {
  if (!frame || !request || frame_size == 0 || frame_size > RTEA_MAX_FRAME_BYTES) { errno = EMSGSIZE; return -1; }
  const char *cursor = frame, *end = cursor + frame_size; char format[64], kind[32], operation[32];
  memset(request, 0, sizeof(*request));
  if (cursor[frame_size - 1] != '\n' || memchr(cursor, '\r', frame_size) || memchr(cursor, '\0', frame_size) ||
      !next_value(&cursor,end,"format=",format,sizeof(format)) || strcmp(format,"darshan-recovery-target-native-authority-v2") ||
      !next_value(&cursor,end,"kind=",kind,sizeof(kind)) || strcmp(kind,"ACQUIRE") ||
      !next_value(&cursor,end,"operation=",operation,sizeof(operation))) { errno = EPROTO; return -1; }
  if (!strcmp(operation,"INSPECT")) request->operation=RTEA_OPERATION_INSPECT;
  else if (!strcmp(operation,"PREPARE")) request->operation=RTEA_OPERATION_PREPARE;
  else if (!strcmp(operation,"STOP_RETAIN")) request->operation=RTEA_OPERATION_STOP_RETAIN;
  else { errno=EPROTO; return -1; }
  if (!next_value(&cursor,end,"installation_id=",request->installation_id,sizeof(request->installation_id)) ||
      !next_value(&cursor,end,"site_id=",request->site_id,sizeof(request->site_id)) ||
      !next_value(&cursor,end,"host_installation_id=",request->host_installation_id,sizeof(request->host_installation_id)) ||
      !next_value(&cursor,end,"operation_id=",request->operation_id,sizeof(request->operation_id)) ||
      !next_u64(&cursor,end,"generation=",&request->generation) ||
      !next_value(&cursor,end,"target_set_id=",request->target_set_id,sizeof(request->target_set_id)) ||
      !next_value(&cursor,end,"target_handle=",request->target_handle,sizeof(request->target_handle)) ||
      !next_value(&cursor,end,"profile_sha256=",request->profile_sha256,sizeof(request->profile_sha256)) ||
      !next_value(&cursor,end,"enrollment_sha256=",request->enrollment_sha256,sizeof(request->enrollment_sha256)) ||
      !next_value(&cursor,end,"admission_sha256=",request->admission_sha256,sizeof(request->admission_sha256)) ||
      !next_value(&cursor,end,"outer_envelope_sha256=",request->outer_envelope_sha256,sizeof(request->outer_envelope_sha256)) ||
      !next_value(&cursor,end,"request_sha256=",request->request_sha256,sizeof(request->request_sha256)) ||
      !next_value(&cursor,end,"authorization_sha256=",request->authorization_sha256,sizeof(request->authorization_sha256)) ||
      !next_u64(&cursor,end,"deadline_unix_ms=",&request->deadline_unix_ms) ||
      !next_value(&cursor,end,"supervisor_instance_sha256=",request->supervisor_instance_sha256,sizeof(request->supervisor_instance_sha256)) ||
      !next_u64(&cursor,end,"supervisor_generation=",&request->supervisor_generation) ||
      !next_u64(&cursor,end,"reconciled_generation=",&request->reconciled_generation) ||
      !next_value(&cursor,end,"challenge_nonce=",request->challenge_nonce,sizeof(request->challenge_nonce)) || cursor != end ||
      !uuid(request->installation_id) || !identifier(request->site_id,63) || !uuid(request->host_installation_id) ||
      !uuid(request->operation_id) || request->generation == 0 || !lower_hex(request->target_set_id,64) || !handle(request->target_handle) ||
      !lower_hex(request->profile_sha256,64) || !lower_hex(request->enrollment_sha256,64) || !lower_hex(request->admission_sha256,64) ||
      !lower_hex(request->outer_envelope_sha256,64) || !lower_hex(request->request_sha256,64) ||
      !lower_hex(request->authorization_sha256,64) || !lower_hex(request->supervisor_instance_sha256,64) ||
      request->supervisor_generation == 0 || !lower_hex(request->challenge_nonce,32)) { errno=EPROTO; return -1; }
  return 0;
}

int rtea_validate_private_channel(int channel_fd, uid_t expected_peer_uid, pid_t *peer_pid) {
  int domain = 0, type = 0, accepting = 0; socklen_t integer_size = sizeof(int);
  struct ucred peer; socklen_t peer_size = sizeof(peer); struct sockaddr_un local, remote;
  socklen_t local_size = sizeof(local), remote_size = sizeof(remote);
  if (channel_fd < 0 || getsockopt(channel_fd,SOL_SOCKET,SO_DOMAIN,&domain,&integer_size)<0 || domain!=AF_UNIX ||
      getsockopt(channel_fd,SOL_SOCKET,SO_TYPE,&type,&integer_size)<0 || type!=SOCK_SEQPACKET ||
      getsockopt(channel_fd,SOL_SOCKET,SO_ACCEPTCONN,&accepting,&integer_size)<0 || accepting ||
      getsockopt(channel_fd,SOL_SOCKET,SO_PEERCRED,&peer,&peer_size)<0 || peer_size!=sizeof(peer) ||
      peer.pid<=0 || peer.uid!=expected_peer_uid || getsockname(channel_fd,(struct sockaddr *)&local,&local_size)<0 ||
      getpeername(channel_fd,(struct sockaddr *)&remote,&remote_size)<0 || local.sun_family!=AF_UNIX || remote.sun_family!=AF_UNIX ||
      local_size!=offsetof(struct sockaddr_un,sun_path) || remote_size!=offsetof(struct sockaddr_un,sun_path)) {
    errno=EPERM; return -1;
  }
  if (peer_pid) *peer_pid=peer.pid;
  return 0;
}

static int random_hex(char output[65]) {
  unsigned char bytes[32]; ssize_t count;
  do { count=getrandom(bytes,sizeof(bytes),0); } while(count<0&&errno==EINTR);
  if(count!=(ssize_t)sizeof(bytes)) return -1;
  static const char hex[]="0123456789abcdef";
  for(size_t index=0;index<sizeof(bytes);index++){output[index*2]=hex[bytes[index]>>4];output[index*2+1]=hex[bytes[index]&15u];}
  output[64]='\0'; return 0;
}

static int sha256_parts(const void *left,size_t left_size,const void *right,size_t right_size,char output[65]) {
  int algorithm=socket(AF_ALG,SOCK_SEQPACKET|SOCK_CLOEXEC,0); if(algorithm<0)return -1;
  struct sockaddr_alg address={.salg_family=AF_ALG,.salg_type="hash",.salg_name="sha256"};
  if(bind(algorithm,(struct sockaddr *)&address,sizeof(address))<0){int saved=errno;close(algorithm);errno=saved;return -1;}
  int operation=accept4(algorithm,NULL,NULL,SOCK_CLOEXEC);close(algorithm);if(operation<0)return -1;
  struct iovec parts[2]={{.iov_base=(void *)left,.iov_len=left_size},{.iov_base=(void *)right,.iov_len=right_size}};
  struct msghdr message={.msg_iov=parts,.msg_iovlen=2};
  if(sendmsg(operation,&message,0)!=(ssize_t)(left_size+right_size)){int saved=errno?errno:EIO;close(operation);errno=saved;return -1;}
  unsigned char digest[32];ssize_t received=read(operation,digest,sizeof(digest));close(operation);if(received!=(ssize_t)sizeof(digest)){errno=EIO;return -1;}
  static const char hex[]="0123456789abcdef";for(size_t index=0;index<sizeof(digest);index++){output[index*2]=hex[digest[index]>>4];output[index*2+1]=hex[digest[index]&15u];}
  output[64]='\0';return 0;
}

static int validate_enrollment(const struct rtea_enrollment *value) {
  return value && uuid(value->installation_id) && identifier(value->site_id,63) && uuid(value->host_installation_id) &&
    lower_hex(value->enrollment_sha256,64) && lower_hex(value->profile_sha256,64) && lower_hex(value->admission_sha256,64) &&
    lower_hex(value->authority_instance_sha256,64) && value->supervisor_generation>0 &&
    value->reconciled_supervisor_generation<=value->supervisor_generation;
}

static int validate_authority_directory(int fd, struct stat *state) {
  return fstat(fd,state)==0 && S_ISDIR(state->st_mode) && state->st_uid==authority_uid() && state->st_gid==authority_gid() &&
    (state->st_mode&0777)==0700 ? 0 : (errno=EPERM,-1);
}

static int channel_cancelled(int fd) {
  struct pollfd descriptor={.fd=fd,.events=POLLRDHUP|POLLHUP};int result;
  do{result=poll(&descriptor,1,0);}while(result<0&&errno==EINTR);
  if(result<0)return -1;
  if(result>0&&(descriptor.revents&(POLLRDHUP|POLLHUP|POLLERR|POLLNVAL))){errno=ECANCELED;return 1;}
  return 0;
}

#define RTEA_MAX_DURABLE_STATES 128u
struct durable_state { uint64_t generation,reconciled;char instance[65];int intent,commit; };

static int state_record(const struct durable_state *state,const char *phase,char *output,size_t capacity) {
  int length=snprintf(output,capacity,"format=darshan-recovery-target-engine-authority-state-v2\nphase=%s\nauthority_instance_sha256=%s\nsupervisor_generation=%020llu\nreconciled_generation=%020llu\n",
    phase,state->instance,(unsigned long long)state->generation,(unsigned long long)state->reconciled);
  return length>0&&(size_t)length<capacity?length:-1;
}

static int state_name(const struct durable_state *state,const char *phase,char *output,size_t capacity) {
  int length=snprintf(output,capacity,"engine-authority-state-%020llu-%020llu-%s.%s",
    (unsigned long long)state->generation,(unsigned long long)state->reconciled,state->instance,phase);
  return length>0&&(size_t)length<capacity?0:-1;
}

static int read_exact_record(int directory_fd,const char *name,const char *expected,size_t expected_size,dev_t device) {
  int fd=openat(directory_fd,name,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);struct stat state;char bytes[512],extra;
  if(fd<0||fstat(fd,&state)<0||!S_ISREG(state.st_mode)||state.st_nlink!=1||state.st_uid!=authority_uid()||
      state.st_gid!=authority_gid()||(state.st_mode&0777)!=0600||state.st_dev!=device||state.st_size!=(off_t)expected_size){if(fd>=0)close(fd);errno=EPERM;return -1;}
  ssize_t count=pread(fd,bytes,sizeof(bytes),0),more=pread(fd,&extra,1,(off_t)expected_size);struct stat after;
  int valid=count==(ssize_t)expected_size&&more==0&&!memcmp(bytes,expected,expected_size)&&fstat(fd,&after)==0&&
    state.st_dev==after.st_dev&&state.st_ino==after.st_ino&&state.st_size==after.st_size&&
    state.st_mtim.tv_sec==after.st_mtim.tv_sec&&state.st_mtim.tv_nsec==after.st_mtim.tv_nsec;
  close(fd);if(!valid){errno=EPROTO;return -1;}return 0;
}

static int parse_state_name(const char *name,struct durable_state *state,char phase[7]) {
  unsigned long long generation=0,reconciled=0;char instance[65],parsed_phase[7];int consumed=0;
  if(sscanf(name,"engine-authority-state-%20llu-%20llu-%64[0-9a-f].%6[a-z]%n",&generation,&reconciled,instance,parsed_phase,&consumed)!=4||
      name[consumed]||strlen(instance)!=64||
      (strcmp(parsed_phase,"intent")&&strcmp(parsed_phase,"commit"))||generation==0||reconciled>generation)return 0;
  state->generation=(uint64_t)generation;state->reconciled=(uint64_t)reconciled;memcpy(state->instance,instance,65);strcpy(phase,parsed_phase);
  char canonical[192];return state_name(state,phase,canonical,sizeof(canonical))==0&&!strcmp(name,canonical);
}

static int scan_states(int directory_fd,dev_t device,int anchor_created,struct durable_state *latest,struct durable_state *pending) {
  int scan=openat(directory_fd,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(scan<0)return -1;
  DIR *directory=fdopendir(scan);if(!directory){close(scan);return -1;}
  struct durable_state states[RTEA_MAX_DURABLE_STATES];size_t count=0;struct dirent *entry;errno=0;
  while((entry=readdir(directory))!=NULL){
    if(!strncmp(entry->d_name,"engine-authority-challenge-",27)){
      size_t length=strlen(entry->d_name);char challenge[33];
      if(length!=64||strcmp(entry->d_name+59,".seen")){closedir(directory);errno=EPROTO;return -1;}
      memcpy(challenge,entry->d_name+27,32);challenge[32]='\0';if(!lower_hex(challenge,32)){closedir(directory);errno=EPROTO;return -1;}
      char expected[128];int expected_size=snprintf(expected,sizeof(expected),"format=darshan-recovery-target-engine-authority-challenge-v1\nchallenge_nonce=%s\n",challenge);
      if(expected_size<=0||(size_t)expected_size>=sizeof(expected)||read_exact_record(directory_fd,entry->d_name,expected,(size_t)expected_size,device)<0){closedir(directory);return -1;}
      continue;
    }
    if(strncmp(entry->d_name,"engine-authority-state-",23))continue;
    struct durable_state parsed={0};char phase[7];if(!parse_state_name(entry->d_name,&parsed,phase)){closedir(directory);errno=EPROTO;return -1;}
    size_t index=0;for(;index<count;index++)if(states[index].generation==parsed.generation&&states[index].reconciled==parsed.reconciled&&!strcmp(states[index].instance,parsed.instance))break;
    if(index==count){if(count==RTEA_MAX_DURABLE_STATES){closedir(directory);errno=E2BIG;return -1;}states[count++]=parsed;}
    char expected[320];int expected_size=state_record(&parsed,phase,expected,sizeof(expected));
    if(expected_size<0||read_exact_record(directory_fd,entry->d_name,expected,(size_t)expected_size,device)<0){closedir(directory);return -1;}
    if(!strcmp(phase,"intent")){if(states[index].intent){closedir(directory);errno=EPROTO;return -1;}states[index].intent=1;}
    else {if(states[index].commit){closedir(directory);errno=EPROTO;return -1;}states[index].commit=1;}
  }
  int saved=errno;closedir(directory);if(saved){errno=saved;return -1;}memset(latest,0,sizeof(*latest));memset(pending,0,sizeof(*pending));
  for(size_t index=0;index<count;index++){
    if(states[index].commit&&!states[index].intent){errno=EPROTO;return -1;}
    if(states[index].intent&&!states[index].commit){if(pending->generation){errno=ESTALE;return -1;}*pending=states[index];continue;}
    if(states[index].commit&&(states[index].generation>latest->generation||
        (states[index].generation==latest->generation&&states[index].reconciled>latest->reconciled)))*latest=states[index];
  }
  for(size_t left=0;left<count;left++)for(size_t right=left+1;right<count;right++)if(states[left].commit&&states[right].commit){
    const struct durable_state *older=states[left].generation<states[right].generation||
      (states[left].generation==states[right].generation&&states[left].reconciled<states[right].reconciled)?&states[left]:&states[right];
    const struct durable_state *newer=older==&states[left]?&states[right]:&states[left];
    if((older->generation==newer->generation&&strcmp(older->instance,newer->instance))||older->reconciled>newer->reconciled||
        (!strcmp(older->instance,newer->instance)&&older->generation!=newer->generation)){errno=ESTALE;return -1;}
  }
  if(!anchor_created&&!latest->generation&&!pending->generation){errno=EPROTO;return -1;}
  if(anchor_created&&count){errno=EPROTO;return -1;}
  if(pending->generation&&(pending->generation<latest->generation||
      (pending->generation==latest->generation&&pending->reconciled<=latest->reconciled))){errno=ESTALE;return -1;}
  return 0;
}

static int fault(const char *point) {
#ifdef RECOVERY_TARGET_ENGINE_AUTHORITY_TESTING
  const char *selected=getenv("RTEA_TEST_DURABLE_FAULT");if(selected&&!strcmp(selected,point)){errno=EIO;return 1;}
#else
  (void)point;
#endif
  return 0;
}

static int publish_record(int directory_fd,const char *name,const char *bytes,size_t size,const char *phase) {
  int temporary=openat(directory_fd,".",O_WRONLY|O_TMPFILE|O_CLOEXEC,0600);if(temporary<0)return -1;
  if(fchmod(temporary,0600)<0||fchown(temporary,authority_uid(),authority_gid())<0){close(temporary);return -1;}
  if(linkat(temporary,"",directory_fd,name,AT_EMPTY_PATH)<0){
    if(errno==EEXIST){close(temporary);struct stat directory;if(validate_authority_directory(directory_fd,&directory)<0)return -1;return read_exact_record(directory_fd,name,bytes,size,directory.st_dev)==0?1:-1;}
    close(temporary);return -1;
  }
  char point[64];(void)snprintf(point,sizeof(point),"%s-link",phase);if(fault(point)){close(temporary);return -1;}
  (void)snprintf(point,sizeof(point),"%s-directory-fsync",phase);if(fsync(directory_fd)<0||fault(point)){close(temporary);return -1;}
  size_t offset=0;while(offset<size){ssize_t count=write(temporary,bytes+offset,size-offset);if(count<0&&errno==EINTR)continue;if(count<=0){close(temporary);return -1;}offset+=(size_t)count;}
  (void)snprintf(point,sizeof(point),"%s-write",phase);if(fault(point)){close(temporary);return -1;}
  (void)snprintf(point,sizeof(point),"%s-file-fsync",phase);if(fsync(temporary)<0||fault(point)){close(temporary);return -1;}
  close(temporary);return 0;
}

static int publish_state(int directory_fd,const struct durable_state *state,const char *phase) {
  char name[192],record[320];int size=state_record(state,phase,record,sizeof(record));
  if(size<0||state_name(state,phase,name,sizeof(name))<0)return -1;
  return publish_record(directory_fd,name,record,(size_t)size,phase);
}

static int publish_challenge(int directory_fd,const char challenge[33]) {
  char name[96],record[128];int name_size=snprintf(name,sizeof(name),"engine-authority-challenge-%s.seen",challenge);
  int size=snprintf(record,sizeof(record),"format=darshan-recovery-target-engine-authority-challenge-v1\nchallenge_nonce=%s\n",challenge);
  if(name_size<=0||(size_t)name_size>=sizeof(name)||size<=0||(size_t)size>=sizeof(record))return -1;
  int result=publish_record(directory_fd,name,record,(size_t)size,"challenge");if(result==1){errno=EALREADY;return -1;}return result;
}

static int current_time_milliseconds(uint64_t fixture_now,uint64_t *output) {
#ifdef RECOVERY_TARGET_ENGINE_AUTHORITY_TESTING
  *output=fixture_now;return 0;
#else
  (void)fixture_now;struct timespec now;if(clock_gettime(CLOCK_REALTIME,&now)<0)return -1;
  if(now.tv_sec<0||(uint64_t)now.tv_sec>UINT64_MAX/1000u){errno=EOVERFLOW;return -1;}
  *output=(uint64_t)now.tv_sec*1000u+(uint64_t)now.tv_nsec/1000000u;return 0;
#endif
}

int rtea_acquire_session(int directory_fd,int channel_fd,const struct rtea_enrollment *enrollment,
    const void *frame,size_t frame_size,uint64_t fixture_now_ms,struct rtea_session *session) {
  struct rtea_request request;struct stat directory,locked,named;char token[65];int created=0,fd=-1;uint64_t now_ms=0;
  if(!session||!validate_enrollment(enrollment)||validate_authority_directory(directory_fd,&directory)<0||
      rtea_validate_private_channel(channel_fd,enrollment->supervisor_peer_uid,NULL)<0||rtea_parse_request(frame,frame_size,&request)<0||
      channel_cancelled(channel_fd)!=0||current_time_milliseconds(fixture_now_ms,&now_ms)<0){if(errno!=ECANCELED)errno=EPERM;return -1;}
  if(strcmp(request.installation_id,enrollment->installation_id)||strcmp(request.site_id,enrollment->site_id)||
      strcmp(request.host_installation_id,enrollment->host_installation_id)||strcmp(request.enrollment_sha256,enrollment->enrollment_sha256)||
      strcmp(request.profile_sha256,enrollment->profile_sha256)||strcmp(request.admission_sha256,enrollment->admission_sha256)||
      strcmp(request.supervisor_instance_sha256,enrollment->authority_instance_sha256)||
      request.supervisor_generation!=enrollment->supervisor_generation||request.deadline_unix_ms<=now_ms||
      request.deadline_unix_ms-now_ms>RTEA_MAX_DEADLINE_SKEW_MS||
      request.reconciled_generation!=enrollment->reconciled_supervisor_generation){errno=EPERM;return -1;}
  if(request.operation!=RTEA_OPERATION_INSPECT && enrollment->reconciled_supervisor_generation!=request.supervisor_generation){errno=ESTALE;return -1;}
  fd=openat(directory_fd,RTEA_AUTHORITY_FILE,O_RDWR|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);
  if(fd<0&&errno==ENOENT){fd=openat(directory_fd,RTEA_AUTHORITY_FILE,O_RDWR|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK,0600);if(fd>=0)created=1;}
  if(fd<0||(created&&(fchmod(fd,0600)<0||fchown(fd,authority_uid(),authority_gid())<0))||fstat(fd,&locked)<0||
      !S_ISREG(locked.st_mode)||locked.st_nlink!=1||locked.st_uid!=authority_uid()||locked.st_gid!=authority_gid()||
      (locked.st_mode&0777)!=0600||locked.st_dev!=directory.st_dev||locked.st_size!=0){if(fd>=0)close(fd);errno=EPERM;return -1;}
  struct flock lock={.l_type=F_WRLCK,.l_whence=SEEK_SET,.l_start=0,.l_len=0};
  if(fcntl(fd,F_OFD_SETLK,&lock)<0){int saved=errno;close(fd);errno=saved;return -1;}
#ifdef RECOVERY_TARGET_ENGINE_AUTHORITY_TESTING
  if(getenv("RTEA_TEST_SUBSTITUTE_AFTER_LOCK")){
    (void)renameat(directory_fd,RTEA_AUTHORITY_FILE,directory_fd,"engine-authority.substituted");
    int replacement=openat(directory_fd,RTEA_AUTHORITY_FILE,O_RDWR|O_CREAT|O_EXCL|O_CLOEXEC,0600);
    if(replacement>=0)close(replacement);
  }
#endif
  if(fstatat(directory_fd,RTEA_AUTHORITY_FILE,&named,AT_SYMLINK_NOFOLLOW)<0||named.st_dev!=locked.st_dev||named.st_ino!=locked.st_ino||
      named.st_nlink!=1||!S_ISREG(named.st_mode)){close(fd);errno=ESTALE;return -1;}
  if(channel_cancelled(channel_fd)!=0){close(fd);return -1;}
  struct durable_state latest={0},pending={0},desired={.generation=enrollment->supervisor_generation,
    .reconciled=enrollment->reconciled_supervisor_generation};memcpy(desired.instance,enrollment->authority_instance_sha256,65);
  if(scan_states(directory_fd,directory.st_dev,created,&latest,&pending)<0||random_hex(token)<0){close(fd);return -1;}
  if(pending.generation&&(pending.generation!=desired.generation||pending.reconciled!=desired.reconciled||strcmp(pending.instance,desired.instance))){close(fd);errno=ESTALE;return -1;}
  if(latest.generation){
    if(!strcmp(latest.instance,desired.instance)){
      if(latest.generation!=desired.generation||desired.reconciled<latest.reconciled){close(fd);errno=ESTALE;return -1;}
    }else if(desired.generation<=latest.generation||desired.reconciled<latest.reconciled){close(fd);errno=ESTALE;return -1;}
  }
  int same=latest.generation==desired.generation&&latest.reconciled==desired.reconciled&&!strcmp(latest.instance,desired.instance);
  if(!same){
    if(!pending.generation&&publish_state(directory_fd,&desired,"intent")<0){close(fd);return -1;}
    if(publish_state(directory_fd,&desired,"commit")<0){close(fd);return -1;}
  }
  if(publish_challenge(directory_fd,request.challenge_nonce)<0){close(fd);return -1;}
  if(validate_authority_directory(directory_fd,&directory)<0||fstatat(directory_fd,RTEA_AUTHORITY_FILE,&named,AT_SYMLINK_NOFOLLOW)<0||
      named.st_dev!=locked.st_dev||named.st_ino!=locked.st_ino){close(fd);return -1;}
  uint64_t final_fixture_now=fixture_now_ms;
#ifdef RECOVERY_TARGET_ENGINE_AUTHORITY_TESTING
  if(getenv("RTEA_TEST_EXPIRE_AFTER_FSYNC"))final_fixture_now=request.deadline_unix_ms;
#endif
  if(current_time_milliseconds(final_fixture_now,&now_ms)<0||request.deadline_unix_ms<=now_ms||channel_cancelled(channel_fd)!=0){close(fd);errno=ETIMEDOUT;return -1;}
  int peer_channel=fcntl(channel_fd,F_DUPFD_CLOEXEC,3);if(peer_channel<0){close(fd);return -1;}
  memset(session,0,sizeof(*session));session->authority_fd=fd;session->peer_channel_fd=peer_channel;
  session->authority_dev=(uint64_t)locked.st_dev;session->authority_ino=(uint64_t)locked.st_ino;
  session->operation=request.operation;session->readonly=request.operation==RTEA_OPERATION_INSPECT;
  session->reconciliation_required=enrollment->reconciled_supervisor_generation!=request.supervisor_generation;
  if(snprintf(session->session_handle,sizeof(session->session_handle),"rtea:v1:session:%s",token)<=0||
      sha256_parts(frame,frame_size,token,64,session->lease_proof_sha256)<0){close(peer_channel);close(fd);session->peer_channel_fd=-1;session->authority_fd=-1;return -1;}
  memcpy(session->authority_instance_sha256,enrollment->authority_instance_sha256,65);
  memcpy(session->challenge_nonce,request.challenge_nonce,33);
  session->supervisor_generation=enrollment->supervisor_generation;
  if(register_active_session(session)<0){int saved=errno;close(peer_channel);close(fd);memset(session,0,sizeof(*session));session->authority_fd=-1;session->peer_channel_fd=-1;errno=saved;return-1;}
  return 0;
}

int rtea_validate_active_session(const struct rtea_session *session){
  pid_t process=getpid();lock_active_sessions();
  if(!session||session->authority_fd<0||session->peer_channel_fd<0||atomic_load_explicit(&active_sessions_process_id,memory_order_acquire)!=process){unlock_active_sessions();errno=EACCES;return-1;}
  struct stat state,probe_state;uint64_t cookie=0;struct flock own={.l_type=F_WRLCK,.l_whence=SEEK_SET,.l_start=0,.l_len=0};
  if(fstat(session->authority_fd,&state)<0||!S_ISREG(state.st_mode)||state.st_nlink!=1||(state.st_mode&0777)!=0600||
      (uint64_t)state.st_dev!=session->authority_dev||(uint64_t)state.st_ino!=session->authority_ino||
      fcntl(session->authority_fd,F_OFD_GETLK,&own)<0||own.l_type!=F_UNLCK||peer_cookie(session->peer_channel_fd,&cookie)<0){unlock_active_sessions();errno=EACCES;return-1;}
  if(channel_cancelled(session->peer_channel_fd)!=0){int saved=errno;unlock_active_sessions();errno=saved;return-1;}
  char path[64];int size=snprintf(path,sizeof(path),"/proc/self/fd/%d",session->authority_fd);
  if(size<=0||(size_t)size>=sizeof(path)){unlock_active_sessions();errno=EACCES;return-1;}
  int probe=open(path,O_RDWR|O_CLOEXEC|O_NOCTTY);if(probe<0){unlock_active_sessions();errno=EACCES;return-1;}
  struct flock other={.l_type=F_WRLCK,.l_whence=SEEK_SET,.l_start=0,.l_len=0};
  int proof=fstat(probe,&probe_state)==0&&probe_state.st_dev==state.st_dev&&probe_state.st_ino==state.st_ino&&
    fcntl(probe,F_OFD_GETLK,&other)==0&&other.l_type==F_WRLCK;
  close(probe);if(!proof){unlock_active_sessions();errno=EACCES;return-1;}
  int found=0;for(size_t i=0;i<RTEA_ACTIVE_SESSION_LIMIT;i++)if(active_entry_matches(&active_sessions[i],session,cookie,process)){found=1;break;}unlock_active_sessions();if(!found){errno=EACCES;return-1;}return 0;
}

int rtea_encode_session_result(const struct rtea_session *session,char *output,size_t output_size) {
  if(!session||session->authority_fd<0||!handle(session->session_handle)||!lower_hex(session->lease_proof_sha256,64)||
      !lower_hex(session->authority_instance_sha256,64)||!lower_hex(session->challenge_nonce,32)||!output){errno=EINVAL;return -1;}
  int length=snprintf(output,output_size,"format=darshan-recovery-target-native-authority-result-v2\nkind=ACQUIRED\noutcome=%s\nsession_handle=%s\nlease_proof_sha256=%s\nauthority_instance_sha256=%s\nsupervisor_generation=%llu\nreconciliation_required=%s\nsanitized_code=OK\nchallenge_nonce=%s\n",
    session->readonly?"READONLY":"LEASED",session->session_handle,session->lease_proof_sha256,session->authority_instance_sha256,
    (unsigned long long)session->supervisor_generation,session->reconciliation_required?"true":"false",session->challenge_nonce);
  if(length<=0||(size_t)length>=output_size||(size_t)length>RTEA_MAX_RESULT_BYTES){errno=EMSGSIZE;return -1;}return length;
}

int rtea_release_session(struct rtea_session *session) {
  struct claimed_session claim;if(claim_active_session(session,&claim)<0)return-1;struct stat state;int result=0,saved=0;
  if(fstat(claim.authority_fd,&state)<0||(uint64_t)state.st_dev!=claim.authority_dev||(uint64_t)state.st_ino!=claim.authority_ino){result=-1;saved=errno?errno:ESTALE;}
  if(close(claim.peer_channel_fd)<0&&!result){result=-1;saved=errno;}if(close(claim.authority_fd)<0&&!result){result=-1;saved=errno;}if(result)errno=saved;return result;
}

int rtea_release_on_peer_death(struct rtea_session *session,int timeout_milliseconds) {
  if(timeout_milliseconds<0){errno=EINVAL;return -1;}int peer=duplicate_active_peer(session);if(peer<0)return-1;
  struct pollfd descriptor={.fd=peer,.events=POLLRDHUP|POLLHUP};int result;
  do{result=poll(&descriptor,1,timeout_milliseconds);}while(result<0&&errno==EINTR);
  int saved=errno;close(peer);errno=saved;if(result<0)return -1;
  if(result==0||!(descriptor.revents&(POLLRDHUP|POLLHUP|POLLERR|POLLNVAL))){if(rtea_validate_active_session(session)<0)return-1;errno=EAGAIN;return -1;}
  return rtea_release_session(session);
}
