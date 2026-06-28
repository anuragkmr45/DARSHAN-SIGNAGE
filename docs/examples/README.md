# DARSHAN Config Examples

Last code-truth refresh: 2026-06-28.

These files are non-secret examples for DARSHAN backend, CMS, and player runtime configuration. They are examples only; they do not prove a site is deployed or healthy.

## Source Of Truth

| Runtime | Loader / contract source | Example files |
|---|---|---|
| Backend JSON config | `darshan-server/src/config/file-config.ts` | `backend-config.*.example.json`, `onprem-*-config-set/backend-config.example.json` |
| CMS browser runtime config | `darshan-cms/src/config/runtimeConfig.ts` | `cms-runtime-config.*.example.json`, `onprem-*-config-set/cms-runtime-config.example.json` |
| Player site config | `darshan-player/src/common/file-config.ts` | `player-config.*.example.json`, `onprem-*-config-set/player-config.example.json` |
| Profile-set validation | `scripts/verify/validate-onprem-config-examples.sh` | `onprem-dev-config-set`, `onprem-qa-config-set`, `onprem-prod-config-set` |

## File Types

| Type | Purpose |
|---|---|
| Standalone examples | Single backend/CMS/player examples for local, QA, or production-style references. |
| `onprem-*-config-set/` bundles | Matched backend, CMS, player, and secrets-template examples for one profile. |
| `secrets.env.example` | Placeholder-only secret names. Replace locally; never commit filled values. |
| `onprem-local-192.168.0.5.config.example.yaml` | Legacy/inventory-style local profile. JSON files are the directly loadable CONFIG-1/2/3 examples. |

## Docker Production Placement

For Docker-on-VM production, do not copy every file to every VM.

| Target | Example source | Runtime destination |
|---|---|---|
| Backend VM | `backend-config.example.json` | `darshan-server/config/backend.json`, mounted in container as `/app/config/backend.json` |
| CMS VM | `cms-runtime-config.example.json` | `darshan-cms/public/config/app-config.json`, served as `/config/app-config.json` |
| Player device | `player-config.example.json` | `/etc/darshan/player/config.json`, selected by `DARSHAN_PLAYER_CONFIG_FILE` |
| Backend VM secrets | `secrets.env.example` | local secret store or `darshan-server/.env` after replacing placeholders |

For Docker backend, set:

```env
DARSHAN_CONFIG_FILE=/app/config/backend.json
```

Direct-host installs may use `/etc/darshan/server/config.json`, but that is not the Docker production backend path.

## Secret Boundary

Keep secrets and sensitive URLs out of JSON config examples:

- database URLs with real passwords
- JWT/admin passwords
- MinIO access/secret keys
- Valkey URLs with real auth
- private keys, PEM blocks, cert private material
- tokens, bearer credentials, signed URLs

CMS runtime config is browser-visible. Never put secrets in it.

Player site config is non-secret deployment config. Device identity, certificates, pairing state, proof-of-play queues, request queues, media cache, and logs remain runtime state.

Current source supports the `player.security` section shown in player examples. Older installed player packages can reject that section until the package is upgraded, so validate the installed package with `darshan-player doctor` or the config validator before deploying the profile.

## Validation

Run:

```bash
bash scripts/verify/validate-onprem-config-examples.sh
```

The validator checks JSON parsing, placeholder-only secrets templates, obvious secret leakage, credentialed URLs, and compatibility with the current backend/player/CMS config loaders.
