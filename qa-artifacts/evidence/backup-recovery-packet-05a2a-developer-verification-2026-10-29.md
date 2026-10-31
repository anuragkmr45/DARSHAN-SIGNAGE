# Backup recovery Packet 05A2a developer verification — 2026-10-29

## Scope and safety boundary

Implemented the operator-only recovery `discover` and `plan` preflight. No application stack, Docker service, database, S3 client, broker command, restore hold, target provisioning, decryption, import, mutation, or promotion was started. Test fixtures used disposable temporary directories. The only production behavior capable of writing is an explicit, exclusive reviewed plan output.

Packet 5A1 remains versioned as-is. Packet 5A2a introduces `darshan-recovery-plan-v2`; it does not reinterpret v1 journals or plans.

## Implemented evidence

- Canonical protected operator config (64 KiB) and retained public Ed25519 keyrings (1 MiB each), with bounded descriptor reads, growth sentinel, stable fd/path identity, exact uid/gid and `0600`, single-link and no-symlink policy, duplicate-key rejection, strict schemas, and no secret/URL fields.
- A guaranteed read-only broker journal snapshot accessor that requires existing `0700`/`0600` paths, reuses the strict journal parser, revalidates the directory after parsing, and does no mkdir, repair, lock, authority, or journal mutation.
- Bounded deterministic committed-publication candidate pages with exact run cursor, conservative lifecycle classification, and no latest/eligibility claim.
- Exact run UUID + signed manifest digest planning through retained trust verification and compatibility assessment; tombstone/deletion/conflict/legacy/changed sources fail closed.
- Release-owned target validation binds `darshan-server-release-01`, `release-01`, terminal migration `0055_backup_deletion_idempotency_bindings.sql`, and migration-manifest digest `fb7b1204029c2a4a3fac754845fff3723732ae8b0de6df54a5460c41b9a3f167`.
- Exclusive `0600` canonical plan output with file and parent fsync, no overwrite, stable pathname identity, bounded re-read, and exact digest verification.
- Import-safe development/production CLI with only `discover` and `plan`, a bounded versioned JSON envelope, deterministic exit categories, path/cause/stack/key redaction, and exactly one JSON stdout value.

## Defects observed and fixed

1. The existing broker `inspect/query/load` path called `directory()` and could create `broker-journal`. A separate accessor now bypasses that path and fails if protected state is absent.
2. Initial snapshot logic revalidated the state file but not its parent after parsing. Final device/inode/uid/gid/mode/canonical directory revalidation and a parent-swap regression were added.
3. The 5A1 plan did not bind attempt/capture/generation or release-owned target metadata. v2 now binds the complete publication tuple and immutable target manifest identity while preserving v1.
4. The first CLI result shape was insufficiently explicit and included the output path. It now uses `darshan-recovery-cli-result-v1`, fixed status/code/retryable fields, safe category messages, and path-free plan summaries.
5. The first v2 parser allowed syntactically valid uppercase UUIDs/offset timestamps and self-consistent but arbitrary target metadata. It now requires lowercase UUIDs, canonical UTC `Z` timestamps, and every compiled release-target field.

## Independent review correction

The first independent ultra review reproduced three P2 defects and one P3 CLI defect. The correction is bounded to 5A2a:

1. **Parent escape during plan create:** creation formerly reopened the original output pathname after validating/opening its parent. It now validates a strict basename and creates/reads through `/proc/self/fd/<opened-parent-fd>/<basename>`. A regression renames the parent and replaces the original pathname with a symlink before `O_CREAT`; no plan appears in the replacement/outside directory, the command fails stably, and the anchored inode remains only in the originally opened directory. Failure cleanup no longer uses an unsafe `lstat`-then-`unlink` sequence; because Node 20 has no unlinkat-by-directory-fd primitive, an exclusively created inode is preserved on any uncertain failure.
2. **Plan success without content/mode proof:** successful writes now perform bounded expected-size-plus-one descriptor readback before and after parent fsync. Requested bytes, actual digest, dev/inode/link/size/uid/gid/exact `0600`, mtime/ctime stability, anchored entry, and original pathname identity must all match. Regressions mutate the first byte or chmod to `0644` after a real file fsync and both fail without reporting success. The returned digest is from verified bytes.
3. **Broker journal map aliases:** the canonical parser now requires publication/tombstone keys to equal run IDs and hold/deletion/staging-cleanup keys to equal operation IDs, rejecting case-variant duplicate semantic UUIDs. Discovery pagination and exact selection call the same invariant before consuming state. Canonical parser, pagination, and exact-selection alias regressions were added while normal broker protocol coverage remains green.
4. **CLI help/input classification:** help is accepted only as a sole top-level argument. `--json --help` is deterministically rejected in one versioned JSON envelope, and malformed UUID/digest/limit values map to the input exit category.
5. **Descriptor coherence:** a shared v2 source identity/digest helper is used by trusted selection, the plan builder, and parser. Changing a publication tuple field while retaining the old descriptor digest is rejected; `repositoryDescriptorSha256` remains opaque because mount/owner fields are intentionally excluded from the reviewed plan.
6. **Canonical broker UUID identity:** residual re-review found that installed Zod `uuid()` accepted uppercase and non-RFC version/variant forms. The journal now uses the same exact lowercase version-1–8/variant-8/9/a/b pattern as recovery IDs for every UUID map key and publication/lifecycle reference. The storage parser and pre-discovery assertion reject uppercase singletons, lowercase-publication/uppercase-tombstone bypasses, uppercase hold/deletion references and operation keys, case-duplicate pagination, nil UUIDs, version 0/9, and invalid variants.

## Verification results

Final serial validation from `darshan-server`:

- Final focused and affected-broker Vitest command covering recovery inputs, canonical broker snapshot/parser/protocol and UUID invariants, discovery, v1/v2 planning, durable plan file, full signed-source preflight, CLI, import isolation, production package, and retained trust/retention regression: **14 files passed, 106 tests passed**.
- `npx tsc --noEmit -p tsconfig.json`: **passed**.
- `npx tsc --noEmit -p tsconfig.scripts.json`: **passed**.
- Strict changed-file ESLint (`--max-warnings=0`): **passed**.
- `npm run build`: **passed**.
- `npm run build:production`: **passed** after waiting for both production compiler passes to complete.
- `node scripts/verify-recovery-native-import.mjs`: **passed**, output `recovery-native-import-ok`; this covers native imports plus built CLI `--help` and missing-config JSON with database/S3 environment absent.
- `git diff --check`: **passed**.

An initial native smoke invocation was attempted before the asynchronously yielded production build had finished its second compiler pass and correctly failed because `dist-cli` did not yet exist. The build was rerun and explicitly awaited to exit code 0; the subsequent native smoke passed. This was a verification orchestration issue, not a product-code defect.

No live restore was attempted.

## Explicitly pending (5A2b/5A2c1/5A2c2/5B)

- Broker-mediated durable restore-hold acquire/release/uncertain lifecycle.
- Dedicated recovery V2 wrapper/runtime packaging and deployment/compose surface.
- Durable recovery operation resume/restart and stale-lock/operator procedures.
- Release-owned isolated target provisioning, decrypt/import/reconciliation, post-import verification, and promotion/rollback.
- Live disaster-recovery drill evidence. This packet is not live-restore evidence.
