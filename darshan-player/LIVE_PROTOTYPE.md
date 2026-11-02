# Development live receiver prototype

This is the loop-1 media/security prototype. It is not a production Live Broadcast
feature and does not implement schedule creation, approval or publishing. It is a
temporary mode inside the **same existing DARSHAN player binary**, not a second
product or deployment application. The final feature must use the ordinary
player schedule/lifecycle, emergency, security, cache and telemetry paths; this
experimental entrypoint is not that integration. The
ordinary player lifecycle and its identity/cache are not started by this entrypoint.
The prototype is accepted only with explicit `DARSHAN_RUNTIME_MODE=dev`.

## Launch

Build using the existing Node 20 installation (`npm run build`). Create a private
JSON file outside tracked source, such as an ignored `out/.../receiver.json`, with
Unix mode `0600`:

```json
{
  "authority_url": "http://127.0.0.1:19180/prototype/authority",
  "renewal_token": "REPLACE_WITH_PRIVATE_HARNESS_RECEIVER_TOKEN",
  "receiver_session_id": "receiver-one"
}
```

Optional `evidence_dir` enables PNG capture from the actual Electron window after
first-frame and fallback transitions. On this Linux prototype, set it to an
existing absolute directory beneath the OS temporary directory, owned by the
current user with mode `0700`; the temporary root itself, symlink directories,
home/production/cache paths and shared-readable directories are rejected. For
example, create a dedicated `/tmp/darshan-live-pixel-evidence-<unique-id>` directory
and place its path in the private config. Each capture gets a timestamp/event/UUID
filename created exclusively with mode `0600`; existing files are never replaced.
The application limits this opt-in stream to 120 images per launch and one active
capture plus one latest pending transition. Tokens and authority data never enter
filenames. Review the visible content before copying PNGs into QA artifacts.
Windows evidence-directory ACL support is not part of this Linux prototype.

An optional `fallback_path` is an absolute path to an existing local PNG/JPEG/WebP.
Missing or unreadable configuration aborts startup. An unavailable/corrupt image
shows Content unavailable. The authority must be loopback; HTTP is allowed here
solely for this explicit development harness. No certificate bypass is enabled.

```bash
DARSHAN_RUNTIME_MODE=dev NODE_ENV=development \
  ./node_modules/.bin/electron . --live-prototype=/absolute/private/receiver.json
```

The packaged Linux executable accepts the same arguments. Different receiver
session IDs have separate Electron user-data profiles under the OS temporary
directory. Duplicate session IDs retain the normal Electron singleton exclusion;
the production singleton path is unchanged. Closing the fallback window stops
the prototype. It neither installs autostart nor changes system configuration.
Before Electron receives the prototype profile path, the directory is checked
with `lstat` and canonical path comparison; symlinks and non-directories are
rejected. Unix profiles must be owned by the running user with no group/other
permissions, including when a directory already exists from an earlier launch.

## Harness protocol

Main process sends `POST authority_url`, `Authorization: Bearer renewal_token`,
and JSON `{ "receiver_session_id": "receiver-one", "reconnect": true }` initially
and after receiver cleanup. Healthy renewals send `reconnect: false` every three
seconds. The harness returns:

```json
{
  "ticket": "ONE_USE_GATEWAY_TICKET_ONLY_FOR_INITIAL_OR_RECONNECT",
  "signal_url": "ws://127.0.0.1:19181",
  "admission_id": "opaque-admission-id",
  "run_id": "opaque-run-id",
  "generation": 1,
  "presenter_identity": "opaque-presenter-id",
  "lease_ms": 10000,
  "window_remaining_ms": 60000
}
```

Healthy renewal omits `ticket` and retains admission/run/generation/presenter and
signaling origin. The opaque ticket is sent to the gateway by the SDK; no SFU API
secret or long-lived LiveKit JWT is provided to the renderer. Insecure signaling
is loopback-only; other endpoints require trusted WSS. HTTP redirects are not
followed. Responses are limited to 16 KiB and an absolute 1.5-second deadline
aborts requests even when a peer keeps sending small chunks. Only the documented
grant fields cross IPC; unexpected authority fields are discarded.

## Safety and evidence boundary

- Main process measures elapsed authority from request start, subtracting round
  trip time and capping each lease at ten seconds and the remaining window.
- Transient renewal failures cannot extend authority. Rejection is terminal;
  local expiry destroys the live BrowserWindow and its media/audio context.
- Suspend invalidates authority; resume requires fresh admission. Old async
  responses, IPC observations and renderer callbacks cannot replace new authority.
- Receiver uses a sandboxed, isolated, packaged renderer with no Node access or
  authority-fetch API. It subscribes only to the named presenter's screen share
  and optional microphone/captured sound. It never publishes camera/microphone.
- The SDK does not own reconnect authority. Disconnect/reconnecting destroys the
  receiver; main obtains a new one-use ticket after bounded retry.
- Both prototype endpoints explicitly use `rtcConfig: { iceServers: [] }` for
  direct local ICE. Public STUN, private TURN and routed production network
  behavior are not covered by this local transport check.
- Fallback remains visible until a decoded video-frame callback is observed.
  Connection, first-frame and audio-play outcomes are separate observations.
  These player reports do not establish human-visible display or audible sound.
- Renderer crash/unresponsive events destroy its context and restore fallback.
  Gateway/SFU enforcement is a separate mandatory prototype gate; this client
  cannot establish that an untrusted revoked receiver stops receiving media.
- Credentials remain in process memory and the private config only. They are
  never written to ordinary snapshots, queues or logs. Safe stdout observations
  contain event/run/generation/admission only; handle debug capture as sensitive.

Focused developer checks:

```bash
npx mocha --config .mocharc.json \
  --spec test/unit/services/live-prototype-config.test.ts \
  --spec test/fault-injection/live-prototype-authority.test.ts
```

Real CMS capture, real gateway/SFU, actual Electron video/audio, revocation,
Backend/media interruption, and restoration must be observed before reporting
loop-1 runtime acceptance. Mocked or headless renderer tests are supporting
coverage, not this acceptance evidence.
