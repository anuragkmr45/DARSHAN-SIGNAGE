# D3 MinIO file-credential capability — 2026-10-30

Status: bounded development capability observation passed. This is not source-service, TLS, materialization, migration, seed, backup, restore or application acceptance.

The probe used the exact enrolled image:

`sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`

It created one fixed-name, development-labelled MinIO container on one fixed-name internal Docker bridge. There were no published ports. The container used numeric user/group `1000:1000`, a read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, 256 MiB memory, 0.25 CPU, 64 PIDs, tmpfs-only `/tmp` and `/data`, and protected read-only bind files for `MINIO_ROOT_USER_FILE` and `MINIO_ROOT_PASSWORD_FILE`. No source volume, repository, retained age key or application secret was mounted.

The MinIO binary was invoked directly. A host-side AWS S3 client reached the container only through its private bridge address. The public results were:

- correct credentials read by MinIO from the two files: `ListBuckets` succeeded;
- the same access key with a wrong secret: rejected with HTTP 403;
- an unauthenticated HTTP request: rejected with HTTP 403;
- container state after the checks: running, not OOM-killed, and no runtime error.

The exact probe container was stopped and removed with its anonymous volumes, the exact probe network was removed, and its temporary credential files and directory were removed. A follow-up lookup found no container or network under the probe names and no matching temporary directory.

The first attempt failed before any Docker effect because the installed OpenSSL `rand` command required a different argument order. That attempt left one exact temporary access-key file because its cleanup trap had not yet been registered. The file and its enclosing exact temporary directory were inspected, then explicitly unlinked/removed. No credential value was printed or retained.

Conclusion: this MinIO image's binary accepts the enrolled absolute `_FILE` credential environment variables and enforces credential rejection in this isolated HTTP capability probe. This does not prove the later certificate-bound source configuration, volume materialization, provider composition, cgroup admission or real positive/negative TLS health probes. Source, D2 and whole-run activation remain disabled.
