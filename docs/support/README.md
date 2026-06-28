# DARSHAN Support Playbooks

Last code-truth refresh: 2026-06-28.

This folder contains operator and support playbooks derived from current code and deployment contracts. It does not authorize production readiness or destructive recovery by itself.

## Playbook Index

| Playbook | Use |
|---|---|
| `screen-operations-runbook.md` | Screen lifecycle, pairing, recovery, online/offline, screenshot and default media triage. |
| `player-troubleshooting.md` | Player device, pairing, config, offline/restart, playback, cache, screenshot, and logs. |
| `cms-operator-support.md` | CMS route/operator issues, auth, media, schedule, screens, emergency, chat/notifications, reports/settings. |
| `production-docker-support.md` | Docker-on-VM production role triage and health checks. |
| `runtime-evidence-and-no-secret-review.md` | Evidence collection and no-secret review before sharing logs/screenshots/support bundles. |

## Source References

- Architecture: `docs/architecture/product-architecture.md`
- Contracts: `docs/contracts/README.md`
- Governance: `docs/governance/README.md`
- Environments: `docs/environments/README.md`
- Production deployment: `deploy/production/README.md`
- Implementation map: `docs/implementation/IMPLEMENTATION_TRACEABILITY.md`

## Support Rules

- Do not expose secrets, credentialed URLs, signed URLs, cert PEMs, private keys, tokens, full serials, or raw support bundles without review.
- Do not wipe DB, object storage, player app-data, certs, cache, request queue, or PoP spool unless a runbook explicitly says to and the operator approves.
- Do not mark production ready from a support session.
- If behavior depends on actual player hardware, browser, VM networking, or display drivers, record it as `needs runtime verification` until tested.
