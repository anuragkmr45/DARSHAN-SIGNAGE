#!/usr/bin/env node

const PROFILES = {
  current: {
    description: 'Current/fallback polling model',
    heartbeatSeconds: 30,
    commandPollSeconds: 5,
    desiredStateSeconds: 0,
    snapshotPollSeconds: 300,
    defaultMediaPollSeconds: 300,
  },
  fallback: {
    description: 'WebSocket disconnected fallback polling model',
    heartbeatSeconds: 30,
    commandPollSeconds: 5,
    desiredStateSeconds: 0,
    snapshotPollSeconds: 300,
    defaultMediaPollSeconds: 300,
  },
  'hybrid-healthy': {
    description: 'Healthy notification-only WebSocket with safety polling',
    heartbeatSeconds: 30,
    commandPollSeconds: 60,
    desiredStateSeconds: 300,
    snapshotPollSeconds: 600,
    defaultMediaPollSeconds: 600,
  },
};

function parseArgs(argv) {
  const args = {
    profile: 'current',
    players: 1000,
    durationSeconds: 300,
    averageItemSeconds: 10,
    uncachedDevices: 1000,
    mediaSizeMb: 100,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [key, inlineValue] = arg.slice(2).split('=');
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (value === undefined) throw new Error(`Missing value for --${key}`);

    switch (key) {
      case 'profile':
        args.profile = value;
        break;
      case 'players':
        args.players = Number(value);
        break;
      case 'duration-seconds':
        args.durationSeconds = Number(value);
        break;
      case 'average-item-seconds':
        args.averageItemSeconds = Number(value);
        break;
      case 'uncached-devices':
        args.uncachedDevices = Number(value);
        break;
      case 'media-size-mb':
        args.mediaSizeMb = Number(value);
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!PROFILES[args.profile]) {
    throw new Error(`Unknown profile "${args.profile}". Expected one of: ${Object.keys(PROFILES).join(', ')}`);
  }

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Invalid numeric value for ${key}: ${value}`);
    }
  }

  if (args.players < 1) throw new Error('--players must be at least 1');
  if (args.durationSeconds < 1) throw new Error('--duration-seconds must be at least 1');
  if (args.averageItemSeconds < 1) throw new Error('--average-item-seconds must be at least 1');

  return args;
}

function perSecond(players, intervalSeconds) {
  return intervalSeconds > 0 ? players / intervalSeconds : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function buildModel(args) {
  const profile = PROFILES[args.profile];
  const heartbeatRps = perSecond(args.players, profile.heartbeatSeconds);
  const commandPollRps = perSecond(args.players, profile.commandPollSeconds);
  const desiredStateRps = perSecond(args.players, profile.desiredStateSeconds);
  const snapshotRps = perSecond(args.players, profile.snapshotPollSeconds);
  const defaultMediaRps = perSecond(args.players, profile.defaultMediaPollSeconds);
  const totalRps = heartbeatRps + commandPollRps + desiredStateRps + snapshotRps + defaultMediaRps;
  const heartbeatsPerDay = args.players * 86400 / profile.heartbeatSeconds;
  const popEventsPerDay = args.players * 86400 / args.averageItemSeconds;
  const mediaEgressGb = args.uncachedDevices * args.mediaSizeMb / 1024;

  return {
    profile: args.profile,
    description: profile.description,
    players: args.players,
    duration_seconds: args.durationSeconds,
    intervals_seconds: profile,
    rps: {
      heartbeat: round(heartbeatRps),
      command_poll: round(commandPollRps),
      desired_state: round(desiredStateRps),
      snapshot: round(snapshotRps),
      default_media: round(defaultMediaRps),
      total: round(totalRps),
    },
    requests_during_duration: {
      total: round(totalRps * args.durationSeconds),
      heartbeat: round(heartbeatRps * args.durationSeconds),
      command_poll: round(commandPollRps * args.durationSeconds),
      desired_state: round(desiredStateRps * args.durationSeconds),
      snapshot: round(snapshotRps * args.durationSeconds),
      default_media: round(defaultMediaRps * args.durationSeconds),
    },
    daily_volume: {
      heartbeats: Math.round(heartbeatsPerDay),
      proof_of_play_events_at_average_item_seconds: Math.round(popEventsPerDay),
    },
    fanout: {
      group_publish_command_rows: args.players,
      emergency_command_rows: args.players,
      websocket_notifications_if_all_connected: args.players,
    },
    media_egress: {
      uncached_devices: args.uncachedDevices,
      media_size_mb: args.mediaSizeMb,
      egress_gb: round(mediaEgressGb),
    },
    guardrails: {
      websocket_notification_only: true,
      rest_authoritative: true,
      media_over_websocket: false,
      polling_fallback_required: true,
    },
  };
}

function printText(model) {
  console.log(`Realtime sync load model: ${model.profile} (${model.description})`);
  console.log(`Players: ${model.players}`);
  console.log(`Duration: ${model.duration_seconds}s`);
  console.log('');
  console.log('Estimated RPS');
  for (const [key, value] of Object.entries(model.rps)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('');
  console.log('Daily volume');
  console.log(`  heartbeats: ${model.daily_volume.heartbeats}`);
  console.log(`  proof_of_play_events: ${model.daily_volume.proof_of_play_events_at_average_item_seconds}`);
  console.log('');
  console.log('Fanout');
  console.log(`  group_publish_command_rows: ${model.fanout.group_publish_command_rows}`);
  console.log(`  emergency_command_rows: ${model.fanout.emergency_command_rows}`);
  console.log(`  websocket_notifications_if_all_connected: ${model.fanout.websocket_notifications_if_all_connected}`);
  console.log('');
  console.log('Media egress');
  console.log(`  ${model.media_egress.uncached_devices} uncached devices * ${model.media_egress.media_size_mb} MB = ${model.media_egress.egress_gb} GB`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const model = buildModel(args);
  if (args.json) {
    console.log(JSON.stringify(model, null, 2));
  } else {
    printText(model);
  }
} catch (error) {
  console.error(`realtime-sync-load-model: ${error.message}`);
  process.exit(1);
}
