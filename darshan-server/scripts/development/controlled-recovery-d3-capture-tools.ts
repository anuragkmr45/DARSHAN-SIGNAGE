import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { Readable } from 'node:stream';
import { lstat } from 'node:fs/promises';
import { parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile, protectD3Directory, syncD3Directory } from './controlled-recovery-d3-protected-files';
import { BoundedD3SourceProcess } from './controlled-recovery-d3-source-process';
import { D3_TOOL_ENV } from './controlled-recovery-d4-tools';
import { assertD3CaptureLease, d3CaptureSignal, d3CaptureObserved, d3CaptureBound, d3CaptureProducer, d3CaptureReadableProducer, d3CaptureSettlementFailure, d3CaptureSettlementStage, D3_CAPTURE_SETTLEMENT_MS, type D3CaptureLease, type D3CaptureComponent, type ProtectedD3CaptureSpool, type D3CaptureProducerControl, type D3CaptureProducer } from './controlled-recovery-d3-capture-spool';
import { D3_CAPTURE_PG_IMAGE, d3CaptureFailure, type D3CaptureProfile } from './controlled-recovery-d3-capture-profile';

export const D3_CAPTURE_DOCKER_PREFIX = Object.freeze(['--config','/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config','--context','default']);
export type D3CaptureToolOperation = 'pg-dump' | 'tar-database' | 'tar-objects';
export function fixedD3CaptureToolPlan(a: D3OperationAuthority, p: D3CaptureProfile, lease: D3CaptureLease, operation: D3CaptureToolOperation, imageEnvironment: readonly string[] = []) {
  assertD3CaptureLease(lease); if (!['pg-dump','tar-database','tar-objects'].includes(operation)) throw d3CaptureFailure(); const pg = operation === 'pg-dump', component = operation.slice(4) as D3CaptureComponent;
  const entrypoint = pg ? '/usr/local/bin/pg_dump' : '/bin/tar', network = pg ? 'darshan-d2-20261030-net' : 'none';
  const overrides = pg ? ['LANG=C','LC_ALL=C','HOME=/nonexistent','PGHOST=darshan-d2-20261030-postgres','PGPORT=5432','PGDATABASE=darshan','PGUSER=darshan','PGPASSFILE=/credentials/pgpass','PGSSLMODE=verify-full','PGSSLROOTCERT=/credentials/ca.crt','PGCONNECT_TIMEOUT=5','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=120000'] : ['LANG=C','LC_ALL=C','TZ=UTC','HOME=/nonexistent'];
  const merged = new Map<string,string>(); for (const value of imageEnvironment) { const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(value); if (!match || value.includes('\0') || value.includes('\r') || value.includes('\n') || !['PATH','LANG','GOSU_VERSION','PG_MAJOR','PG_VERSION','PG_SHA256','PGDATA'].includes(match[1]!) || merged.has(match[1]!) || value.length > 4096) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_IMAGE_CHANGED'); merged.set(match[1]!,value); } for (const value of overrides) merged.set(value.slice(0,value.indexOf('=')),value); const environment = [...merged.values()];
  const command = pg ? ['--no-password','--format=plain','--no-owner','--no-privileges','--exclude-schema=darshan_d3_control','--dbname=darshan'] : ['--format=ustar','--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','--mode=u=rwX,go=','--no-recursion','--verbatim-files-from','-cf','-','-C','/input','-T','/inventory/files.list'];
  const mounts = pg ? [{ source: `${lease.root}/private/pgpass`, target: '/credentials/pgpass' },{ source: `${a.root}/source/tls/ca/ca.crt`, target: '/credentials/ca.crt' }] : [{ source: `${lease.root}/raw/${component}`, target: '/input' },{ source: `${lease.root}/private/${component}-tar`, target: '/inventory' }];
  const configuration = { operation, entrypoint, command, environment, mounts, network, image: D3_CAPTURE_PG_IMAGE, user: `${a.ownerUid}:${a.ownerGid}`, memory: p.tool_memory_bytes, pids: p.tool_pids, cpus: p.tool_cpus };
  const labels = { 'com.darshan.development-only':'true','com.darshan.d3.operation':a.operationId,'com.darshan.d3.site':a.siteId,'com.darshan.d3.repository':a.repositoryId,'com.darshan.d3.capture-attempt':lease.attempt.attemptId,'com.darshan.d3.capture-tool':operation,'com.darshan.d3.configuration-sha256':digest(configuration) };
  const name = `darshan-d3-capture-${a.operationId}-${lease.attempt.attemptId}-${operation}`, cidfile = `${lease.root}/journal/${operation}.cid`;
  const tmpfs = { '/tmp':`rw,noexec,nosuid,nodev,size=16m,uid=${a.ownerUid},gid=${a.ownerGid},mode=0700`, '/var/lib/postgresql/data':`rw,noexec,nosuid,nodev,size=1m,uid=${a.ownerUid},gid=${a.ownerGid},mode=0700` };
  const argv = [...D3_CAPTURE_DOCKER_PREFIX,'container','create','--pull=never','--name',name,'--cidfile',cidfile,...Object.entries(labels).flatMap(([k,v]) => ['--label',`${k}=${v}`]),'--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges=true','--pids-limit',String(p.tool_pids),'--memory',p.tool_memory_bytes,'--cpus',p.tool_cpus,'--user',configuration.user,...Object.entries(tmpfs).flatMap(([k,v]) => ['--tmpfs',`${k}:${v}`]),...environment.flatMap((v) => ['--env',v]),...mounts.flatMap((m) => ['--mount',`type=bind,src=${m.source},dst=${m.target},readonly`]),'--entrypoint',entrypoint,D3_CAPTURE_PG_IMAGE,...command];
  return { ...configuration, labels, name, cidfile, tmpfs, argv };
}
type Plan = ReturnType<typeof fixedD3CaptureToolPlan>;
/** Compare every admitted configuration/security field; Docker 29 CAP_ ambiguity is irrelevant with cap-drop ALL and no cap-add. */
export function assertD3CaptureContainer(value: unknown, plan: Plan, id: string, createdOnly = false) {
  const r = value as Record<string, any>; if (!r || r.Id !== id || r.Name !== `/${plan.name}` || r.Image !== plan.image || r.Config?.Image !== plan.image || r.Config.User !== plan.user || digest(r.Config.Entrypoint) !== digest([plan.entrypoint]) || digest(r.Config.Cmd) !== digest(plan.command) || digest(r.Config.Labels) !== digest(plan.labels) || digest(r.Config.Env) !== digest(plan.environment)) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_CONTAINER_FOREIGN');
  const h = r.HostConfig; if (!h || h.NetworkMode !== plan.network || h.ReadonlyRootfs !== true || h.Privileged !== false || h.AutoRemove !== false || h.PublishAllPorts !== false || h.Memory !== Number(plan.memory) || h.NanoCpus !== 250000000 || h.PidsLimit !== plan.pids || digest(h.CapDrop) !== digest(['ALL']) || (h.CapAdd?.length ?? 0) || digest(h.SecurityOpt) !== digest(['no-new-privileges=true']) || digest(h.Tmpfs) !== digest(plan.tmpfs) || digest(h.PortBindings ?? {}) !== digest({}) || h.RestartPolicy?.Name !== 'no' || h.RestartPolicy.MaximumRetryCount !== 0 || ['Binds','Devices','DeviceRequests','VolumesFrom','Links','ExtraHosts'].some((key) => h[key]?.length) || !['',undefined].includes(h.PidMode) || !['',undefined].includes(h.UTSMode) || h.IpcMode !== 'private' || !['',undefined].includes(h.UsernsMode) || r.RestartCount !== 0) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_CONTAINER_FOREIGN');
  if (!r.NetworkSettings?.Networks || digest(Object.keys(r.NetworkSettings.Networks).sort()) !== digest([plan.network])) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_CONTAINER_FOREIGN');
  const mounts = (r.Mounts ?? []).map((m: Record<string, unknown>) => ({ source:m.Source,target:m.Destination,type:m.Type,rw:m.RW })); if (digest(mounts.sort((a: { target:string },b: { target:string }) => a.target.localeCompare(b.target))) !== digest(plan.mounts.map((m) => ({ ...m,type:'bind',rw:false })).sort((a,b) => a.target.localeCompare(b.target))) || !r.State || r.State.Restarting || r.State.Dead || createdOnly && (r.State.Status !== 'created' || r.State.Running !== false || r.State.Pid !== 0 || r.State.ExitCode !== 0 || r.State.OOMKilled || r.State.StartedAt !== '0001-01-01T00:00:00Z')) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_CONTAINER_FOREIGN');
}
export type D3CaptureSpawn = (executable: string, argv: readonly string[], options: SpawnOptions) => ChildProcess;
/** stdout goes directly to a backpressured disk sink. Stderr is counted, discarded and never rendered. */
export class StreamingD3CaptureProcess {
  constructor(private readonly spawnProcess:D3CaptureSpawn=spawn) {}
  async run<T>(id:string,sink:(source:D3CaptureProducer)=>Promise<T>,signal:AbortSignal|undefined,timeout:number,stderrLimit:number,settleExactUpstream:()=>Promise<void>):Promise<T> {
    if(!/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(timeout) || timeout<1 || timeout>120000 || stderrLimit!==16384 || signal?.aborted || typeof settleExactUpstream!=='function') throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_CANCELLED');
    let child:ChildProcess;const mask=process.umask(0o077);
    try { child=this.spawnProcess('/usr/bin/docker',[...D3_CAPTURE_DOCKER_PREFIX,'container','start','--attach',id],{cwd:'/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server',shell:false,env:D3_TOOL_ENV,stdio:['ignore','pipe','pipe'],windowsHide:true}); }
    catch(cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPTURE_SPAWN_FAILED','The fixed capture process could not start.',{cause}); }
    finally { process.umask(mask); }
    let resolveClose!:(code:number|null)=>void,rejectFailure!:(cause:unknown)=>void,first:unknown,bytes=0,kill:ReturnType<typeof setTimeout>|undefined,termination:Promise<{identity:string;closed:true}>|undefined;
    const closed=d3CaptureObserved(new Promise<number|null>(resolve=>{resolveClose=resolve;})),failed=d3CaptureObserved(new Promise<never>((_resolve,reject)=>{rejectFailure=reject;}));
    const fail=(cause:unknown)=>{if(first===undefined){first=cause;rejectFailure(cause);}};
    const abort=()=>fail(new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPTURE_CANCELLED','The fixed capture process was cancelled.',{cause:signal?.reason}));
    const timer=setTimeout(()=>fail(d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_TIMEOUT')),timeout);
    child.on('error',cause=>fail(new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPTURE_SPAWN_FAILED','The fixed capture process failed.',{cause})));
    child.once('close',code=>{if(code!==0)fail(d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_TOOL_NONZERO'));resolveClose(code);});
    child.stderr?.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>stderrLimit)fail(d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_STDERR_LIMIT'));});
    child.stderr?.on('error',cause=>fail(new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPTURE_OUTPUT_FAILED','The fixed capture diagnostic stream failed.',{cause})));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const output=child.stdout,proof={identity:id,closed:true as const};
    const readable=output instanceof Readable ? d3CaptureReadableProducer(output,id) : null,diagnostics=child.stderr instanceof Readable ? d3CaptureReadableProducer(child.stderr,id) : null;
    const control:D3CaptureProducerControl={identity:id,closed:d3CaptureObserved(Promise.all([closed,readable?.control.closed??new Promise<never>(()=>undefined),diagnostics?.control.closed??new Promise<never>(()=>undefined)]).then(()=>proof)),
      terminateAndJoin:()=>termination??=d3CaptureObserved((async()=>{
        try { child.kill('SIGTERM'); } catch { /* Exact join below remains mandatory. */ }
        kill=setTimeout(()=>{try{child.kill('SIGKILL');}catch{/* join remains unproved */}},500);
        // Stop/join the exact owned container before asking its output iterator to return.
        await settleExactUpstream();await closed;
        if(!readable||!diagnostics)throw d3CaptureSettlementFailure(first,'CLI');await Promise.all([readable.control.terminateAndJoin(),diagnostics.control.terminateAndJoin()]);return proof;
      })())};
    const consumed=d3CaptureObserved(Promise.resolve().then(()=>{if(!readable)throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_OUTPUT_FAILED');return sink(d3CaptureProducer(readable,control));}));
    void consumed.catch(cause=>fail(cause instanceof ControlledRecoveryError ? cause : new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPTURE_OUTPUT_FAILED','The fixed capture output consumer failed.',{cause})));
    try {
      const value=await Promise.race([closed.then(async()=>{const [value]=await Promise.all([d3CaptureBound(consumed,D3_CAPTURE_SETTLEMENT_MS.consumed,'CONSUMED',first),d3CaptureBound(control.closed,D3_CAPTURE_SETTLEMENT_MS.upstream,'CLI',first)]);return value;}),failed]);
      if(signal?.aborted)abort();if(first!==undefined)throw first;return value;
    } catch(cause) {
      first??=cause;
      try {
        await d3CaptureBound(control.terminateAndJoin(),D3_CAPTURE_SETTLEMENT_MS.upstream,'UPSTREAM',first);
        await d3CaptureBound(consumed.then(()=>undefined,()=>undefined),D3_CAPTURE_SETTLEMENT_MS.consumed,'CONSUMED',first);
      } catch(settlement) { throw d3CaptureSettlementFailure(first,d3CaptureSettlementStage(settlement,'CLI')); }
      throw first instanceof ControlledRecoveryError ? first : new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPTURE_OUTPUT_FAILED','The fixed capture output consumer failed.',{cause:first});
    } finally { clearTimeout(timer);clearTimeout(kill);signal?.removeEventListener('abort',abort); }
  }
}
/** Fixed direct-spawn create/attach/inspect/remove lifecycle. No source container ID is accepted as input. */
export class FixedD3CaptureTools {
  constructor(private readonly authority: D3OperationAuthority, private readonly profile: D3CaptureProfile, private readonly spool: ProtectedD3CaptureSpool, private readonly admit: () => Promise<void>, private readonly control = new BoundedD3SourceProcess(), private readonly streaming = new StreamingD3CaptureProcess()) {}
  private async call(args: readonly string[], signal?: AbortSignal) { const result = await this.control.run({ executable:'/usr/bin/docker',argv:[...D3_CAPTURE_DOCKER_PREFIX,...args],cwd:'/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server',timeoutMs:10000,maximumOutputBytes:1048576,signal }); if (result.exitCode !== 0) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_CONTROL_NONZERO'); return result.stdout; }
  private async listed() { const bytes = await this.call(['container','ls','--all','--no-trunc','--format','{{json .}}']); const rows = bytes.toString('utf8').split('\n').filter(Boolean); if (rows.length > 256) throw d3CaptureFailure(); return rows.map((line) => { const r = parseStrictJson(Buffer.from(line),16384) as { ID:string; Names:string }; if (!/^[a-f0-9]{64}$/.test(r.ID) || typeof r.Names !== 'string') throw d3CaptureFailure(); return r; }); }
  private async inspect(plan: Plan, id: string, createdOnly = false) { const values = parseStrictJson(await this.call(['container','inspect',id]),1048576) as unknown[]; if (!Array.isArray(values) || values.length !== 1) throw d3CaptureFailure(); assertD3CaptureContainer(values[0],plan,id,createdOnly); return values[0] as { State: { Running:boolean; ExitCode:number; OOMKilled:boolean } }; }
  run<T>(lease:D3CaptureLease,operation:D3CaptureToolOperation,sink:(source:D3CaptureProducer)=>Promise<T>,signal?:AbortSignal) { assertD3CaptureLease(lease); return lease.track(() => this.execute(lease,operation,sink,signal)); }
  private async execute<T>(lease: D3CaptureLease, operation: D3CaptureToolOperation, sink: (source: D3CaptureProducer) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal = d3CaptureSignal(lease,signal); await lease.assert(); await this.admit(); let plan = fixedD3CaptureToolPlan(this.authority,this.profile,lease,operation); if ((await this.listed()).some((r) => r.Names === plan.name)) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_NAME_COLLISION');
    try { const file = await openD3ProtectedFile(this.authority,plan.cidfile,128); await file.close(); throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_CID_RETAINED'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    const image = parseStrictJson(await this.call(['image','inspect',plan.image]),1048576) as Array<{ Id:string; RepoDigests:string[]; Config:{ Env:string[] } }>; if (!Array.isArray(image) || image.length !== 1 || image[0]?.Id !== plan.image || !image[0].RepoDigests.includes(`postgres@${plan.image}`) || !Array.isArray(image[0].Config?.Env)) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_IMAGE_CHANGED'); plan = fixedD3CaptureToolPlan(this.authority,this.profile,lease,operation,image[0].Config.Env);
    for (const mount of plan.mounts) { if (operation === 'pg-dump') { const h = await openD3ProtectedFile(this.authority,mount.source,65536); await h.close(); } else { await protectD3Directory(this.authority,mount.source); } }
    await this.spool.record(lease,`${operation}-intent`,{ configurationSha256:plan.labels['com.darshan.d3.configuration-sha256'], name:plan.name }); let id: string | null = null, dispatched = false, upstreamRemoved = false;
    const settleExactUpstream = async () => { if (upstreamRemoved) return; if (!id) throw d3CaptureSettlementFailure(undefined,'UPSTREAM'); await this.inspect(plan,id); await this.call(['container','rm','--force','--volumes',id]); if ((await this.listed()).some((r) => r.ID === id || r.Names === plan.name)) throw d3CaptureFailure(); upstreamRemoved = true; };
    try { await lease.assert(); if (signal?.aborted) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_CANCELLED'); dispatched = true; const output = await this.call(plan.argv.slice(4),signal); const file = await openD3ProtectedFile(this.authority,plan.cidfile,128); try { const before = await file.stat(), cid = await file.readFile('utf8'), current = await lstat(plan.cidfile); if (!/^[a-f0-9]{64}\n?$/.test(cid) || output.toString('utf8') !== `${cid.trim()}\n` || before.dev !== current.dev || before.ino !== current.ino || current.nlink !== 1) throw d3CaptureFailure(); await file.sync(); await syncD3Directory(`${lease.root}/journal`); id = cid.trim(); } finally { await file.close(); }
      await this.inspect(plan,id,true); await this.spool.recordContainerCreated(lease,operation,id,plan.labels['com.darshan.d3.configuration-sha256']); await lease.assert(); if (signal?.aborted) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_CANCELLED');
      const value = await this.streaming.run(id,sink,signal,this.profile.timeout_ms,this.profile.stderr_bytes,settleExactUpstream); const observed = await this.inspect(plan,id); if (observed.State.Running || observed.State.ExitCode !== 0 || observed.State.OOMKilled) throw d3CaptureFailure('CONTROLLED_RECOVERY_D3_CAPTURE_TOOL_NONZERO');
      await this.call(['container','rm','--volumes',id]); if ((await this.listed()).some((r) => r.ID === id || r.Names === plan.name)) throw d3CaptureFailure(); upstreamRemoved = true; await this.spool.record(lease,`${operation}-settled`,{ id,joined:true }); return value;
    } catch (cause) { if (!dispatched) throw cause; if (!id || cause instanceof ControlledRecoveryError && cause.code.includes('SETTLEMENT_UNCERTAIN')) throw d3CaptureSettlementFailure(cause,d3CaptureSettlementStage(cause,'UPSTREAM')); try { if (!upstreamRemoved) await settleExactUpstream(); } catch (settlement) { throw d3CaptureSettlementFailure(cause instanceof ControlledRecoveryError ? cause : settlement,'UPSTREAM'); } throw cause instanceof ControlledRecoveryError ? cause : d3CaptureFailure(); }
  }
}
