# DARSHAN cloud deployment

This deployment profile belongs to `feature/native-mobile-tv-platform`. It does not replace or merge the air-gapped configuration on `main` or `release-01`.

The zero-cost evaluation layout is:

```text
CMS browser + native Expo players
             |
             | HTTPS / WebSocket
             v
Render Docker web service
  Vite CMS + Fastify API + background worker
       |             |             |
       | PostgreSQL  | RESP/TLS    | S3 API + presigned URLs
       v             v             v
Supabase DB       Upstash Redis   Cloudflare R2 (recommended)
                                  or Supabase Storage
```

One Render service serves the CMS and API from the same origin. This avoids a second frontend service and removes most browser CORS configuration. Media travels directly between browsers/players and object storage using short-lived signed URLs; it does not consume Render's ephemeral disk. The Docker image also contains Playwright Chromium for server-side webpage captures, FFmpeg for compatible video renditions, and LibreOffice/Poppler for document conversion.

## Important suitability limit

This free layout is for development, demos, and acceptance testing. It is not an always-on signage production tier:

- Render Free has 0.1 CPU and 512 MB RAM and sleeps after 15 minutes without inbound HTTP or WebSocket activity. Cold start is approximately one minute. Scheduled jobs and the combined worker stop while it sleeps.
- Chromium, FFmpeg, and LibreOffice jobs are intentionally event-driven. Do not run repeated webpage captures or concurrent conversions on the 512 MB Free instance; a heavy job can exceed its CPU or memory allowance.
- Render's filesystem is ephemeral. This profile keeps authoritative data in Supabase and S3, but an in-progress conversion or backup is lost if the container stops.
- Supabase can pause a low-activity Free project after a seven-day low-activity period.
- Upstash Free is capped by monthly command count. Device heartbeats, sockets, replay protection, and login throttling all consume commands.

Use at least an always-on paid Render instance for a live display fleet. A paid deployment should also split `api` and `worker` roles and use an independent backup account/provider.

## Free-tier choice (checked 2026-10-10)

| Service | Useful free allocation | DARSHAN use |
| --- | --- | --- |
| Render Web Service | 0.1 CPU, 512 MB RAM | CMS, API, combined worker |
| Supabase Free | 500 MB database, 1 GB object storage, 5 GB uncached + 5 GB cached egress | PostgreSQL; optional small object store |
| Upstash Redis Free | 256 MB, 500,000 commands/month, 10 GB bandwidth | TLS Valkey/Redis state, Pub/Sub, throttling |
| Cloudflare R2 | 10 GB-month, 1M Class A and 10M Class B operations/month | Recommended media/documents/log objects |
| Cloudinary Free | 25 pooled monthly credits | Not selected by this profile |

Cloudinary is not a drop-in S3 service: its Upload and Admin APIs require a separate adapter and changes to multipart upload, bucket, backup, and signed-URL behavior. R2 gives this codebase more directly usable free storage with its existing S3 contract. Supabase Storage is now also supported because `S3_ENDPOINT` preserves `/storage/v1/s3`.

Current provider references:

- <https://render.com/docs/free>
- <https://supabase.com/docs/guides/platform/billing-on-supabase>
- <https://supabase.com/docs/guides/platform/free-project-pausing>
- <https://upstash.com/pricing/redis>
- <https://developers.cloudflare.com/r2/pricing/>
- <https://cloudinary.com/documentation/billing_and_plans>

Pricing and limits change; verify these pages before a real rollout.

## 1. Create the managed services

### Supabase PostgreSQL

Create a Free project in a region near the Render service. In **Connect**, copy the shared **session pooler** connection string (port 5432), not the transaction pooler. The app and pg-boss require normal PostgreSQL sessions.

Store the complete `postgresql://...` URL as the Render secret file `database-url`.

### Upstash Redis

Create one Redis database near the other services. Copy the native TCP/TLS URL, which has this form:

```text
rediss://default:PASSWORD@HOST:6379
```

Do not use the REST URL or token. Store the TCP URL as the Render secret file `valkey-url`.

### Object storage: recommended R2

Create an R2 API credential that can create/list buckets and read/write/delete objects. Use:

```text
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
MINIO_REGION=auto
STORAGE_QUOTA_BYTES=8589934592
```

Store the R2 access key and secret as `storage-access-key` and `storage-secret-key` Render secret files.

The bootstrap reconciles these required buckets:

```text
media-source
media-staging
media-ready
media-thumbnails
device-screenshots
logs-audit
logs-system
logs-auth
logs-heartbeats
logs-proof-of-play
archives
```

If the credential cannot create buckets, create all eleven in the provider dashboard before the first deploy. The credential must still support `HeadBucket`, object CRUD, copy, list, and multipart operations.

After Render assigns the service URL, configure CORS on the object buckets used by browser uploads/downloads. Replace the origin below with the exact Render or custom-domain origin:

```json
[
  {
    "AllowedOrigins": ["https://darshan-cloud.onrender.com"],
    "AllowedMethods": ["GET", "HEAD", "PUT", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

### Object storage alternative: Supabase Storage

Enable S3 access in **Storage > Configuration > S3**, generate server-side access keys, and copy the displayed endpoint and region. Current cloud endpoints use this shape:

```text
S3_ENDPOINT=https://PROJECT_REF.storage.supabase.co/storage/v1/s3
MINIO_REGION=PROJECT_REGION
STORAGE_QUOTA_BYTES=943718400
```

The access keys bypass Storage RLS and must only be stored as Render secret files. This option shares Supabase's 1 GB storage and egress quotas, so R2 is usually the better primary media store.

## 2. Create the Render secret environment group

Before creating the Blueprint, open **Environment Groups** in the Render dashboard and create a group named exactly `darshan-cloud-secrets`. Add these as **secret files**, not ordinary environment variables. Enter only the value, with no shell quotes and preferably no trailing blank line. The Blueprint attaches this existing group to the service on its first deployment.

| File name | Contents |
| --- | --- |
| `database-url` | Supabase session-pooler PostgreSQL URL |
| `jwt-secret` | Random application secret of at least 32 characters |
| `storage-access-key` | R2 or Supabase S3 access-key ID |
| `storage-secret-key` | R2 or Supabase S3 secret key |
| `valkey-url` | Upstash native `rediss://` URL |
| `bootstrap-admin-password` | One-time strong initial administrator password |

The Docker runtime user is added to Render's secret-file group (`1000`). Production code rejects direct secret environment variables, world-readable files, plaintext Redis, and unverified database TLS. Do not deploy the Blueprint until this group and all six files exist.

## 3. Deploy the Blueprint

Create a Render Blueprint from the repository's `render.yaml`. It is pinned to `feature/native-mobile-tv-platform`; do not change it to `main` or `release-01`.

Render prompts for these `sync: false` values:

| Variable | R2 example |
| --- | --- |
| `S3_ENDPOINT` | `https://ACCOUNT_ID.r2.cloudflarestorage.com` |
| `MINIO_REGION` | `auto` |
| `STORAGE_QUOTA_BYTES` | `8589934592` |
| `BACKUP_OFFHOST_DESTINATION` | `s3://archives/darshan-cloud-backups` |
| `CLOUD_BOOTSTRAP_ADMIN_EMAIL` | Initial SUPER_ADMIN email |

The startup sequence applies checksum-verified migrations, performs the idempotent administrator/storage bootstrap when the password file is present, and then starts the API and worker. A legacy or partially populated database is deliberately rejected instead of silently adopted.

After the first successful bootstrap:

1. Sign in and confirm `/api/v1/health/ready` returns HTTP 200.
2. Delete the `bootstrap-admin-password` secret file from the `darshan-cloud-secrets` environment group.
3. Redeploy once and confirm readiness again. Startup will skip administrator bootstrap while retaining the recorded bootstrap state.

The entrypoint derives the public origin from Render's `RENDER_EXTERNAL_HOSTNAME`, so CMS API calls, cookies, CORS, and Socket.IO use the same HTTPS origin. `MINIO_PUBLIC_ENDPOINT` and backup credentials default to the selected S3 endpoint/credentials for the free evaluation layout.

For production backups, override all of the following with a separate S3 account or provider instead of accepting those aliases:

```text
BACKUP_OFFHOST_ENDPOINT
BACKUP_OFFHOST_REGION
BACKUP_OFFHOST_ACCESS_KEY_FILE
BACKUP_OFFHOST_SECRET_KEY_FILE
BACKUP_OFFHOST_DESTINATION
```

## 4. Verify end to end

Run these checks after deployment:

```text
GET https://YOUR_HOST/api/v1/health/live
GET https://YOUR_HOST/api/v1/health/ready
GET https://YOUR_HOST/config/app-config.json
```

Expected readiness checks are `database`, `migrations`, `bootstrap`, `minio`, `valkey`, and `worker`, all `ok` (or explicitly `not_required`). Then:

1. Sign in to `https://YOUR_HOST/`.
2. Upload a small image and confirm its preview loads directly from object storage.
3. In the native Expo handheld/TV app, enter `https://YOUR_HOST` on the pairing screen.
4. Approve the pairing in CMS and verify snapshot download, Socket.IO connectivity, and playback.

If browser upload fails but server readiness is healthy, inspect object-storage CORS first. If the app cold-starts repeatedly or scheduled work stops, that is a Render Free lifecycle limitation rather than an APK pairing issue.
