# DARSHAN Onboarding

Last code-truth refresh: 2026-06-28.

This folder helps new engineers, operators, and field installers understand DARSHAN from the current codebase. It does not define new behavior.

## Start Here

| Reader | First doc | Follow-up |
|---|---|---|
| New engineer | `codebase-tour.md` | `backend-cms-player-onboarding.md`, `docs/architecture/product-architecture.md` |
| Backend/CMS/player developer | `backend-cms-player-onboarding.md` | `docs/contracts/README.md`, `docs/implementation/IMPLEMENTATION_TRACEABILITY.md` |
| Production operator | `production-docker-on-vm-onboarding.md` | `deploy/production/README.md`, `docs/environments/production/README.md` |
| Player field installer | `player-field-onboarding.md` | `docs/support/player-troubleshooting.md`, `docs/support/screen-operations-runbook.md` |
| Support engineer | `docs/support/README.md` | `docs/governance/runtime-evidence-governance.md` |

## Product Shape

DARSHAN has three application runtimes:

- Backend: Fastify API, PostgreSQL, object storage, Valkey realtime fanout, pg-boss jobs, observability.
- CMS: React/Vite browser UI using REST plus browser Socket.IO notification channels.
- Player: Electron app using REST/DB authority, local runtime identity/cache, Socket.IO wake-up notifications, and offline fallback.

Production uses Docker role deployments on normal Ubuntu Server VMs. Proxmox is the hypervisor only.

## Rules For New Contributors

- Code is the source of truth.
- Do not move media through sockets; media must stay HTTP/object storage/local cache.
- REST/DB remain authoritative; Socket.IO is notification-only.
- Keep secrets in env/secret stores/runtime state, not browser config or committed examples.
- Do not claim production readiness without runtime evidence.
- Before changing behavior, check `docs/contracts` and `docs/governance`.
