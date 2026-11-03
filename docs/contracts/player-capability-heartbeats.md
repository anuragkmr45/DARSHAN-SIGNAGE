# Player capability reports

New players report the full current `player_capabilities` object on ordinary
`POST /api/v1/device/heartbeat` requests. The object uses the existing HELLO
capability schema and limits. The existing `runtime_session_id` is the same
process UUID used by PairingService and LIVE authority calls. Reporting does
not require the WebSocket namespace to be enabled or reachable.

The server trusts a REST capability report only when the device authenticator
actually verified its request signature, independently of the configured
legacy/dual/signature rollout mode. A serial-only legacy heartbeat continues
to return its ordinary response; any supplied capability object is ignored and
removed from stored telemetry. Invalid supplied signatures remain errors.

Signed capability reports require a UUID runtime session and agreement with
any supplied runtime-session header. Metadata records the complete current
capability object, server observation time, authenticated source, trust flag,
and SHA-256 of the runtime UUID. Raw runtime UUIDs and credentials do not enter
the capability metadata. Disabling LIVE sends the current no-LIVE declaration
on the next heartbeat, replacing an earlier declaration.

HELLO and heartbeat reports share one row-locked, partial JSONB merge writer.
Legacy HELLO retains other compatibility features when no trusted report
exists, cannot advertise LIVE, and cannot overwrite a trusted report. A signed
HELLO may replace capabilities; without a valid runtime UUID it clears the
process hash and withholds LIVE until a complete signed REST report arrives.
Identity-session diagnostics use the same Screen transaction lock and partial
merge, so concurrent updates cannot lose capabilities or unrelated metadata.

Capability reports describe client protocol support. They grant no run lease,
admission or playback authority. Each LIVE action still requires fresh signed
REST authentication and current publication, frozen audience, credential,
emergency, run and admission checks.
