# Controlled Recovery Activation Packet D1 — Read-only Development Readiness

Packet D1 is a development-only, non-production readiness observer. It reads `/proc` memory and pressure data, filesystem capacity/inodes, fixed application artifacts, Firefox metadata, and a fixed local Unix Docker context/daemon/image/workload projection. It does not create, start, stop, signal, import, decrypt, restore, promote, roll back or clean up anything. `run` is unconditionally unavailable. Packet D1 cannot satisfy production, split-host, topology, RTO or maintenance gates.

## Fixed activation

The sole activation path is compiled as `/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-readiness.activation.json`. There is no CLI, environment or caller path/endpoint/context/command/Compose override. The checked-in activation is intentionally unenrolled: its zero/placeholder socket, daemon and image identities make readiness fail closed until a developer reviews exact local identities into this one file. It is never copied into `deploy/production`, the production CLI TypeScript closure, or production activation assets.

The tiny serial projection requires the maximum enrolled stage peak plus a 512 MiB host reserve. It separately reports the production 4 GiB minimum but never treats the tiny profile as satisfying it. Current swap use, recent `/proc/pressure/memory` `some avg10` when available, workspace/target bytes and inodes are independent gates. Any running Docker container is conservatively a foreign-workload collision. Firefox is only `lstat`-checked for an executable regular file and is never opened, signalled or controlled.

## Read-only commands

From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`:

```bash
npm run controlled-recovery:e2e:readiness
```

This emits one canonical secret-free report and exits nonzero when any readiness code is present. For projection-only reporting with a successful command exit even when not ready:

```bash
npm run controlled-recovery:e2e:readiness-report
```

Do not add `run`, paths or overrides. Packet D1 rejects them before loading activation or observing the host.

## Remaining gates

Exact socket/daemon/version/root/context and preloaded PostgreSQL, MinIO and Valkey image identities must be independently reviewed and enrolled. A later packet may add effect-capable disposable execution only after separate approval. Installed-host readiness, real Docker output, production sizing, split-host/TLS topology, encrypted backup, services, browser/player validation, promotion/rollback and measured RTO remain Not Tested.
