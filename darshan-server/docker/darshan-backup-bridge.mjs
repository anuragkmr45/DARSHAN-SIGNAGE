#!/usr/bin/env node
// Pinned, dependency-free protocol-v2 transport. It cannot execute commands,
// accept filesystem paths, or interpret signing payloads.
import net from 'node:net';

const MAX_REQUEST = 2 * 1024 * 1024;
const MAX_RESPONSE = 24 * 1024 * 1024;
const allowed = new Set(['DESCRIBE', 'SELECT_CAPSULE', 'PREPARE_PUBLICATION', 'COMMIT_PUBLICATION', 'INSPECT_PUBLICATION', 'QUARANTINE_PUBLICATION', 'INSPECT_RESTORE_HOLD']);
const chunks = []; let bytes = 0;
for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > MAX_REQUEST) throw new Error('Broker bridge request exceeds 2 MiB.'); chunks.push(chunk); }
const requestBytes = Buffer.concat(chunks); const request = JSON.parse(requestBytes.toString('utf8'));
if (!request || request.protocol_version !== 2 || !allowed.has(request.operation) || 'path' in request || 'command' in request || 'payload' in request) throw new Error('Broker bridge accepts only fixed protocol-v2 operations.');
const socketPath = process.env.DARSHAN_BACKUP_BROKER_SOCKET;
if (!socketPath?.startsWith('/')) throw new Error('DARSHAN_BACKUP_BROKER_SOCKET must be an absolute socket path.');
const socket = net.createConnection(socketPath); const output = []; let outputBytes = 0;
socket.once('connect', () => socket.end(requestBytes.at(-1) === 10 ? requestBytes : Buffer.concat([requestBytes, Buffer.from('\n')])));
socket.on('data', (chunk) => { outputBytes += chunk.length; if (outputBytes > MAX_RESPONSE) socket.destroy(new Error('Broker response exceeds 24 MiB.')); else output.push(chunk); });
await new Promise((resolve, reject) => { socket.once('end', resolve); socket.once('error', reject); });
process.stdout.write(Buffer.concat(output));
