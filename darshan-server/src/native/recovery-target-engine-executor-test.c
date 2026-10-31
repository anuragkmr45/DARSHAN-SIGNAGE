#define _GNU_SOURCE
#include "recovery-target-engine-authority.h"
#include "recovery-target-engine-executor.h"
#include "recovery-target-engine-materialization.h"

#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <linux/if_alg.h>
#include <linux/stat.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static const char *a64="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
static const char *b64="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
static const char *c64="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
static const char *d64="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
static uint64_t authority_deadline;
static int check(int condition,const char *name,unsigned *passed){if(!condition){fprintf(stderr,"failed: %s errno=%d\n",name,errno);return-1;}(*passed)++;return 0;}
static uint64_t now_ms(void){struct timespec now;if(clock_gettime(CLOCK_REALTIME,&now)<0)return 0;return(uint64_t)now.tv_sec*1000u+(uint64_t)now.tv_nsec/1000000u;}
static int sha256_fd(int fd,char output[65]){struct stat state;if(fstat(fd,&state)<0||state.st_size<=0)return-1;size_t size=(size_t)state.st_size;unsigned char *bytes=malloc(size);if(!bytes)return-1;
  if(pread(fd,bytes,size,0)!=(ssize_t)size){free(bytes);return-1;}int algorithm=socket(AF_ALG,SOCK_SEQPACKET|SOCK_CLOEXEC,0);if(algorithm<0){free(bytes);return-1;}
  struct sockaddr_alg address={.salg_family=AF_ALG,.salg_type="hash",.salg_name="sha256"};if(bind(algorithm,(struct sockaddr *)&address,sizeof(address))<0){free(bytes);close(algorithm);return-1;}
  int operation=accept4(algorithm,NULL,NULL,SOCK_CLOEXEC);close(algorithm);if(operation<0){free(bytes);return-1;}if(send(operation,bytes,size,0)!=(ssize_t)size){free(bytes);close(operation);return-1;}free(bytes);
  unsigned char digest[32];if(read(operation,digest,sizeof(digest))!=(ssize_t)sizeof(digest)){close(operation);return-1;}close(operation);static const char hex[]="0123456789abcdef";
  for(size_t index=0;index<sizeof(digest);index++){output[index*2]=hex[digest[index]>>4];output[index*2+1]=hex[digest[index]&15u];}output[64]='\0';return 0;}
static int identity(int fd,struct rtee_descriptor_identity *value,int hash){struct stat state;struct statx extended;if(fstat(fd,&state)<0||statx(fd,"",AT_EMPTY_PATH|AT_STATX_SYNC_AS_STAT,STATX_MNT_ID,&extended)<0)return-1;
  memset(value,0,sizeof(*value));value->fd=fd;value->device=state.st_dev;value->inode=state.st_ino;value->mount_id=extended.stx_mnt_id;value->owner_uid=state.st_uid;value->owner_gid=state.st_gid;value->mode=state.st_mode&07777;
  strcpy(value->allocation_ledger_head_sha256,d64);return hash?sha256_fd(fd,value->content_sha256):(strcpy(value->content_sha256,a64),0);}
static int file_at(int root,const char *name,const char *bytes,mode_t mode){int fd=openat(root,name,O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC,mode);if(fd<0)return-1;if(write(fd,bytes,strlen(bytes))!=(ssize_t)strlen(bytes)){close(fd);return-1;}return fd;}
static int directory_at(int root,const char *name){if(mkdirat(root,name,0700)<0)return-1;return openat(root,name,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);}
static struct rtea_enrollment authority_enrollment(const char *profile){struct rtea_enrollment value={0};strcpy(value.installation_id,"10000000-0000-4000-8000-000000000001");strcpy(value.site_id,"fixture_site");strcpy(value.host_installation_id,"20000000-0000-4000-8000-000000000002");
  strcpy(value.enrollment_sha256,a64);strcpy(value.profile_sha256,profile);strcpy(value.admission_sha256,c64);strcpy(value.authority_instance_sha256,d64);value.supervisor_peer_uid=geteuid();value.supervisor_generation=7;value.reconciled_supervisor_generation=7;return value;}
static int authority_frame(char *output,size_t capacity,const struct rtea_enrollment *enrollment,uint64_t deadline){return snprintf(output,capacity,
  "format=darshan-recovery-target-native-authority-v2\nkind=ACQUIRE\noperation=PREPARE\ninstallation_id=%s\nsite_id=%s\nhost_installation_id=%s\noperation_id=30000000-0000-4000-8000-000000000003\ngeneration=9\ntarget_set_id=%s\ntarget_handle=rtea:v1:target:abcdefghijklmnop\nprofile_sha256=%s\nenrollment_sha256=%s\nadmission_sha256=%s\nouter_envelope_sha256=%s\nrequest_sha256=%s\nauthorization_sha256=%s\ndeadline_unix_ms=%llu\nsupervisor_instance_sha256=%s\nsupervisor_generation=7\nreconciled_generation=7\nchallenge_nonce=00000000000000000000000000000001\n",
  enrollment->installation_id,enrollment->site_id,enrollment->host_installation_id,b64,enrollment->profile_sha256,enrollment->enrollment_sha256,enrollment->admission_sha256,a64,b64,c64,(unsigned long long)deadline,enrollment->authority_instance_sha256);}
static int command_frame(char *output,size_t capacity,const char *operation,const char *role,const char *resource,const char *profile,const char *head,const char *nonce,uint64_t deadline){return snprintf(output,capacity,
  "format=darshan-recovery-target-native-engine-command-v3\noperation=%s\ncommand_id=40000000-0000-4000-8000-000000000004\noperation_id=30000000-0000-4000-8000-000000000003\ntarget_handle=tra:v1:profile:abcdefghijklmnop\ngeneration=9\nrole=%s\nresource_handle=%s\nprofile_sha256=%s\nadmission_sha256=%s\nrequest_sha256=%s\nauthorization_sha256=%s\ncommand_nonce=%s\nmaterialization_head_sha256=%s\ndeadline_unix_ms=%llu\nauthority_instance_sha256=%s\nauthority_deadline_unix_ms=%llu\nsupervisor_generation=7\n",
  operation,role,resource,profile,c64,b64,c64,nonce,head,(unsigned long long)deadline,d64,(unsigned long long)authority_deadline);}

int main(int argc,char **argv){
  if(argc!=3)return 64;
  unsigned passed=0;int root=open(argv[1],O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(root<0)return 1;
  int executable=open(argv[2],O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(executable<0)return 1;char profile[65];if(sha256_fd(executable,profile)<0)return 1;
  int config=directory_at(root,"client-config"),journal_dir=directory_at(root,"materialization"),authority_dir=directory_at(root,"authority");if(config<0||journal_dir<0||authority_dir<0)return 1;
  int asset_fds[4];const char *asset_names[]={"postgres.conf","minio.conf","postgres.bootstrap","minio.bootstrap"};
  for(size_t index=0;index<4;index++){asset_fds[index]=file_at(root,asset_names[index],"fixed-non-secret-fixture\n",0600);if(asset_fds[index]<0)return 1;}
  int bind_fds[2]={directory_at(root,"postgres-data"),directory_at(root,"minio-data")};if(bind_fds[0]<0||bind_fds[1]<0)return 1;
  struct rtea_enrollment enrolled=authority_enrollment(profile);char authority_bytes[RTEA_MAX_FRAME_BYTES];uint64_t deadline=now_ms()+120000;authority_deadline=deadline;
  int authority_length=authority_frame(authority_bytes,sizeof(authority_bytes),&enrolled,deadline);struct rtea_request acquired;
  if(authority_length<=0||rtea_parse_request(authority_bytes,(size_t)authority_length,&acquired)<0)return 1;
  int pair[2];if(socketpair(AF_UNIX,SOCK_SEQPACKET|SOCK_CLOEXEC,0,pair)<0)return 1;
  struct rtea_session session;if(rtea_acquire_session(authority_dir,pair[0],&enrolled,authority_bytes,(size_t)authority_length,now_ms(),&session)<0){perror("authority acquire");return 1;}
  if(check(session.readonly==0&&session.authority_fd>=0,"real-socketpair-authority-admission",&passed)<0)return 1;
  struct rtee_enrollment engine={0};strcpy(engine.profile_handle,"tra:v1:profile:abcdefghijklmnop");strcpy(engine.profile_sha256,profile);strcpy(engine.admission_sha256,c64);strcpy(engine.daemon_identity_sha256,b64);strcpy(engine.daemon_socket_identity_sha256,c64);
  strcpy(engine.postgres_image_id,"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");strcpy(engine.postgres_image_config_sha256,b64);strcpy(engine.minio_image_id,engine.postgres_image_id);strcpy(engine.minio_image_config_sha256,b64);
  strcpy(engine.network_configuration_sha256,c64);strcpy(engine.postgres_configuration_sha256,c64);strcpy(engine.minio_configuration_sha256,c64);
  if(identity(executable,&engine.executable,1)<0||identity(config,&engine.client_config,0)<0)return 1;
  engine.asset_count=4;
  for(size_t index=0;index<4;index++){engine.assets[index].role=(enum rtee_handle_role)(RTEE_HANDLE_POSTGRES_CONFIG+index);engine.assets[index].source_state=index<2?RTEE_ASSET_COMPLETE:RTEE_ASSET_FRESH;engine.assets[index].dispatch_enabled=0;if(identity(asset_fds[index],&engine.assets[index].descriptor,1)<0)return 1;}
  struct rtee_descriptor_identity binds[2];if(identity(bind_fds[0],&binds[0],0)<0||identity(bind_fds[1],&binds[1],0)<0)return 1;
  const char *names[]={"profile","executable","client-config","daemon-socket","network","postgres","minio","postgres-bind","minio-bind","postgres-password","minio-root-password","minio-root-user","postgres-config","minio-config","postgres-bootstrap","minio-bootstrap"};
  struct rtee_handle_entry handles[16];for(size_t index=0;index<16;index++){handles[index].role=(enum rtee_handle_role)(index+1);(void)snprintf(handles[index].handle,sizeof(handles[index].handle),"tra:v1:%s:abcdefghijklmnop",names[index]);strcpy(handles[index].identity_sha256,a64);handles[index].admitted=1;}
  char tampered_authority[RTEA_MAX_FRAME_BYTES];memcpy(tampered_authority,authority_bytes,(size_t)authority_length);tampered_authority[0]='x';struct rtee_context rejected_context;
  if(check(rtee_context_init(&rejected_context,tampered_authority,(size_t)authority_length,&session,&engine,handles,16,binds,2)<0,"exact-acquired-frame-lease-proof",&passed)<0)return 1;
  struct rtee_context context;if(rtee_context_init(&context,authority_bytes,(size_t)authority_length,&session,&engine,handles,16,binds,2)<0){perror("context init");return 1;}
  if(check(context.handle_count==16&&!strcmp(context.acquired_request.operation_id,acquired.operation_id),"immutable-context-and-complete-handle-map",&passed)<0)return 1;
  struct rtem_journal journal;if(rtem_open_journal(journal_dir,geteuid(),getegid(),&journal)<0){perror("journal open");return 1;}
  char command[RTEE_MAX_COMMAND_BYTES+2];int length=command_frame(command,sizeof(command),"CREATE_MINIO","MINIO",handles[6].handle,profile,journal.head_sha256,"11111111111111111111111111111111",now_ms()+60000);
  struct rtee_command parsed;if(check(length>0&&rtee_parse_command(command,(size_t)length,&parsed)==0&&parsed.operation==RTEE_OPERATION_CREATE_MINIO,"fixed-command-parser",&passed)<0)return 1;
  struct rtee_inspection inspection;if(check(rtee_dispatch_fixed(&context,&journal,command,(size_t)length,-1,&inspection)==0,"fixture-exec-inspect-join",&passed)<0)return 1;
  if(check(inspection.minio.state==RTEE_RESOURCE_CREATED&&inspection.minio.configuration==RTEE_CONFIG_MATCH,"explicit-created-config-separate-readiness",&passed)<0)return 1;
  if(check(journal.record_count==2&&!strcmp(journal.head_sha256,"0000000000000000000000000000000000000000000000000000000000000000")==0,"durable-intent-and-receipt-chain",&passed)<0)return 1;
  if(check(context.active_child==0&&context.joined,"negative-descendant-proof-before-return",&passed)<0)return 1;
  length=command_frame(command,sizeof(command),"INSPECT_TARGET","NONE",handles[0].handle,profile,journal.head_sha256,"22222222222222222222222222222222",now_ms()+60000);
  if(check(rtee_dispatch_fixed(&context,NULL,command,(size_t)length,-1,&inspection)==0&&inspection.absence_reliable,"readonly-complete-absence-inspect",&passed)<0)return 1;
  if(check(journal.record_count==2,"readonly-inspect-does-not-materialize",&passed)<0)return 1;
  char changed[RTEE_MAX_COMMAND_BYTES+2];memcpy(changed,command,(size_t)length+1);
  if(check(rtee_parse_command(changed,(size_t)length-1,&parsed)<0,"partial-command",&passed)<0)return 1;
  changed[length]='x';if(check(rtee_parse_command(changed,(size_t)length+1,&parsed)<0,"trailing-command",&passed)<0)return 1;
  memset(changed,'x',sizeof(changed));if(check(rtee_parse_command(changed,sizeof(changed),&parsed)<0&&errno==EMSGSIZE,"overflow-command",&passed)<0)return 1;
  length=command_frame(command,sizeof(command),"START_MINIO","MINIO",handles[6].handle,profile,journal.head_sha256,"33333333333333333333333333333333",now_ms()+60000);
  if(check(rtee_parse_command(command,(size_t)length,&parsed)<0&&errno==ENOTSUP,"start-rejected-until-b2",&passed)<0)return 1;
  length=command_frame(command,sizeof(command),"REMOVE_MINIO","MINIO",handles[6].handle,profile,journal.head_sha256,"33333333333333333333333333333333",now_ms()+60000);
  if(check(rtee_parse_command(command,(size_t)length,&parsed)<0&&errno==ENOTSUP,"remove-rejected",&passed)<0)return 1;
  length=command_frame(command,sizeof(command),"PURGE","MINIO",handles[6].handle,profile,journal.head_sha256,"33333333333333333333333333333333",now_ms()+60000);
  if(check(rtee_parse_command(command,(size_t)length,&parsed)<0&&errno==ENOTSUP,"purge-rejected",&passed)<0)return 1;
  length=command_frame(command,sizeof(command),"CREATE_POSTGRES","MINIO",handles[6].handle,profile,journal.head_sha256,"33333333333333333333333333333333",now_ms()+60000);
  if(check(rtee_parse_command(command,(size_t)length,&parsed)<0,"operation-role-substitution",&passed)<0)return 1;
  length=command_frame(command,sizeof(command),"INSPECT_TARGET","NONE",handles[0].handle,a64,journal.head_sha256,"44444444444444444444444444444444",now_ms()+60000);
  if(check(rtee_dispatch_fixed(&context,NULL,command,(size_t)length,-1,&inspection)<0,"profile-substitution",&passed)<0)return 1;
  length=command_frame(command,sizeof(command),"INSPECT_TARGET","NONE",handles[0].handle,profile,journal.head_sha256,"44444444444444444444444444444444",now_ms()-1);
  if(check(rtee_dispatch_fixed(&context,NULL,command,(size_t)length,-1,&inspection)<0&&errno==ETIMEDOUT,"deadline-before-launch",&passed)<0)return 1;
  length=command_frame(command,sizeof(command),"INSPECT_TARGET","NONE",handles[0].handle,profile,journal.head_sha256,"44444444444444444444444444444444",authority_deadline+1);
  if(check(rtee_dispatch_fixed(&context,NULL,command,(size_t)length,-1,&inspection)<0&&errno==EACCES,"command-deadline-cannot-extend-authority",&passed)<0)return 1;
  int cancel[2];if(pipe(cancel)<0)return 1;close(cancel[1]);length=command_frame(command,sizeof(command),"INSPECT_TARGET","NONE",handles[0].handle,profile,journal.head_sha256,"55555555555555555555555555555555",now_ms()+60000);
  if(check(rtee_dispatch_fixed(&context,NULL,command,(size_t)length,cancel[0],&inspection)<0&&errno==ECANCELED,"cancellation-before-launch",&passed)<0)return 1;
  close(cancel[0]);
  if(setenv("RTEE_TEST_FIXTURE_DELAY_MS","200",1)<0)return 1;
  length=command_frame(command,sizeof(command),"INSPECT_TARGET","NONE",handles[0].handle,profile,journal.head_sha256,"55555555555555555555555555555555",now_ms()+25);
  if(check(rtee_dispatch_fixed(&context,NULL,command,(size_t)length,-1,&inspection)<0&&errno==ETIMEDOUT&&context.joined&&!context.active_child,"timeout-cleanup-proves-negative-liveness",&passed)<0)return 1;
  unsetenv("RTEE_TEST_FIXTURE_DELAY_MS");
  const char *exit_modes[]={"nonzero","signal"};const char *exit_nonces[]={"99999999999999999999999999999991","99999999999999999999999999999992"};
  for(size_t index=0;index<2;index++){size_t before=journal.record_count;if(setenv("RTEE_TEST_FIXTURE_EXIT_MODE",exit_modes[index],1)<0)return 1;
    length=command_frame(command,sizeof(command),"ENSURE_INTERNAL_NETWORK","NETWORK",handles[4].handle,profile,journal.head_sha256,exit_nonces[index],now_ms()+60000);
    char name[64];(void)snprintf(name,sizeof(name),"%s-after-eof-no-complete-receipt",exit_modes[index]);
    if(check(rtee_dispatch_fixed(&context,&journal,command,(size_t)length,-1,&inspection)<0&&errno==EIO&&context.joined&&!context.active_child&&journal.record_count==before+1,name,&passed)<0)return 1;
    unsetenv("RTEE_TEST_FIXTURE_EXIT_MODE");}
  size_t before_unknown=journal.record_count;if(setenv("RTEE_TEST_FORGET_DIRECT_STATUS","1",1)<0)return 1;
  length=command_frame(command,sizeof(command),"ENSURE_INTERNAL_NETWORK","NETWORK",handles[4].handle,profile,journal.head_sha256,"99999999999999999999999999999993",now_ms()+60000);
  if(check(rtee_dispatch_fixed(&context,&journal,command,(size_t)length,-1,&inspection)<0&&errno==ECHILD&&context.joined&&!context.active_child&&journal.record_count==before_unknown+1,"unknown-direct-status-after-eof-no-complete-receipt",&passed)<0)return 1;
  unsetenv("RTEE_TEST_FORGET_DIRECT_STATUS");
  if(fchmod(asset_fds[0],0644)<0)return 1;
  length=command_frame(command,sizeof(command),"INSPECT_TARGET","NONE",handles[0].handle,profile,journal.head_sha256,"66666666666666666666666666666666",now_ms()+60000);
  if(check(rtee_dispatch_fixed(&context,NULL,command,(size_t)length,-1,&inspection)<0,"asset-substitution",&passed)<0)return 1;
  if(fchmod(asset_fds[0],0600)<0)return 1;
  struct rtem_identity material={0};strcpy(material.operation_id,"30000000-0000-4000-8000-000000000003");strcpy(material.target_handle,handles[0].handle);material.generation=9;material.operation=RTEM_OPERATION_ENSURE_INTERNAL_NETWORK;material.role=RTEM_ROLE_NETWORK;strcpy(material.resource_handle,handles[4].handle);strcpy(material.profile_sha256,profile);strcpy(material.admission_sha256,c64);strcpy(material.command_sha256,a64);strcpy(material.command_nonce,"77777777777777777777777777777777");
  struct rtem_publication publication;if(check(rtem_publish_intent(&journal,&material,a64,&publication)<0&&errno==ESTALE,"stale-materialization-head",&passed)<0)return 1;
  char previous[65];strcpy(previous,journal.head_sha256);if(check(rtem_publish_intent(&journal,&material,previous,&publication)==0,"additional-intent",&passed)<0)return 1;
  if(check(rtem_publish_intent(&journal,&material,previous,&publication)==0&&publication.exact_replay,"exact-intent-replay",&passed)<0)return 1;
  struct rtem_actual_resource missing={0};if(check(rtem_publish_receipt(&journal,&material,publication.record_sha256,a64,&missing,1,&publication)<0&&errno==ENODATA,"receipt-requires-authoritative-identities",&passed)<0)return 1;
  if(check(rtem_publish_receipt(&journal,&material,b64,a64,&missing,0,&publication)<0&&errno==ENOENT,"orphan-receipt-rejected",&passed)<0)return 1;
  char intent_hash[65];strcpy(intent_hash,journal.head_sha256);if(check(rtem_publish_receipt(&journal,&material,intent_hash,a64,&missing,0,&publication)==0,"ambiguous-terminal-receipt",&passed)<0)return 1;
  if(check(rtem_publish_receipt(&journal,&material,intent_hash,b64,&missing,0,&publication)<0&&errno==EEXIST,"conflicting-terminal-receipt-rejected",&passed)<0)return 1;
  if(check(rtem_rescan(&journal)==0&&journal.record_count==7,"bounded-materialization-rescan",&passed)<0)return 1;
  const char *faults[]={"before-open","after-write","after-file-fsync","after-link","after-directory-fsync"};int publish_faults_ok=1;
  for(size_t index=0;index<sizeof(faults)/sizeof(faults[0]);index++){
    char name[32];(void)snprintf(name,sizeof(name),"publish-fault-%zu",index);int fault_dir=directory_at(root,name);struct rtem_journal fault_journal;
    if(fault_dir<0||rtem_open_journal(fault_dir,geteuid(),getegid(),&fault_journal)<0||setenv("RTEM_TEST_PUBLISH_FAULT",faults[index],1)<0){publish_faults_ok=0;break;}
    struct rtem_publication fault_publication;if(rtem_publish_intent(&fault_journal,&material,fault_journal.head_sha256,&fault_publication)>=0)publish_faults_ok=0;
    unsetenv("RTEM_TEST_PUBLISH_FAULT");if(rtem_publish_intent(&fault_journal,&material,"0000000000000000000000000000000000000000000000000000000000000000",&fault_publication)<0||
        rtem_rescan(&fault_journal)<0||fault_journal.record_count!=1)publish_faults_ok=0;
    (void)rtem_close_journal(&fault_journal);close(fault_dir);
  }
  if(check(publish_faults_ok,"every-materialization-publication-fault-is-durable-or-retryable",&passed)<0)return 1;
  const char *replay_faults[]={"replay-before-file-fsync","replay-after-file-fsync","replay-before-directory-fsync","replay-after-directory-fsync"};
  int replay_dir=directory_at(root,"intent-replay-durability"),intent_replay_ok=1;struct rtem_journal replay_journal;struct rtem_publication replay_publication;
  if(replay_dir<0||rtem_open_journal(replay_dir,geteuid(),getegid(),&replay_journal)<0||setenv("RTEM_TEST_PUBLISH_FAULT","after-link",1)<0||
      rtem_publish_intent(&replay_journal,&material,replay_journal.head_sha256,&replay_publication)>=0)intent_replay_ok=0;
  unsetenv("RTEM_TEST_PUBLISH_FAULT");
  for(size_t index=0;intent_replay_ok&&index<sizeof(replay_faults)/sizeof(replay_faults[0]);index++){
    if(setenv("RTEM_TEST_PUBLISH_FAULT",replay_faults[index],1)<0||rtem_publish_intent(&replay_journal,&material,
        "0000000000000000000000000000000000000000000000000000000000000000",&replay_publication)>=0)intent_replay_ok=0;
    unsetenv("RTEM_TEST_PUBLISH_FAULT");
  }
  if(intent_replay_ok&&(rtem_publish_intent(&replay_journal,&material,
      "0000000000000000000000000000000000000000000000000000000000000000",&replay_publication)<0||
      !replay_publication.exact_replay||rtem_rescan(&replay_journal)<0||replay_journal.record_count!=1))intent_replay_ok=0;
  if(check(intent_replay_ok,"after-link-intent-replay-fsyncs-file-and-directory-before-ack",&passed)<0)return 1;
  char replay_intent[65];strcpy(replay_intent,replay_publication.record_sha256);int receipt_replay_ok=1;
  if(setenv("RTEM_TEST_PUBLISH_FAULT","after-link",1)<0||rtem_publish_receipt(&replay_journal,&material,replay_intent,a64,&missing,0,&replay_publication)>=0)receipt_replay_ok=0;
  unsetenv("RTEM_TEST_PUBLISH_FAULT");
  for(size_t index=0;receipt_replay_ok&&index<sizeof(replay_faults)/sizeof(replay_faults[0]);index++){
    if(setenv("RTEM_TEST_PUBLISH_FAULT",replay_faults[index],1)<0||rtem_publish_receipt(&replay_journal,&material,replay_intent,a64,&missing,0,&replay_publication)>=0)receipt_replay_ok=0;
    unsetenv("RTEM_TEST_PUBLISH_FAULT");
  }
  if(receipt_replay_ok&&(rtem_publish_receipt(&replay_journal,&material,replay_intent,a64,&missing,0,&replay_publication)<0||
      !replay_publication.exact_replay||rtem_rescan(&replay_journal)<0||replay_journal.record_count!=2))receipt_replay_ok=0;
  if(check(receipt_replay_ok,"after-link-receipt-replay-fsyncs-file-and-directory-before-ack",&passed)<0)return 1;
  (void)rtem_close_journal(&replay_journal);close(replay_dir);
  int malformed_dir=directory_at(root,"malformed-record"),malformed_ok=0;struct rtem_journal malformed_journal;
  if(malformed_dir>=0&&rtem_open_journal(malformed_dir,geteuid(),getegid(),&malformed_journal)==0){struct rtem_publication malformed_publication;
    if(rtem_publish_intent(&malformed_journal,&material,malformed_journal.head_sha256,&malformed_publication)==0){int scan_fd=dup(malformed_dir);DIR *scan=scan_fd>=0?fdopendir(scan_fd):NULL;struct dirent *entry;
      if(scan){while((entry=readdir(scan)))if(strncmp(entry->d_name,"materialization-",16)==0){int record=openat(malformed_dir,entry->d_name,O_WRONLY|O_APPEND|O_CLOEXEC|O_NOFOLLOW);if(record>=0){malformed_ok=write(record,"unknown=trailing\n",17)==17;close(record);}break;}closedir(scan);}
      if(malformed_ok)malformed_ok=rtem_rescan(&malformed_journal)<0&&errno==EPROTO;}
    (void)rtem_close_journal(&malformed_journal);close(malformed_dir);}
  if(check(malformed_ok,"malformed-trailing-journal-record-rejected",&passed)<0)return 1;
  close(pair[1]);length=command_frame(command,sizeof(command),"INSPECT_TARGET","NONE",handles[0].handle,profile,journal.head_sha256,"88888888888888888888888888888888",now_ms()+60000);
  if(check(rtee_dispatch_fixed(&context,NULL,command,(size_t)length,-1,&inspection)<0&&errno==ECANCELED,"peer-death-cancels-before-release",&passed)<0)return 1;
  if(check(rtee_cancel_join_and_release(&context)==0,"join-before-ofd-release",&passed)<0)return 1;
  if(check(rtee_context_close(&context)==0&&rtem_close_journal(&journal)==0,"descriptor-context-close",&passed)<0)return 1;
  for(size_t index=0;index<4;index++)close(asset_fds[index]);
  close(bind_fds[0]);close(bind_fds[1]);close(executable);close(config);close(journal_dir);close(authority_dir);close(pair[0]);close(root);
  printf("%u native executor/materialization checks passed\n",passed);return passed==41?0:1;
}

