# Backup recovery Packet 05B1b2a QA checklist

This checkpoint is source/native-fixture only. Do not run Docker, systemd,
SSH, an external network, decrypt/import/restore, live services, production
private keys, or privileged installation.

## Required local evidence

- Compile both native programs with C11, `-Wall -Wextra -Werror`.
- Prove canonical absolute path and Unix path-length rejection, no-symlink
  ancestor resolution, protected parent owner/group/mode/device stability,
  socket final owner/group/mode/type/inode, and no-clobber retained evidence.
- Prove exact bridge uid admission with `SO_PEERCRED`, backlog/live-child limit
  four, fork/exec and disconnect behavior, bounded stdin/response frames,
  slow/incomplete frames, and fixed bridge exit/stderr behavior.
- Prove child fd closure, empty supplementary groups, helper uid/gid, zero
  effective capabilities, and no-new-privileges where the local kernel permits.
- Race TERM/INT before accept and during a child, prove new admissions stop,
  bounded drain then TERM/KILL/reap, and exact socket preservation. A crash
  orphan or pathname replacement must remain fail-closed evidence.
- Hold a competing OFD authority lock. Reconcile only a strict prior-token
  helper lock with no live owner; retain it via `RENAME_NOREPLACE` and fsync.
  Reject legacy/unbound, live, malformed, symlink, hardlink, wrong metadata,
  mount/device mismatch, collision, and authority-record corruption.
- Run one-shot worker framing, idle/frame/action deadlines, response cap,
  stable sanitized failures, production authority-token requirement, and
  stable `TARGET_NOT_INSTALLED` coverage. Existing historical journal fixtures
  must remain valid.
- Run accepted Packet 05B1a/05B1b1 recovery suites, full serialized recovery
  regression, typecheck, touched lint, backend build, diff/evidence review.

## Explicit later gates

- 05B1b2b: Backend SSH relay, forced-command installation, remote host trust;
- 05B1b3: Docker/engine plus target filesystem, volume and network effects;
- 05B1b4: signed bundle, source-free verifier, systemd/installation packaging;
- later: decrypt/import, reconciliation, validation, promotion/rollback,
  successful hold release, live topology and production rehearsal.
