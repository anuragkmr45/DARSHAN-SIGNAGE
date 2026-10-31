#ifndef RECOVERY_TARGET_ENGINE_EXECUTOR_TESTING
#error "the harmless recovery target executor fixture is test-only"
#endif

#define _GNU_SOURCE
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

extern char **environ;
static int safe_environment(void) {
  int count=0,lang=0,locale=0,fixture=0;
  for(char **item=environ;*item;item++){count++;if(!strcmp(*item,"LANG=C"))lang=1;else if(!strcmp(*item,"LC_ALL=C"))locale=1;
    else if(!strcmp(*item,"DARSHAN_RECOVERY_FIXED_FIXTURE=1"))fixture=1;
    if(!strncmp(*item,"PATH=",5)||!strncmp(*item,"HOME=",5)||strstr(*item,"PROXY=")||strstr(*item,"AUTH="))return 0;}
  return count==3&&lang&&locale&&fixture;
}
static void resource(const char *name,int present,int network,const char *image,const char *image_config,
    const char *configuration,const char *labels,const char *consumers,const char *daemon){
  printf("%s_state=%s\n%s_configuration=%s\n%s_readiness=NOT_EVALUATED\n",name,present?"CREATED":"ABSENT",name,present?"MATCH":"INCOMPLETE",name);
  printf("%s_resource_id=%s\n%s_image_id=%s\n%s_image_config_sha256=%s\n",name,present?"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":"null",name,present?(network?"null":image):"null",name,present?image_config:"null");
  printf("%s_effective_configuration_sha256=%s\n%s_owner_labels_sha256=%s\n%s_consumer_set_sha256=%s\n",name,present?configuration:"null",name,present?labels:"null",name,present?consumers:"null");
  printf("%s_daemon_identity_sha256=%s\n%s_error_sha256=null\n",name,present?daemon:"null",name);
}
int main(int argc,char **argv){
  if(argc!=20||strncmp(argv[1],"--fixed-operation=",18)||!safe_environment())return 64;
  const char *operation=argv[1]+18;int network=!strcmp(operation,"ENSURE_INTERNAL_NETWORK");
  int postgres=!strcmp(operation,"CREATE_POSTGRES"),minio=!strcmp(operation,"CREATE_MINIO");
  int inspect=!strcmp(operation,"INSPECT_TARGET");if(!network&&!postgres&&!minio&&!inspect)return 64;
  if(minio){pid_t child=fork();if(child==0){(void)setsid();(void)signal(SIGTERM,SIG_IGN);close(STDOUT_FILENO);close(STDERR_FILENO);for(;;)pause();}}
  const char *prefixes[]={"--operation-id=","--target-handle=","--generation=","--profile=","--admission=","--command-sha=","--role=","--resource=","--nonce=","--head=","--owner=","--daemon=","--image=","--image-config=","--configuration=","--consumers=","--delay-ms=","--exit-mode="};
  for(int index=2;index<20;index++)if(strncmp(argv[index],prefixes[index-2],strlen(prefixes[index-2])))return 64;
  const char *values[16];for(int index=0;index<16;index++)values[index]=argv[index+2]+strlen(prefixes[index]);
  char *delay_end=NULL;long delay=strtol(argv[18]+strlen(prefixes[16]),&delay_end,10);if(!delay_end||*delay_end||delay<0||delay>1000)return 64;
  if(delay){struct timespec pause={.tv_sec=delay/1000,.tv_nsec=(delay%1000)*1000000};(void)nanosleep(&pause,NULL);}
  printf("format=darshan-recovery-target-native-engine-inspect-v3\noperation_id=%s\ntarget_handle=%s\ngeneration=%s\nprofile_sha256=%s\nadmission_sha256=%s\ncommand_sha256=%s\noperation=%s\nrole=%s\nresource_handle=%s\ncommand_nonce=%s\nmaterialization_head_sha256=%s\nobservation_complete=true\nabsence_reliable=%s\ncontainers_complete=true\nnetworks_complete=true\nmounts_complete=true\nconsumers_complete=true\ndaemon_complete=true\n",
    values[0],values[1],values[2],values[3],values[4],values[5],operation,values[6],values[7],values[8],values[9],inspect?"true":"false");
  resource("network",network,1,values[12],values[13],values[14],values[10],values[15],values[11]);
  resource("postgres",postgres,0,values[12],values[13],values[14],values[10],values[15],values[11]);
  resource("minio",minio,0,values[12],values[13],values[14],values[10],values[15],values[11]);
  const char *exit_mode=argv[19]+strlen(prefixes[17]);if(strcmp(exit_mode,"success")){fflush(stdout);close(STDOUT_FILENO);struct timespec pause={0,100000000};(void)nanosleep(&pause,NULL);if(!strcmp(exit_mode,"nonzero"))return 42;if(!strcmp(exit_mode,"signal")){(void)raise(SIGUSR1);return 43;}return 64;}return 0;
}

