# Backup recovery Packet 05B1b2b QA checklist

This checkpoint is local fake-SSH/native-fixture only. Do not run real SSH, an
external network, Docker, live/systemd, decrypt/import/restore, or production
private keys.

## Required local evidence

- Strict C11 compile of `recovery-target-relay-listener` with
  `-Wall -Wextra -Werror`; no-argument invocation and compiled-only paths.
- Canonical root/runner-group `0710` socket parent, root/runner-group `0660`
  socket, exact runner `SO_PEERCRED`, backlog/live-child cap four, dedicated
  relay identity, empty groups, zero capabilities, NNP, closed descriptors.
- OFD authority contention; exact authority bindings; corrupt/wrong-mode/link
  rejection without repair; TERM/INT admission fence; bounded drain/TERM/KILL/
  reap; per-worker process group plus subreaper descendants; negative
  `kill(-pgid, 0)` before authority release; exact no-clobber `.closed.*`;
  crash/replacement evidence retained.
- Canonical protected relay config; fixed site/installations/destination/port/
  user/alias/fingerprints/paths/contract/deadlines; metacharacter, unknown-field,
  unsafe metadata, hardlink/symlink and unstable-file rejection.
- Fully buffer one canonical request plus EOF before fake SSH; five-second
  absolute incomplete-frame timer; 64 KiB request and 128 KiB response caps.
- Capture fake SSH argv, environment and stdin. Prove `/usr/bin/ssh`,
  `/dev/null` config, fixed identity/known-host/alias/user/port/destination,
  strict host verification, explicit host-IP policy, disabled interactive auth,
  forwarding/tunnel/TTY/control/proxy/local-command/update options, empty client
  command, and absence of ambient `SSH_*`/proxy/loader variables.
- Fake success, bounded stderr, nonzero, hang/deadline, oversize, truncation,
  multiframe, noncanonical response, request backpressure, cancellation before
  and after dispatch, full/partial stdin write failure, end failure, asynchronous
  stdin error, worker TERM/INT, TERM-resistant SSH, and local disconnect
  before/after dispatch. Prove bounded close and no child/descendant remains.
- Verify definite pre-dispatch versus uncertain after request bytes, and exact
  replay/reconciliation ownership remains in the accepted helper journal.
- Default controller accepts only its fixed config-v3 socket and verifies
  parent/socket owner/group/mode/type/canonical path and stable inode before
  dispatch. Runner remains network-none and sees only the relay socket.
- Review authorized-key documentation for `restrict` plus fixed forced command,
  no PTY/forwarding/agent/X11/user-rc/environment, and empty original command.
  The stdio bridge accepts only unset/empty `SSH_ORIGINAL_COMMAND` and rejects
  every nonempty value before connecting.
- Run accepted 05B1a/05B1b1/05B1b2a recovery suites, full serialized recovery,
  typechecks, touched lint, backend build, diff and evidence review.

## Explicit live and later gates

- No real SSH daemon/client, route, firewall, DNS, host-key negotiation,
  authorized-key installation, key custody/HSM, rotation cutover, service
  manager or privileged production account has been exercised.
- Packet 05B1b3 owns real Docker/engine and target resource effects.
- Packet 05B1b4 owns signed-role/source-free bundle, installed-content digest,
  final systemd and forced-command packaging verification.
- Decrypt/import, reconciliation, validation, promotion/rollback, successful
  hold release, live topology, RPO/RTO, load/stress/soak, failover and production
  rehearsal remain open.
