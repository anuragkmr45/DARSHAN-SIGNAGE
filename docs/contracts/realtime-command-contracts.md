# Realtime And Command Contracts

Last code-truth audit: 2026-06-28.

Realtime in DARSHAN is notification-only. PostgreSQL plus REST APIs remain authoritative for commands, desired state, schedules, default media, emergency state, telemetry, and evidence.

## Contract Rules

- WebSocket/Socket.IO messages wake clients; they do not carry media bytes or full state.
- `deviceCommands`, `commandOutbox`, and `deviceDesiredState` are backend data contracts.
- Players must tolerate duplicate or missed notifications.
- Polling and heartbeat fallback remain mandatory.

## Device Realtime Contract

| Contract area | Code source of truth | Data/API dependency | Consumers | Verification status |
|---|---|---|---|---|
| Device namespace | `darshan-server/src/realtime/device-gateway.ts`, `server/index.ts`, player `realtime-service.ts` | Socket.IO namespace, default `/device` | Player | Code-backed; proxy/LAN runtime test required. |
| HELLO / HELLO_ACK | backend device gateway and player realtime service | device id, session metadata, local desired-state hints | Player/backend | Code-backed. |
| `COMMAND_AVAILABLE` | `services/outbox-dispatcher.ts`, `realtime/device-gateway.ts`, player realtime service | command/outbox rows | Player | Wake notification only; player fetches REST commands. |
| `RESYNC_REQUIRED` | outbox/realtime services and player realtime service | desired state and resource hints | Player | Wake notification only; player fetches desired state/snapshot/default media. |
| `SERVER_TIME` / `ERROR` | device gateway/player realtime service | clock/auth/error metadata | Player | Code-backed. |
| Payload hardening | player realtime service, backend metrics/hardening | notification payload size/config | Backend/player | Code-backed; gateway/proxy test required. |

## Command Lifecycle Contract

| Stage | Code source of truth | Data/API dependency | Notes |
|---|---|---|---|
| Create command | `darshan-server/src/services/command-lifecycle-service.ts`, `playback-refresh-commands.ts`, route/service callers | `deviceCommands`, `deviceCommandStatusHistory` | Commands are durable intent. |
| Record desired state | `device-desired-state-service.ts` | `deviceDesiredState`, `deviceDesiredStateHistory` | State versions drive reconciliation. |
| Write outbox event | `command-outbox-service.ts`, command lifecycle service | `commandOutbox` | Outbox is notification intent, not state authority. |
| Dispatch outbox | `outbox-dispatcher.ts`, device gateway, realtime bus | Socket.IO, optional Valkey Pub/Sub | Dispatch failure does not remove durable command truth. |
| Player fetch | `darshan-player/src/main/services/command-processor.ts` | `GET /api/v1/device/:deviceId/commands` | Polling and realtime wake both converge on REST fetch. |
| Player ACK | player command processor/request queue, backend `routes/device-telemetry.ts` | `POST /api/v1/device/:deviceId/commands/:commandId/ack` | ACK failure is retryable through player queue paths where supported. |

## Refresh Reasons And Consumers

| Trigger | Code source of truth | Expected player action |
|---|---|---|
| Schedule publish/takedown | `routes/schedules.ts`, `schedule-publish-helper.ts`, `playback-refresh-dispatch.ts` | Fetch commands, desired state, snapshot. |
| Default media change | `routes/settings.ts`, default-media utilities, refresh dispatch | Fetch commands/desired state/default media. |
| Emergency start/clear | `routes/emergency.ts`, command refresh services | Fetch commands/snapshot/emergency state. |
| Screen group membership | screen/group route services and refresh dispatch | Reconcile desired state and snapshot. |
| Manual command/screenshot/cache/reboot/ping | screen/device command route paths and command processor | Execute command side effect then ACK. |

## Browser Realtime Contract

| Namespace / channel | Code source of truth | Purpose |
|---|---|---|
| Screens | backend `realtime/screens-namespace.ts`, CMS screen realtime hooks | Screen state refresh hints. |
| Chat | backend `realtime/chat-namespace.ts`, CMS chat hooks | Conversation/message updates. |
| Notifications | backend `realtime/notifications-namespace.ts`, CMS notification socket | Notification count/list hints. |

Browser realtime does not replace REST query state.

## Valkey Fanout Contract

| Behavior | Code source of truth | Notes |
|---|---|---|
| Pub/Sub bus | `darshan-server/src/realtime/realtime-bus.ts`, `valkey-realtime-bus.ts` | Optional multi-node fanout provider. |
| Device node registry | `realtime/device-node-registry.ts`, `device-connection-registry.ts` | Maps device connection to node with TTL. |
| Failure fallback | realtime bus and outbox dispatcher error handling | REST/polling remains recovery path. Needs target outage verification. |

## Runtime Verification Required

- Socket.IO `/device` connection through production nginx/CMS proxy path.
- Valkey outage and recovery while publish/default-media/emergency changes occur.
- Reconnect storm behavior with target fleet size.
- Emergency fanout latency under realistic LAN and player count.
- Browser realtime channels after deployed CMS build and runtime config.
