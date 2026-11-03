# Normal-player scheduled LIVE integration

This implementation runs in the ordinary installed DARSHAN Player, its existing
pairing flow, main window, renderer, cache, security guard and emergency lifecycle.
It does not launch the development prototype or create a second production app.
`--live-prototype` remains a separate, development-only transport harness.

The default `livePlayback.enabled` is false. Production and QA capability
advertisement remains withheld until the integrated normal-player runtime gate
is completed. This source checkpoint is not human QA approval.

## Authority and ownership

- Signed-device REST discovery returns the exact frozen current and next LIVE
  occurrences independently of whichever ordinary publish is most recent.
  Current-group changes cannot expand this frozen audience.
- The ordinary signed REST heartbeat declares the same full current player
  capabilities as HELLO, including removal of LIVE when its gate is disabled.
  A disabled or unavailable WebSocket cannot prevent capability bootstrap.
  LIVE uses the existing PairingService process runtime UUID already carried by
  the heartbeat. Unsigned legacy heartbeats retain their normal behavior, but
  their optional capability claims are ignored by the server.
  Trusted capability reports store only a hash of the process UUID. The same
  row-locked metadata writer handles HELLO and REST, preserving unrelated
  identity diagnostics. A legacy HELLO cannot overwrite a trusted report or
  advertise LIVE. Signed HELLO without its process UUID withholds LIVE until
  the next complete signed heartbeat establishes that binding.
- An invalid frozen fallback or conflicting current windows still owns its
  validated window and displays **Content unavailable**. It cannot reveal the
  site's ordinary default content. An unavailable emergency preempts LIVE.
  A missed emergency notification is recovered through fresh REST discovery;
  fallback stops before any download/hash work. If the full emergency control
  cannot be fetched, unavailable remains visible even after the LIVE window
  ends, until fresh REST proves that the emergency cleared. An older delayed
  normal-control response cannot clear a more recent confirmed emergency.
- All immutable fallback dependencies are pinned and verified from actual bytes,
  approved SHA and size. Remote download status never overrides verified local
  bytes. Fallback TimelineItems retain business media IDs for ordinary PoP and
  use separate content-addressed cache keys. Existing layout/timeline rules
  handle legacy unslotted entries and layout aliases.
- Whole-snapshot delivery confirmation waits for every required LIVE dependency.
  Fresh LIVE/emergency control is persisted and displayed before a long media
  download finishes; older completions cannot acknowledge a newer snapshot.
- Main owns ephemeral admissions, tickets and conservative monotonic deadlines.
  Each authority call has a 1.5-second total limit, no automatic HTTP retry and
  no redirects. Pending admission is not a lease; a fresh `/ticket` is required.
  Renewals occur at three seconds and cannot extend past the window or a
  ten-second grant. Ended/revoked-run 409/410 responses do not reset pairing.
- The packaged sandboxed receiver is a managed WebContentsView inside the same
  main window. It can contact only its one authenticated gateway origin and
  its packaged receiver assets. It cannot navigate, open popups, capture input,
  download files, obtain media permissions or call authority REST endpoints.
- The receiver subscribes only to the assigned presenter's screen-share track
  and the explicitly approved audio sources. SDK reconnection is disabled.
  It remains hidden and muted while ordinary fallback plays. A decoded frame
  plus the exact ordinary-renderer disposal acknowledgement is required before
  LIVE becomes visible or audible. Renderer reports carry a main-owned content
  epoch and sender identity fence before telemetry, cache or PoP mutations.
  Ordinary webpage mount requests retain that same captured epoch; a pending
  host/DNS check cannot attach a stale webpage view over the new LIVE owner.
- The receiver also anchors a private lease pulse *before* invoking IPC. Main
  returns only its remaining authority/window time and exact view epoch. A
  delayed or missing response consumes the old budget; the receiver's own
  expiry clears tracks, video and audio even if main is stalled. A late pulse
  can never resurrect a disposed view.
- Emergency, security lock, identity reset, suspend, display/window changes,
  crash and quit synchronously mute/destroy LIVE first. Switching back to
  fallback clears old readiness, displays unavailable, and rehashes CAS bytes
  before revealing fallback. Reconnection/resume requires fresh authority and
  a fresh admission. A disposal timeout keeps the old renderer muted and
  reloads it; it cannot unmute old DOM/audio.
- Run observations are separate from ordinary media proof-of-play. They report
  player receipt/subscription/decoded-frame/audio evidence, not physical-display
  confirmation. Screenshot capture selects the currently visible authorized
  LIVE view and rechecks its lease/epoch after capture.

## TLS and transport boundary

Node authority requests always validate TLS. The isolated Chromium session uses
normal OS trust by default. When a configured private transport CA is needed,
a single bounded Node TLS probe validates the exact gateway host/port with the
standard CA/hostname/IP/validity/chain validator; the verified leaf DER hash must
match Chromium's actual peer leaf. Disposed sessions reject late probe results.
There is no global certificate bypass or custom certificate-chain parser.
HTTP transport reconfiguration is atomic. A missing new CA stops requests until
a valid configuration is applied, and older responses or retries cannot cross
into the new backend/trust context.

Initial transport uses direct private-LAN ICE with explicit `iceServers: []`.
It never consults public STUN/TURN. Private TURN, routed/NAT traversal, advertised
media-node addresses, firewall/UDP paths, Windows and physical display/audio
must be measured separately in the target environment.

## Controlled local normal-app runtime gate

Only a new, explicitly owned test profile may advertise the temporary development
capability. Preserve the baseline player's profile, device identity and process.
Prepare a private absolute directory (0700 on Linux), containing a regular,
non-symlink 0600 `.darshan-normal-live-test.json` file with exactly:

```json
{"version":1,"purpose":"normal-live-integration"}
```

Use the normal player configuration in that directory. Required settings are
`runtime.mode: "dev"`, `livePlayback.enabled: true`, an HTTPS loopback `apiBase`,
the correct site `wsUrl` and private transport CA, and cache/certificate paths
inside this same directory. Do not copy the baseline device identity. Complete
fresh pairing through the ordinary CMS screen approval flow.

Start the ordinary packaged binary with these explicit environment values:

```text
DARSHAN_RUNTIME_MODE=dev
DARSHAN_RUNTIME_ROOT=<absolute owned profile>
DARSHAN_DEV_LIVE_CAPABILITY=1
DARSHAN_LIVE_PLAYBACK_ENABLED=true
DARSHAN_CONFIG_PATH=<absolute owned profile>/config.json
DARSHAN_CACHE_PATH=<absolute owned profile>/cache
DARSHAN_MTLS_CERT_DIR=<absolute owned profile>/certs
```

Unset inherited `DARSHAN_PLAYER_CONFIG_FILE` / `SIGNHEX_PLAYER_CONFIG_FILE` values
unless their selected configuration is also inside the owned profile. Explicit
configuration, cache and identity path overrides outside that root are rejected
for this development launch. Set `DARSHAN_CONFIG_PATH`, `DARSHAN_CACHE_PATH` and
`DARSHAN_MTLS_CERT_DIR` explicitly under the owned profile.

The validated marker permits the ordinary dispatcher to select that Electron
userData directory before the unchanged singleton lock. The rest of startup is
the normal application path. The override is refused outside explicit dev mode;
the capability also requires enabled LIVE, an exact loopback backend hostname,
and cache/certificate paths confined to that owned profile. Production and QA
cannot use this override. Neither the profile nor its generated credentials may
be committed. Remove the override from final deployment procedures.
The validated owned fixture also skips OS autostart management, preserving the
ordinary installation's login entry. Other dev, QA and production startup keeps
its existing autostart behavior. Choose an unused loopback observability port
for the extra local instance with `DARSHAN_OBSERVABILITY_PORT`.

Before any beta-ready claim, run the required player unit/integration/fault/build
checks and the real normal CMS → publish → ordinary pairing/player → fallback →
LIVE frame/audio → emergency/stop/expiry/recovery journey. A prototype run or a
synthetic frame alone does not satisfy the normal-player capture gate.
