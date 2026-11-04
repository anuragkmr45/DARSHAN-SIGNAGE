# Chat member management: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`.

## Product decisions carried forward

- API-key creation and rotation remain unavailable in CMS and at the API until request authentication and scopes are designed. Existing stored records can be listed or revoked. This was implemented and tested in earlier commits on this branch.
- User invitations use a one-time activation code shown once in CMS for manual sharing through an approved channel. No email delivery is claimed. Earlier invitation tests cover expiry, renewal, one-time activation and list redaction.

## Chat member packet

The CMS previously had an unwired remove-member API and no member roster. It also compared `viewer_role` with `ADMIN` although the server returns `CHAT_ADMIN` or `MOD`. The new group/forum Members tab lists active participants for a chat owner, admin, moderator, or global Conversation manager. Named removal is available for closed groups and requires confirmation. Self, owner and system members have no removal control; archived rooms remain read-only. An open forum cannot revoke access by membership removal, so its roster explains why removal is unavailable. A custom global Conversation manager retains access by role grant and cannot be removed as a false revocation. The server checks access again and limits the roster to chat admins. The removal update checks active, non-system, non-owner membership in one SQL statement. There is no owner-transfer action, so owner removal is blocked rather than leaving an ownerless room.

### Developer results

- Server build: passed. The broader `chat.test.ts` route suite then passed 25/25 on the dedicated test database.
- CMS production build and bundle budget: passed.
- CMS unit suite: 277/277 passed.
- Database-backed focused chat route test: passed on the dedicated `darshan_departments_ui_test` database. Ordinary member roster read returned 403; owner read returned minimal identity without a password hash; removal disappeared from a fresh read; owner and system member removal returned 403, an open-forum removal returned 403, and a custom global manager removal returned 409 without removing membership.
- Fixture Chromium browser: 6/6 passed for closed-group member list, self/owner/system protection, confirmed removal, stale server denial, open-forum explanation, 390-pixel member view, and existing phone/desktop navigation. The reviewed [desktop](product-ui-chat-members-desktop-2026-11-04.png) and [phone](product-ui-chat-members-phone-2026-11-04.png) captures contain synthetic identities only.
- Focused CMS ESLint: passed. Focused server ESLint found a pre-existing unused `detachedMediaAssetIds` local in `darshan-server/src/db/repositories/chat.ts` plus existing `any` warnings; no new lint error was introduced in the member-management lines. This remains a lint gate to clean up separately.
- Direct CMS `tsc --noEmit` is blocked before source checking by the existing `tsconfig.json` `ignoreDeprecations` value (`TS5103` with the installed TypeScript). The Vite production build and CMS unit/browser checks passed.

The older `darshan_chat_runtime_test` database lacks the `user_additional_departments` table required by current session validation; that database yielded a 401 before route authorization. The focused case passed on the current dedicated department test database. No production data was used.

The existing isolated CMS at `https://localhost:18445` accepted the private QA administrator credential in a fresh Chromium context, opened `/dashboard`, and navigated to `/chat` without an error banner. The credential stayed in the local process. This instance uses an earlier pinned API build, so it does not validate the new member-roster endpoint or removal UI against a matched runtime.

### Remaining real-application QA

Run independent CMS sessions for owner, chat admin, moderator, ordinary member and removed member against a matched built CMS and API. Keep the removed actor's socket and second tab open, then confirm access withdrawal for REST, socket and attachments, including reconnect and stale permissions. Verify large rosters, archived rooms and cross-department identities in the target deployment. Fixture tests and a route test are developer evidence, not human business sign-off.
