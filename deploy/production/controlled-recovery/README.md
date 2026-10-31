# Controlled recovery deployment assets

These files define Packet 1's build/package contract only; they do not activate recovery.

- `profile.schema.json` is the reviewed closed deployment schema.
- `profile.example.json` is a non-runnable placeholder example for release engineering.
- `assets.example.json` shows the root-owned hash manifest format. Its SHA-256 is pinned by the installed profile.
- `dist-cli/scripts/controlled-docker-recovery.js` is compiled by `tsconfig.production-cli.json`; the runtime package exposes only `production:controlled-recovery` for this surface.

An installed profile and every listed asset must be root-owned, regular, single-link, not group/world writable, and at the exact fixed paths. Replace every placeholder identity/digest and complete the later disposable Docker gate before activation. Packet 1 intentionally ships no adapter activation and no native-engine selector.

Packet 2 adds a separately signed `profile.packet2.example.json` contract and
explicit injected promotion/rollback command boundaries; it does not mutate the
Packet 1 release-01/0055 assets. See
`docs/runbooks/controlled-docker-recovery-packet2.md`.

Packet 3 adds the separate release-03/0057 application schema entry and a
signed, secret-free report projection import. `profile.release-03.example.json`
is the separate current-release controlled recovery admission contract; older
enrolled sources still require a passing reviewed compatibility decision. It does not widen either prior
runtime pin and does not make the native recovery engine selectable. See
`docs/runbooks/controlled-docker-recovery-packet3.md`.

Activation Packet A adds a fixed-path, disabled-by-default release-03 activation
contract, typed local-Docker runner foundation, exact per-role mounts and
disk-streaming archive/object contracts. `activation.disabled.example.json` is
the default posture; `activation.tiny-disposable.example.json` is explicitly
non-production test data. Packet A ships no effect adapter. Packet B (real
Packet 1 adapter) is now present as a static/injected composition, but the
Packet A activation deliberately lacks its executable/credential/validation
asset authority and therefore fails closed before effects. Packet C (Packet 2
plus disposable Docker E2E) remains pending. See
`docs/runbooks/controlled-docker-recovery-activation-packet-a.md` and
`docs/runbooks/controlled-docker-recovery-activation-packet-b.md`.

Activation Packet C adds the separately pinned release-03/0057 Packet 2 profile,
transactional reconciliation, protected promotion/rollback snapshot contracts and
a readiness-first tiny-disposable E2E harness. These files are staged as inactive
foundation assets only; the Packet A activation cannot authorize them. See
`docs/runbooks/controlled-docker-recovery-activation-packet-c.md`.

