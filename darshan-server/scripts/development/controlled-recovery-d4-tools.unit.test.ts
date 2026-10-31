import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { assertD3ContainerToolsImage, D3ContainerToolRunner, D3_TOOL_WRAPPER, type D3ContainerToolExecution, type D3ContainerToolsAuthority } from './controlled-recovery-d4-tools';

import { testAgeRecipient, testD3Operation, testWrapperAuthority, testWrapperLabels } from './controlled-recovery-d3.test-support';

const authority: D3ContainerToolsAuthority = { ...testWrapperAuthority, enrolled: true, imageReference: 'darshan-d3-tools:packet-d4', imageId: `sha256:${'a'.repeat(64)}`,
  repoDigest: `darshan-d3-tools@sha256:${'b'.repeat(64)}`, configSha256: digest('config'), dockerfileSha256: digest('dockerfile'), lockSha256: digest('lock'),
  agePackageVersion: '1.2.3-r0', ffmpegPackageVersion: '7.1.1-r0' };
const observation = { imageId: authority.imageId!, repoDigests: [authority.repoDigest!], configSha256: authority.configSha256!, labels: { ...testWrapperLabels, 'com.darshan.development-only': 'true',
  'com.darshan.d3.role': 'container-tools', 'com.darshan.d3.age-apk-version': authority.agePackageVersion!, 'com.darshan.d3.ffmpeg-apk-version': authority.ffmpegPackageVersion! } };
const success = { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };

describe('Activation Packet D4 containerized tool authority', () => {
  it('fingerprints the actual age executable bytes/version using a fixed read-only hash operation',async()=>{const calls:Parameters<D3ContainerToolExecution['runFixed']>[0][]=[];const runner=new D3ContainerToolRunner(authority,{runFixed:async input=>{calls.push(input);return {...success,stdout:Buffer.from(input.owned.component==='age-version'?'v1.2.3\n':`${digest('actual-age-binary')}  /usr/bin/age\n`)};},terminateAndJoin:vi.fn()},testD3Operation);expect(await runner.ageFingerprint()).toEqual({path:'/usr/bin/age',version:'v1.2.3',executableSha256:digest('actual-age-binary'),imageId:authority.imageId});expect(calls[1]!.argv.slice(-4)).toEqual(['--entrypoint','/usr/bin/sha256sum',authority.imageId,'/usr/bin/age']);expect(calls[1]!.argv).toContain('none');expect(calls[1]!.argv).not.toContain('--mount');});
  it.each(['image','config','malformed'])('rejects %s instead of inventing an executable fingerprint',async kind=>{const value=kind==='image'?authority.imageId!.slice(7):kind==='config'?authority.configSha256!:'malformed';const runner=new D3ContainerToolRunner(authority,{runFixed:async input=>({...success,stdout:Buffer.from(input.owned.component==='age-version'?'v1.2.3\n':`${value}  /usr/bin/age\n`)}),terminateAndJoin:vi.fn()},testD3Operation);await expect(runner.ageFingerprint()).rejects.toMatchObject({code:'CONTROLLED_RECOVERY_D3_CAPTURE_FINGERPRINT_CHANGED'});});
  it('pins the immutable Alpine-based base and exact package build arguments without download scripts', async () => {
    const dockerfile = await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tools/Dockerfile', 'utf8');
    const lock = JSON.parse(await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tools/tool-image.lock.json', 'utf8'));
    const example = JSON.parse(await readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tools/tool-image.example.json', 'utf8'));
    expect(dockerfile).toContain('FROM postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea');
    expect(dockerfile).toContain('"age=${AGE_APK_VERSION}" "ffmpeg=${FFMPEG_APK_VERSION}"'); expect(dockerfile).not.toMatch(/curl|wget|ADD https?:/i);
    expect(lock).toMatchObject({ packages: { age: { version: '1.3.2-r1' }, ffmpeg: { version: '8.1.3-r0' } }, build_dependencies: { apk: 'build-base', version: '0.5-r4' }, wrapper: { umask: '0077', binary_path: D3_TOOL_WRAPPER } });
    if (!lock.enrolled) expect(lock).toMatchObject({ image: { image_id: null, repo_digest: null, config_sha256: null }, wrapper: { binary_sha256: null } });
    expect(example).toMatchObject({ packages: { age: { apk: 'age' }, ffmpeg: { apk: 'ffmpeg' } }, image: { reference: 'darshan-d3-tools:packet-d4' } });
  });

  it('fails closed for missing or changed image/config/labels', () => {
    expect(() => assertD3ContainerToolsImage({ ...authority, enrolled: false }, observation)).toThrowError(/missing, changed, or unenrolled/);
    expect(() => assertD3ContainerToolsImage(authority, null)).toThrowError(/missing, changed, or unenrolled/);
    expect(() => assertD3ContainerToolsImage(authority, { ...observation, imageId: `sha256:${'c'.repeat(64)}` })).toThrowError(/missing, changed, or unenrolled/);
    expect(() => assertD3ContainerToolsImage(authority, { ...observation, configSha256: digest('foreign') })).toThrowError(/missing, changed, or unenrolled/);
    expect(assertD3ContainerToolsImage(authority, observation)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertD3ContainerToolsImage(authority, { ...observation, labels: { ...observation.labels, 'com.darshan.d3.wrapper-umask': '0022' } })).toThrow();
  });
  it('pins a static no-shell wrapper that applies umask before exact execv, and verifies hash/mode/behavior during build', async () => {
    const root = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tools';
    const [source, dockerfile, lockBytes, execution] = await Promise.all([readFile(`${root}/darshan-d3-tool.c`, 'utf8'), readFile(`${root}/Dockerfile`, 'utf8'), readFile(`${root}/tool-image.lock.json`),
      readFile('/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/controlled-recovery-d3-execution.ts', 'utf8')]);
    const lock = JSON.parse(lockBytes.toString()); expect(lock.wrapper.source_sha256).toBe(sha256(Buffer.from(source))); expect(source.indexOf('umask(0077)')).toBeLessThan(source.indexOf('execv(argv[1], &argv[1])'));
    expect(source).toContain('argc < 2 || !allowed(argv[1])'); expect(source).toContain('(observed.st_mode & 07777) == 0600');
    expect(source).not.toMatch(/execvp\(|execvpe\(|system\(|popen\(|getenv\(|chmod\(|\/bin\/(?:sh|bash)/);
    expect(source.match(/"\/usr\/bin\/[a-z-]+"/g)).toEqual(['"/usr/bin/age"', '"/usr/bin/age-keygen"', '"/usr/bin/ffmpeg"', '"/usr/bin/ffprobe"']);
    expect(dockerfile).toContain('"build-base=${BUILD_BASE_APK_VERSION}"'); expect(dockerfile).toContain('-static'); expect(dockerfile).toContain('apk del .d3-wrapper-build');
    expect(dockerfile.match(/! test -x \/usr\/bin\/cc/g)).toHaveLength(2); expect(dockerfile.match(/! test -x \/usr\/bin\/gcc/g)).toHaveLength(2); expect(dockerfile).not.toMatch(/command -v (?:cc|gcc)/);
    expect(dockerfile).toContain('sha256sum -c /usr/local/share/darshan-d3-tool.sha256'); expect(dockerfile).toContain('/usr/local/bin/darshan-d3-tool --self-test');
    expect(dockerfile).toContain('chmod 0555 /out/darshan-d3-tool'); expect(dockerfile).not.toMatch(/chmod\s+(?:0?777|0?666)/); expect(execution).not.toMatch(/\.chmod\(/);
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/darshan-d3-tool"]');
  });
  it('routes every allowed tool through the exact wrapper argv without shell or chmod', async () => {
    const calls: Parameters<D3ContainerToolExecution['runFixed']>[0][] = [];
    const runner = new D3ContainerToolRunner(authority, { runFixed: async (input) => { calls.push(input); return { ...success, stdout: Buffer.from(testAgeRecipient + '\n') }; }, terminateAndJoin: vi.fn() }, testD3Operation);
    await runner.ageVersion(); await runner.ageKeygen(); await runner.ageRecipient(); await runner.ageEncrypt(testAgeRecipient); await runner.ageDecrypt(); await runner.ffprobe(); await runner.ffmpegTranscode();
    expect(calls.map(({ argv }) => argv[argv.indexOf('--entrypoint') + 3])).toEqual(['/usr/bin/age', '/usr/bin/age-keygen', '/usr/bin/age-keygen', '/usr/bin/age', '/usr/bin/age', '/usr/bin/ffprobe', '/usr/bin/ffmpeg']);
    for (const { argv } of calls) { expect(argv[argv.indexOf('--entrypoint') + 1]).toBe(D3_TOOL_WRAPPER); expect(argv).not.toEqual(expect.arrayContaining(['/bin/sh', '/bin/bash', 'chmod'])); }
  });

  it('uses only the fixed image, no network, hardened limits and exact owned mounts', async () => {
    let call: Parameters<D3ContainerToolExecution['runFixed']>[0] | undefined; const execution: D3ContainerToolExecution = { runFixed: vi.fn(async (input) => { call = input; return success; }), terminateAndJoin: vi.fn() };
    const runner = new D3ContainerToolRunner(authority, execution, testD3Operation); await runner.ageEncrypt(testAgeRecipient); expect(call).toBeDefined();
    expect(call!.argv).toEqual(expect.arrayContaining(['--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--pids-limit', '32', '--memory', '268435456', '--cpus', '0.50', authority.imageId!]));
    expect(call!.argv.join(' ')).toContain('src=/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/staging/encrypt-input,dst=/input,readonly');
    expect(call!.argv.join(' ')).toContain('src=/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/staging/encrypt-output,dst=/output');
    expect(call!.argv.join(' ')).not.toMatch(/--network host|docker\.sock|\.\.\/|--privileged|--cap-add|DOCKER_HOST=/);
    const entrypoint = call!.argv.indexOf('--entrypoint'); expect(call!.argv.slice(entrypoint, entrypoint + 4)).toEqual(['--entrypoint', D3_TOOL_WRAPPER, authority.imageId, '/usr/bin/age']);
    expect(call!.argv).toContain(`/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=1m,uid=${testD3Operation.ownerUid},gid=${testD3Operation.ownerGid},mode=0700`);
    expect(call!.argv).not.toEqual(expect.arrayContaining(['/bin/sh', '/bin/bash', 'chmod', 'umask']));
    await runner.ageDecrypt(); expect(call!.argv.join(' ')).toContain('src=/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/keys/recovery.age,dst=/key/recovery.age,readonly');
    await runner.ffprobe(); expect(call!.argv).toContain('/usr/bin/ffprobe'); await runner.ffmpegTranscode(); expect(call!.argv).toContain('/usr/bin/ffmpeg');
  });

  it('rejects argv-shaped recipient injection before Docker dispatch', async () => {
    const execution: D3ContainerToolExecution = { runFixed: vi.fn(async () => success), terminateAndJoin: vi.fn() }; const runner = new D3ContainerToolRunner(authority, execution, testD3Operation);
    expect(() => runner.ageEncrypt('--network=host')).toThrow(); expect(execution.runFixed).not.toHaveBeenCalled();
  });

  it('rejects an already aborted request before dispatch and delegates in-flight settlement to the concrete executor', async () => {
    const execution: D3ContainerToolExecution = { runFixed: vi.fn(), terminateAndJoin: vi.fn() }; const controller = new AbortController(); controller.abort();
    await expect(new D3ContainerToolRunner(authority, execution, testD3Operation).ageVersion(controller.signal)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED' });
    expect(execution.runFixed).not.toHaveBeenCalled();
  });

  it('keeps tool stderr and private material out of errors and backup receipts', async () => {
    const privateText = 'AGE-SECRET-KEY-DO-NOT-EXPOSE'; const failed: D3ContainerToolExecution = { runFixed: async () => ({ exitCode: 1, stdout: new Uint8Array(), stderr: Buffer.from(privateText) }), terminateAndJoin: vi.fn() };
    const error = await new D3ContainerToolRunner(authority, failed, testD3Operation).ageVersion().catch((cause: unknown) => cause); expect(JSON.stringify(error)).not.toContain(privateText);
    const execution: D3ContainerToolExecution = { runFixed: async () => ({ exitCode: 0, stdout: Buffer.from(testAgeRecipient + '\n'), stderr: new Uint8Array() }), terminateAndJoin: vi.fn() };
    await expect(new D3ContainerToolRunner(authority, execution, testD3Operation).ageRecipient()).resolves.toEqual({ recipient: testAgeRecipient });
  });
});
