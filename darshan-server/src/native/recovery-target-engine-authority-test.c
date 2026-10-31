#define _GNU_SOURCE
#include "recovery-target-engine-authority.h"

#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

static const char *a64="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
static const char *b64="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
static const char *c64="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
static const char *d64="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
static const char *e64="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
static const char *f64="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
static unsigned challenge_counter=1;

static int check(int condition,const char *name,unsigned *passed){if(!condition){fprintf(stderr,"failed: %s errno=%d\n",name,errno);return -1;}(*passed)++;return 0;}
static int directory(int parent,const char *name){if(mkdirat(parent,name,0700)<0)return -1;return openat(parent,name,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);}
static struct rtea_enrollment enrollment(void){struct rtea_enrollment value={0};
  strcpy(value.installation_id,"10000000-0000-4000-8000-000000000001");strcpy(value.site_id,"fixture_site");
  strcpy(value.host_installation_id,"20000000-0000-4000-8000-000000000002");strcpy(value.enrollment_sha256,a64);
  strcpy(value.profile_sha256,b64);strcpy(value.admission_sha256,c64);strcpy(value.authority_instance_sha256,d64);
  value.supervisor_peer_uid=geteuid();value.supervisor_generation=7;value.reconciled_supervisor_generation=7;return value;}
static int frame(char *output,size_t capacity,const struct rtea_enrollment *enrolled,const char *operation,uint64_t generation,
    uint64_t deadline,uint64_t supervisor_generation,uint64_t reconciled,const char *site,const char *profile){
  return snprintf(output,capacity,
    "format=darshan-recovery-target-native-authority-v2\nkind=ACQUIRE\noperation=%s\ninstallation_id=%s\nsite_id=%s\nhost_installation_id=%s\noperation_id=30000000-0000-4000-8000-000000000003\ngeneration=%llu\ntarget_set_id=%s\ntarget_handle=rtea:v1:target:abcdefghijklmnop\nprofile_sha256=%s\nenrollment_sha256=%s\nadmission_sha256=%s\nouter_envelope_sha256=%s\nrequest_sha256=%s\nauthorization_sha256=%s\ndeadline_unix_ms=%llu\nsupervisor_instance_sha256=%s\nsupervisor_generation=%llu\nreconciled_generation=%llu\nchallenge_nonce=%032x\n",
    operation,enrolled->installation_id,site?site:enrolled->site_id,enrolled->host_installation_id,(unsigned long long)generation,
    e64,profile?profile:enrolled->profile_sha256,enrolled->enrollment_sha256,enrolled->admission_sha256,f64,e64,f64,
    (unsigned long long)deadline,enrolled->authority_instance_sha256,(unsigned long long)supervisor_generation,(unsigned long long)reconciled,challenge_counter++);
}
static int channels(int pair[2]){return socketpair(AF_UNIX,SOCK_SEQPACKET|SOCK_CLOEXEC,0,pair);}
static int acquire(int root,int channel,const struct rtea_enrollment *enrolled,const char *bytes,size_t size,struct rtea_session *session){
  return rtea_acquire_session(root,channel,enrolled,bytes,size,1000000,session);
}
struct concurrent_acquire {int root;int channel;struct rtea_enrollment enrolled;char request[RTEA_MAX_FRAME_BYTES+2];size_t length;int result;};
static void *concurrent_acquire_release(void *opaque){struct concurrent_acquire *args=opaque;struct rtea_session session;args->result=rtea_acquire_session(args->root,args->channel,&args->enrolled,args->request,args->length,1000000,&session);if(!args->result&&rtea_validate_active_session(&session)<0)args->result=-1;if(!args->result&&rtea_release_session(&session)<0)args->result=-1;return NULL;}
struct concurrent_release {struct rtea_session *session;int result;int error;};
static void *concurrent_release_session(void *opaque){struct concurrent_release *args=opaque;args->result=rtea_release_session(args->session);args->error=errno;return NULL;}

int main(int argc,char **argv){
  if(argc!=2)return 64;
  int root=open(argv[1],O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(root<0)return 1;unsigned passed=0;
  struct rtea_enrollment enrolled=enrollment();char request[RTEA_MAX_FRAME_BYTES+2];int length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
  int pair[2];if(length<=0||channels(pair)<0)return 1;struct rtea_request parsed;
  if(check(rtea_parse_request(request,(size_t)length,&parsed)==0&&parsed.operation==RTEA_OPERATION_PREPARE&&parsed.generation==9,
      "canonical-request",&passed)<0)return 1;
  struct concurrent_acquire initial[4];pthread_t initial_threads[4];int initial_remote[4],initial_ok=1;for(size_t i=0;i<4;i++){char name[64];snprintf(name,sizeof(name),"concurrent-initial-%zu",i);initial[i].root=directory(root,name);initial[i].channel=-1;int concurrent_pair[2];if(initial[i].root<0||channels(concurrent_pair)<0)return 1;initial[i].channel=concurrent_pair[0];initial_remote[i]=concurrent_pair[1];initial[i].enrolled=enrolled;int concurrent_length=frame(initial[i].request,sizeof(initial[i].request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);if(concurrent_length<=0)return 1;initial[i].length=(size_t)concurrent_length;initial[i].result=-1;if(pthread_create(&initial_threads[i],NULL,concurrent_acquire_release,&initial[i])!=0)return 1;}for(size_t i=0;i<4;i++){if(pthread_join(initial_threads[i],NULL)!=0||initial[i].result<0)initial_ok=0;close(initial[i].channel);close(initial_remote[i]);close(initial[i].root);}if(check(initial_ok,"concurrent-initial-registry-registration-release",&passed)<0)return 1;
  struct rtea_session session;if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)==0,"lease-acquire",&passed)<0)return 1;
  if(check(rtea_validate_active_session(&session)==0,"active-session-witness",&passed)<0)return 1;
  int replacement_pair[2];if(channels(replacement_pair)<0)return 1;struct rtea_session replacement=session;replacement.peer_channel_fd=replacement_pair[0];if(check(rtea_validate_active_session(&replacement)<0,"peer-cookie-substitution",&passed)<0)return 1;close(replacement_pair[0]);close(replacement_pair[1]);
  int ordinary_authority=openat(root,RTEA_AUTHORITY_FILE,O_RDWR|O_CLOEXEC|O_NOFOLLOW);if(ordinary_authority<0)return 1;replacement=session;replacement.authority_fd=ordinary_authority;int wrong_ofd_release=rtea_release_session(&replacement)<0&&(errno==ESTALE||errno==EACCES)&&rtea_validate_active_session(&session)==0;if(check(wrong_ofd_release,"wrong-ofd-release-cannot-claim-or-close-live-session",&passed)<0)return 1;close(ordinary_authority);
  pid_t registry_child=fork();if(registry_child<0)return 1;if(registry_child==0)_exit(rtea_validate_active_session(&session)<0?0:1);int registry_status;if(waitpid(registry_child,&registry_status,0)!=registry_child||check(WIFEXITED(registry_status)&&WEXITSTATUS(registry_status)==0,"forked-registry-copy",&passed)<0)return 1;
  char result[RTEA_MAX_RESULT_BYTES];int result_size=rtea_encode_session_result(&session,result,sizeof(result));
  if(check(result_size>0&&strstr(result,"outcome=LEASED\n")&&strstr(result,"reconciliation_required=false\n"),"sanitized-result",&passed)<0)return 1;
  struct rtea_session contender;if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&contender)<0&&(errno==EAGAIN||errno==EACCES),"ofd-contention",&passed)<0)return 1;
  struct rtea_session released=session;if(rtea_release_session(&session)<0)return 1;int reopened=openat(root,RTEA_AUTHORITY_FILE,O_RDWR|O_CLOEXEC|O_NOFOLLOW);if(reopened<0||channels(replacement_pair)<0)return 1;released.authority_fd=reopened;released.peer_channel_fd=replacement_pair[0];if(check(rtea_validate_active_session(&released)<0,"released-session-reopened-fd-replay",&passed)<0)return 1;close(reopened);close(replacement_pair[0]);close(replacement_pair[1]);
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)<0&&errno==EALREADY,
      "released-challenge-replay",&passed)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&contender)==0&&rtea_release_session(&contender)==0,
      "session-lifetime-release",&passed)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
  int death_pair[2];if(channels(death_pair)<0||acquire(root,death_pair[0],&enrolled,request,(size_t)length,&session)<0)return 1;
  close(death_pair[1]);
  if(rtea_release_on_peer_death(&session,1000)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&contender)==0&&rtea_release_session(&contender)==0,"worker-death-release",&passed)<0)return 1;
  close(death_pair[0]);
  int reuse_root=directory(root,"natural-fd-reuse");if(reuse_root<0)return 1;length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);struct rtea_session first_reuse,second_reuse;if(acquire(reuse_root,pair[0],&enrolled,request,(size_t)length,&first_reuse)<0)return 1;struct rtea_session stale_reuse=first_reuse;int old_authority_fd=first_reuse.authority_fd,old_peer_fd=first_reuse.peer_channel_fd;if(rtea_release_session(&first_reuse)<0)return 1;length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);if(acquire(reuse_root,pair[0],&enrolled,request,(size_t)length,&second_reuse)<0)return 1;int naturally_reused=second_reuse.authority_fd==old_authority_fd&&second_reuse.peer_channel_fd==old_peer_fd;int stale_death=rtea_release_on_peer_death(&stale_reuse,0)<0&&(errno==ESTALE||errno==EACCES)&&rtea_validate_active_session(&second_reuse)==0;if(check(naturally_reused&&stale_death,"stale-peer-death-cannot-release-reused-new-lease",&passed)<0)return 1;int stale_direct=rtea_release_session(&stale_reuse)<0&&(errno==ESTALE||errno==EACCES)&&rtea_validate_active_session(&second_reuse)==0;int valid_new_release=rtea_release_session(&second_reuse)==0;if(check(stale_direct&&valid_new_release,"stale-direct-release-cannot-close-reused-valid-lease",&passed)<0)return 1;close(reuse_root);
  int double_root=directory(root,"concurrent-double-release");if(double_root<0)return 1;length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);if(acquire(double_root,pair[0],&enrolled,request,(size_t)length,&session)<0)return 1;struct concurrent_release releases[2]={{.session=&session,.result=99,.error=0},{.session=&session,.result=99,.error=0}};pthread_t release_threads[2];if(pthread_create(&release_threads[0],NULL,concurrent_release_session,&releases[0])!=0||pthread_create(&release_threads[1],NULL,concurrent_release_session,&releases[1])!=0)return 1;if(pthread_join(release_threads[0],NULL)!=0||pthread_join(release_threads[1],NULL)!=0)return 1;int one_success=(releases[0].result==0)^(releases[1].result==0);int one_stale=(releases[0].result<0&&(releases[0].error==ESTALE||releases[0].error==EACCES))||(releases[1].result<0&&(releases[1].error==ESTALE||releases[1].error==EACCES));if(check(one_success&&one_stale,"concurrent-double-release-has-one-exact-claimant",&passed)<0)return 1;close(double_root);

  int pipefd[2];if(pipe(pipefd)<0)return 1;
  if(check(rtea_validate_private_channel(pipefd[0],geteuid(),NULL)<0,"wrong-channel-fd",&passed)<0)return 1;
  if(check(rtea_validate_private_channel(pair[0],geteuid()+1,NULL)<0,"wrong-kernel-peer",&passed)<0)return 1;
  close(pipefd[0]);close(pipefd[1]);
  char changed[RTEA_MAX_FRAME_BYTES+2];memcpy(changed,request,(size_t)length+1);
  if(check(rtea_parse_request(changed,(size_t)length-1,&parsed)<0,"partial-frame",&passed)<0)return 1;
  changed[length]='x';if(check(rtea_parse_request(changed,(size_t)length+1,&parsed)<0,"trailing-frame",&passed)<0)return 1;
  memset(changed,'x',sizeof(changed));if(check(rtea_parse_request(changed,sizeof(changed),&parsed)<0&&errno==EMSGSIZE,"oversized-frame",&passed)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,"fixture-site",NULL);
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)<0,"site-substitution",&passed)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,a64);
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)<0,"profile-substitution",&passed)<0)return 1;
  struct rtea_enrollment impostors[4]={enrolled,enrolled,enrolled,enrolled};
  impostors[0].installation_id[0]='2';impostors[1].host_installation_id[0]='1';
  impostors[2].enrollment_sha256[0]='b';impostors[3].admission_sha256[0]='d';
  int enrollment_matrix=1;
  for(size_t index=0;index<4;index++){
    length=frame(request,sizeof(request),&impostors[index],"PREPARE",9,1001000,7,7,NULL,NULL);
    if(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)>=0){enrollment_matrix=0;(void)rtea_release_session(&session);}
  }
  if(check(enrollment_matrix,"installation-host-enrollment-admission-substitution",&passed)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
  if(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)<0)return 1;
  char first_proof[65];strcpy(first_proof,session.lease_proof_sha256);
  if(rtea_release_session(&session)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
  char *outer=strstr(request,"outer_envelope_sha256=");if(!outer)return 1;outer[strlen("outer_envelope_sha256=")]='d';
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)==0&&strcmp(first_proof,session.lease_proof_sha256),
      "outer-request-lease-proof-binding",&passed)<0)return 1;
  if(rtea_release_session(&session)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,999999,7,7,NULL,NULL);
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)<0,"expired-deadline",&passed)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1240001,7,7,NULL,NULL);
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)<0,"unbounded-deadline",&passed)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);if(setenv("RTEA_TEST_EXPIRE_AFTER_FSYNC","1",1)<0)return 1;
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)<0&&errno==ETIMEDOUT,"deadline-after-fsync",&passed)<0)return 1;
  unsetenv("RTEA_TEST_EXPIRE_AFTER_FSYNC");
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,8,8,NULL,NULL);
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)<0,"instance-generation-substitution",&passed)<0)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,6,NULL,NULL);
  if(check(acquire(root,pair[0],&enrolled,request,(size_t)length,&session)<0,"request-reconciliation-substitution",&passed)<0)return 1;
  struct rtea_enrollment restarted=enrolled;strcpy(restarted.authority_instance_sha256,e64);
  restarted.supervisor_generation=8;restarted.reconciled_supervisor_generation=7;
  length=frame(request,sizeof(request),&restarted,"PREPARE",9,1001000,8,7,NULL,NULL);
  if(check(acquire(root,pair[0],&restarted,request,(size_t)length,&session)<0&&errno==ESTALE,"restart-reconciliation-fence",&passed)<0)return 1;
  length=frame(request,sizeof(request),&restarted,"INSPECT",9,1001000,8,7,NULL,NULL);
  if(check(acquire(root,pair[0],&restarted,request,(size_t)length,&session)==0&&session.readonly&&session.reconciliation_required,
      "readonly-reconciliation-observation",&passed)<0)return 1;
  result_size=rtea_encode_session_result(&session,result,sizeof(result));
  if(check(result_size>0&&strstr(result,"outcome=READONLY\n")&&strstr(result,"reconciliation_required=true\n"),"readonly-result",&passed)<0)return 1;
  if(rtea_release_session(&session)<0)return 1;
  restarted.reconciled_supervisor_generation=8;
  length=frame(request,sizeof(request),&restarted,"PREPARE",9,1001000,8,8,NULL,NULL);
  if(check(acquire(root,pair[0],&restarted,request,(size_t)length,&session)==0&&rtea_release_session(&session)==0,
      "native-reconciliation-advances-fence",&passed)<0)return 1;
  struct rtea_enrollment rollback=restarted;strcpy(rollback.authority_instance_sha256,f64);
  length=frame(request,sizeof(request),&rollback,"INSPECT",9,1001000,8,8,NULL,NULL);
  if(check(acquire(root,pair[0],&rollback,request,(size_t)length,&session)<0&&errno==ESTALE,
      "same-generation-instance-rollback",&passed)<0)return 1;

  int cancelled[2];if(channels(cancelled)<0)return 1;close(cancelled[1]);length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
  if(check(acquire(root,cancelled[0],&enrolled,request,(size_t)length,&session)<0&&errno==ECANCELED,"cancellation-at-admission",&passed)<0)return 1;
  close(cancelled[0]);

  int mode_root=directory(root,"unsafe-mode");if(mode_root<0||fchmod(mode_root,0755)<0)return 1;
  if(check(acquire(mode_root,pair[0],&enrolled,request,(size_t)length,&session)<0,"unsafe-root-mode",&passed)<0)return 1;
  close(mode_root);
  int symlink_root=directory(root,"symlink-lock");if(symlink_root<0||symlinkat("missing",symlink_root,RTEA_AUTHORITY_FILE)<0)return 1;
  if(check(acquire(symlink_root,pair[0],&enrolled,request,(size_t)length,&session)<0,"symlink-lock",&passed)<0)return 1;
  close(symlink_root);
  int hard_root=directory(root,"hardlink-lock");int source=openat(hard_root,"source",O_CREAT|O_RDWR|O_CLOEXEC,0600);
  if(source<0||linkat(hard_root,"source",hard_root,RTEA_AUTHORITY_FILE,0)<0)return 1;
  close(source);
  if(check(acquire(hard_root,pair[0],&enrolled,request,(size_t)length,&session)<0,"multilink-lock",&passed)<0)return 1;
  close(hard_root);
  int badmode_root=directory(root,"badmode-lock");int badmode=openat(badmode_root,RTEA_AUTHORITY_FILE,O_CREAT|O_RDWR|O_CLOEXEC,0644);if(badmode<0)return 1;close(badmode);
  if(check(acquire(badmode_root,pair[0],&enrolled,request,(size_t)length,&session)<0,"wrong-lock-mode",&passed)<0)return 1;
  close(badmode_root);
  int corrupt_root=directory(root,"corrupt-lock");int corrupt=openat(corrupt_root,RTEA_AUTHORITY_FILE,O_CREAT|O_RDWR|O_CLOEXEC,0600);
  if(corrupt<0||write(corrupt,"bad\n",4)!=4)return 1;
  close(corrupt);
  if(check(acquire(corrupt_root,pair[0],&enrolled,request,(size_t)length,&session)<0,"corrupt-persistent-record",&passed)<0)return 1;
  close(corrupt_root);
  int empty_root=directory(root,"empty-existing-lock");int empty=openat(empty_root,RTEA_AUTHORITY_FILE,O_CREAT|O_RDWR|O_CLOEXEC,0600);if(empty<0)return 1;close(empty);
  if(check(acquire(empty_root,pair[0],&enrolled,request,(size_t)length,&session)<0,"existing-empty-anchor-without-state",&passed)<0)return 1;
  close(empty_root);
  int substitute_root=directory(root,"substitute-lock");if(substitute_root<0||setenv("RTEA_TEST_SUBSTITUTE_AFTER_LOCK","1",1)<0)return 1;
  if(check(acquire(substitute_root,pair[0],&enrolled,request,(size_t)length,&session)<0&&errno==ESTALE,"substituted-inode",&passed)<0)return 1;
  unsetenv("RTEA_TEST_SUBSTITUTE_AFTER_LOCK");close(substitute_root);

  const char *faults[]={"intent-link","intent-directory-fsync","intent-write","intent-file-fsync",
    "commit-link","commit-directory-fsync","commit-write","commit-file-fsync"};int crash_fence_ok=1;
  struct rtea_enrollment crash_restart=restarted;crash_restart.reconciled_supervisor_generation=7;
  for(size_t index=0;index<sizeof(faults)/sizeof(faults[0]);index++){
    char name[64];(void)snprintf(name,sizeof(name),"durable-fault-%zu",index);int fault_root=directory(root,name);if(fault_root<0)return 1;
    length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
    if(acquire(fault_root,pair[0],&enrolled,request,(size_t)length,&session)<0||rtea_release_session(&session)<0)return 1;
    length=frame(request,sizeof(request),&crash_restart,"INSPECT",9,1001000,8,7,NULL,NULL);if(setenv("RTEA_TEST_DURABLE_FAULT",faults[index],1)<0)return 1;
    if(acquire(fault_root,pair[0],&crash_restart,request,(size_t)length,&session)>=0){crash_fence_ok=0;(void)rtea_release_session(&session);}
    unsetenv("RTEA_TEST_DURABLE_FAULT");length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
    if(acquire(fault_root,pair[0],&enrolled,request,(size_t)length,&session)>=0){crash_fence_ok=0;(void)rtea_release_session(&session);}
    close(fault_root);
  }
  if(check(crash_fence_ok,"durable-state-crash-boundary-never-rolls-back",&passed)<0)return 1;

  int crash_root=directory(root,"crash-release");int child_pair[2],ready[2];if(crash_root<0||channels(child_pair)<0||pipe(ready)<0)return 1;
  pid_t child=fork();if(child==0){close(ready[0]);struct rtea_session held;if(acquire(crash_root,child_pair[0],&enrolled,request,(size_t)length,&held)<0)_exit(2);
    if(write(ready[1],"R",1)!=1)_exit(3);
    for(;;)pause();}
  close(ready[1]);char byte;if(read(ready[0],&byte,1)!=1)return 1;
  if(check(acquire(crash_root,pair[0],&enrolled,request,(size_t)length,&session)<0&&(errno==EAGAIN||errno==EACCES),"crash-lock-held",&passed)<0)return 1;
  kill(child,SIGKILL);if(waitpid(child,NULL,0)!=child)return 1;
  length=frame(request,sizeof(request),&enrolled,"PREPARE",9,1001000,7,7,NULL,NULL);
  if(check(acquire(crash_root,pair[0],&enrolled,request,(size_t)length,&session)==0&&rtea_release_session(&session)==0,"crash-ofd-release",&passed)<0)return 1;
  close(ready[0]);close(child_pair[0]);close(child_pair[1]);close(crash_root);
  close(pair[0]);close(pair[1]);close(root);printf("%u engine authority checks passed\n",passed);return passed==46?0:1;
}
