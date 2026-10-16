# Production database lifecycle

Production deployment must never use `npm run db:push` or `npm run seed`.
`db:push` is a schema synchronizer intended for local development; it has no
immutable history or release checksum. The demo seed creates sample data and
does not reset an existing administrator password. Neither is safe as a
production lifecycle boundary.

The released backend image instead provides three explicit operations:

```bash
npm run db:status -- --json
npm run db:migrate -- --release-id <release-id> --json
npm run bootstrap:production -- --email <admin-email> --release-id <release-id> --password-file /run/darshan-bootstrap/admin-password --json
```

`db:migrate` locks the database, verifies migration checksums, and records
the release in `darshan_schema_migrations`. A genuinely empty database receives
the checked-in production baseline, then any later incremental migrations.

`bootstrap:production` runs only after migrations. On an empty application
database it creates the system roles, a single active `SUPER_ADMIN`, and the
required emergency state. A later execution is idempotent and never resets the
administrator password. The password file must be a regular mode-0600 file;
it is not an environment variable or command-line argument.

## Existing deployments

An application database without a migration ledger is deliberately rejected by
`db:migrate`. First run `db:status -- --json`, review both reported
fingerprints and the live schema/backup, then perform the approved adoption:

```bash
npm run db:adopt -- \
  --release-id <release-id> \
  --ticket <approved-change-ticket> \
  --manifest-fingerprint <from-plan> \
  --database-fingerprint <from-plan> \
  --json
```

The current adoption cutoff covers the reviewed legacy history through display
authority. New bootstrap and ledger migrations remain pending and must then be
applied with `db:migrate`. After that, record the already-existing active
`SUPER_ADMIN` as the bootstrap authority; this preserves its password, role,
sessions, and all application data:

```bash
npm run bootstrap:adopt-existing -- \
  --email admin@example.local \
  --release-id <release-id> \
  --ticket <approved-change-ticket> \
  --json
```

The generated `adopt-existing.sh` performs these ordered steps only after a
restore-verified off-host backup manifest is supplied. It refuses an inactive,
non-super-admin, missing, or case-normalization-ambiguous account. A legacy
adoption is not ready for production traffic until both the migration ledger
and this bootstrap authority record exist.

## Release migrations `0044` and `0045`

The document-page and stable-ownership release requires these migrations in
order:

1. `0044_document_page_selection.sql` adds occurrence-level document page
   selection and final-PDF page-count state.
2. `0045_deleted_user_content_ownership.sql` adds user tombstones and stable
   ownership to Media, Layouts, Presentations, and Schedules.

Before applying them, stop application writers and take the approved
restore-verified database/object-metadata backup. On an isolated copy of the
real legacy shape, inspect the plan and then migrate with the release image:

```bash
npm run db:status -- --json
npm run db:migrate -- --release-id <release-id> --json
npm run db:status -- --json
```

Do not start the new API or worker until the final status reports no pending
migration. Verify that `0045` appears once in the ledger, all four owned tables
contain only valid scope/department combinations, ownership indexes and
restrictive department foreign keys exist, and creator references still resolve
after a synthetic user tombstone.

Migration `0045` can only derive a legacy row's department from the creator's
department at migration time. It cannot reconstruct a department transfer that
was never stored. Review transferred/no-department/missing-creator rows during
the rehearsal; unsafe or unknowable mappings must remain `RESTRICTED` or be
corrected by an approved forward migration.

The migration runner is transactional. If it fails or is interrupted, inspect
both the ledger and schema before retrying. Never manually add its ledger row.
Retry only after proving the transaction rolled back, otherwise ship a reviewed
forward-fix migration.

Automatic database downgrade is unsupported. The additive columns may remain
during an application rollback, but an older server that physically deletes
users must not be started after `0045` unless `DELETE /api/v1/users/*` is
blocked at the gateway and user-deletion controls are disabled. The detailed
data/API contract is in
`darshan-server/docs/deleted-user-content-ownership.md`.

## Administrator recovery

Do not rerun the demo seed to recover production access. Inspect first, then
use a protected password file and approved ticket:

```bash
npm run admin-cli -- inspect -e admin@example.local --json
npm run admin-cli -- recover \
  -e admin@example.local \
  --password-file /run/secrets/recovery-password \
  --ticket INC-1234 \
  --json
```

Recovery revokes active sessions and emits audit/system log entries. It does
not reactivate an account or change its role unless those are explicitly
requested.

Run recovery/deactivation with backend instances stopped. If an approved
emergency procedure requires the CLI while the API is live, restart every
backend instance immediately after the command before restoring client access.
The CLI transaction revokes REST/reconnect sessions, but an out-of-process CLI
cannot directly disconnect Socket.IO connections held in another running API
process.

For a manual break-glass session on the backend VM, `recover` and
`create-admin` may use `--prompt-password` instead of `--password-file`; the
CLI requires an interactive non-echoing TTY and refuses ambiguous input such as
both password sources. Generated production wrappers continue to use protected
files so passwords never appear in process arguments, shell history, or
generated release archives.

The older `migration:plan`, `migration:apply`, and `migration:adopt` scripts are
kept as compatibility aliases, but production runbooks and generated bundles use
the `db:*` names.
