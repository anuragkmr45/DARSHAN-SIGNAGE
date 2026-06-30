# CMS Operator Support

Last code-truth refresh: 2026-06-28.

## Source References

| Area | Code/source |
|---|---|
| Route tree | `darshan-cms/src/App.tsx` |
| Auth guard | `darshan-cms/src/components/auth/ProtectedRoute.tsx` |
| API client | `darshan-cms/src/api/apiClient.ts`, `src/api/domains/*` |
| Runtime config | `darshan-cms/src/config/runtimeConfig.ts`, `public/config/app-config.example.json` |
| Realtime hooks | `src/hooks/screens/useScreensRealtime.ts`, chat/notification socket libs |
| Backend APIs | `darshan-server/src/server/index.ts`, `darshan-server/src/routes/*` |

## Login/Auth Issues

1. Confirm CMS origin can reach backend or nginx `/api/v1` proxy.
2. Confirm backend `/api/v1/health` is reachable.
3. Confirm auth route errors are not CORS/CSRF/cookie issues.
4. Check user role/permission state in CMS only through supported admin UI or backend APIs.

Do not change auth/session behavior from support. Escalate if JWT/session refresh behavior appears broken.

## Route-Level Triage

| Route area | Primary dependencies |
|---|---|
| `/dashboard` | screen/media/schedule/report/metrics APIs |
| `/media` | media list/upload/finalize/delete, object storage reachability |
| `/layouts`, `/schedule` | layouts, presentations, media, screens, schedule APIs |
| `/screens` | screen overview/detail, pairing, telemetry, screenshots, delivery status |
| `/requests` | requests/emergency APIs |
| `/notifications`, `/chat*`, `/conversations*` | notification/chat APIs and browser sockets |
| `/settings` | settings, default media, backups, roles/permissions |
| `/reports`, `/proof-of-play` | reports, proof-of-play, audit/evidence APIs |
| `/api-keys`, `/webhooks`, `/sso-config` | admin integration APIs and permissions |

If a route loads but data is stale, first check the relevant API domain file under `darshan-cms/src/api/domains/*` and the backend route under `darshan-server/src/routes/*`.

## Runtime Config Issues

Production CMS should receive browser-visible runtime config from:

```bash
/config/app-config.json
```

Source file in the repo before deployment:

```bash
darshan-cms/public/config/app-config.json
```

Do not put secrets in CMS env or runtime config. Both are browser-visible.

## Media Support

Upload/manage media issues usually involve:

- CMS media page and media API domain,
- backend media routes,
- MinIO/S3 reachability,
- backend runtime tools for media processing.

Media does not move over Socket.IO.

## Schedule And Default Media Support

If a schedule or default media assignment does not show on a player:

1. Confirm CMS mutation succeeds.
2. Confirm backend state reflects the assignment.
3. Confirm desired-state/command refresh is created when expected.
4. Confirm player is online and paired.
5. Confirm Socket.IO wake-up or polling fallback.

Do not create random test screens to debug a real screen issue unless explicitly approved.

## Emergency/Requests Support

Emergency/takeover controls are operationally sensitive. Verify action target, scope, and expiry before applying. If behavior is unclear, pause and escalate with backend request ID, screen ID redacted as needed, and timestamp.

## No-Secret Rule

Before sharing browser screenshots, network payloads, console output, or support bundles, review for tokens, cookies, credentialed URLs, signed URLs, private material, and full serials.
