# CMS-Origin Object Storage Gateway

Browser uploads and operator previews use signed URLs whose origin is the CMS
public origin, never the internal MinIO address. Set `MINIO_PUBLIC_ENDPOINT` to
that exact origin, including a non-default port when one is used.

CMS Nginx proxies only the approved path-style buckets to MinIO. It preserves
the request path, query string, and `Host` header, because they are covered by
AWS SigV4. It disables proxy buffering for uploads and gateway access logging
so signed query strings are not recorded. The proxy accepts only `GET`, `HEAD`,
and `PUT`; signed URL expiry and method binding remain the authorization layer.

Player/device endpoints explicitly request the `device` URL audience and retain
their device-accessible object endpoint. CMS/operator API paths use the `cms`
audience. A deployment must not make MinIO's API port browser reachable as an
alternative path.

Enforce that boundary in the network as well as in the application: expose the
CMS HTTPS origin to operator workstations, but permit the Data VM's MinIO API
port only from the Backend VM and the approved player network segments. Do not
allow the operator/workstation subnet to reach port `9000`. The MinIO console
port is administration-only and must have a separate, tightly restricted rule.

For all uploads, the browser receives an upload-session URL for
`media-staging`. The backend validates exact size and a streamed SHA-256,
copies the result to its immutable `media-source` key, then finalizes the media
record. Staging objects are not exposed as ready media and expiry cleanup aborts
unfinished multipart uploads before removing their staged objects.
