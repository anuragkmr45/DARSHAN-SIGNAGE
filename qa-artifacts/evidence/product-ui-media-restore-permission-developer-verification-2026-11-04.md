# Media restore permission alignment: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This is a functional correction discovered while tracing Media Library before its interface redesign.

## Finding and correction

The CMS already shows Deleted Media when the current user has effective `manage Media` permission. The server additionally required the literal role name `ADMIN` or `SUPER_ADMIN`, so an authorized custom-role user saw the control but received 403 from both the deleted list and restore action. The server now uses current effective `manage Media` permission for both endpoints. The existing owner, object-existence, webpage-retirement, and audit behavior remains in place.

## Verification

- Server TypeScript build passed.
- A newly migrated dedicated `darshan_media_restore_20261104_test` PostgreSQL database received 64 migrations. This test database was separate from the running application database.
- New route test: a custom role with `manage Media` listed and restored a deleted item; a role without the permission received 403 for both endpoints.
- Full `src/routes/media.test.ts`: **21/21 passed** against that test database.
- Contract updated in `docs/contracts/media-delete-contract.md`.

## Remaining QA

Run the same journey through the real CMS with a custom-role account and a recoverable Media object, then confirm the restored item appears in the normal library and its preview works. Verify role grant removal while a session is open and audit entries on the deployed stack.
