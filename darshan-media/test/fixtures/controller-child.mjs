import { writeFileSync } from 'node:fs';
if (process.env.TEST_START_MARKER) writeFileSync(process.env.TEST_START_MARKER, 'started');
let sequence = 0;
const heartbeat = process.env.TEST_READY_WITHOUT_HEARTBEAT ? undefined : setInterval(() => process.send({ type: 'heartbeat', sequence: ++sequence,
  authority_node_instance_id: process.env.DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID }), 30);
if (process.env.TEST_READY_WITHOUT_HEARTBEAT) process.send({ type: 'ready' });
if (process.env.TEST_STOP_HEARTBEAT) setTimeout(() => clearInterval(heartbeat), 120);
if (process.env.TEST_ISOLATE) setTimeout(() => process.send({ type: 'isolate', reason: 'TEST_FAILURE' }), 120);
setInterval(() => {}, 1000);
