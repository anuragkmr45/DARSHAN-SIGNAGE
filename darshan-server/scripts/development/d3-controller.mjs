import { spawn } from 'node:child_process';
const executable = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/node_modules/.bin/tsx';
const controller = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/controlled-recovery-d3-controller.ts';
const child = spawn(executable, [controller], { cwd: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server', stdio: 'inherit', env: { PATH: '/usr/bin:/bin', HOME: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3/home', NODE_ENV: 'production' } });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (value, signal) => signal ? reject(new Error(`D3 controller terminated by ${signal}`)) : resolve(value ?? 1)); });
process.exitCode = Number(code);
