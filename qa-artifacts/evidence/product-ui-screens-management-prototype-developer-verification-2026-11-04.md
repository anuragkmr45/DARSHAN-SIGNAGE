# Screens management prototype: developer verification

Status: developer verification on the redesign branch; not human QA or real-service acceptance.

## Contract and interface

- Primary task: identify an unhealthy Screen, inspect it, and pair a device when authorized.
- Secondary tasks: manage Screen Groups and review current or historic pairing codes through labeled disclosures.
- Server authority: the CMS queries paginated Screen and Screen Group summaries. The API decides mutation permissions and deletion blockers. The CMS hides entry points using the exact server-evaluated capability pairs.
- Safety: recovery and pairing findings remain in the main flow. The existing Screen detail inspector, deletion confirmations, and server blocker handling remain in use.

## Developer results

- Browser tests cover one Pair Device entry point, collapsed secondary sections, active-code count, Group pages 1 and 2, Screen pages 1 and 2, a restricted custom-role action set, an orphan finding without a Revoke action, and no horizontal overflow when both management sections are open at 390 CSS pixels.
- A loading race was found in both Screen and Group page correction: missing query data temporarily made the page count 1. The correction now runs only when a response exists.
- The Edit Group dialog called an API method that did not exist. The client now calls the server's Group detail endpoint; the browser test waits for the actual Group name. A failed detail load shows Retry and disables Save. Clearing the final member sends `screen_ids: []`, which the server interprets as removing all members.
- Create/Edit Group now search and page through the server's available-Screens endpoint, retaining selections when the user searches or changes page. The query includes current members during Edit, including legacy overlapping membership. The server uses SQL filtering/counting and an index on membership Screen ID. A failed member-list load blocks Save until Retry succeeds. A create-only role can make an empty Group without making a forbidden read request.
- Group-picker verification: `npx playwright test tests/screens.e2e.spec.ts` **17/17 passed** with one Chromium worker, including selection beyond the first 100, cross-page selection, a failed load/retry, overlapping current membership, and create-only permission. After the edit-dialog stale-refetch safeguard, its three affected browser cases passed again **3/3**. `src/routes/screen-groups.test.ts` **2/2 passed** against a fresh dedicated `darshan_group_picker_test_20261104` PostgreSQL database with 105 Screens. Server TypeScript build passed. The CMS unit suite passed **42 files, 271/271**. The final CMS build and bundle budget and focused ESLint passed. The CMS project TypeScript check still reports **126 pre-existing errors**, none in the files touched by this correction.
- The refreshed Screens captures at 390, 820, and 1440 CSS pixels are in `product-ui-core-prototypes/`.
- `npx playwright test tests/screens.e2e.spec.ts`: **14/14 passed**, one Chromium worker. The cases use route fixtures.
- `npm run test:unit`: **42 files, 271/271 passed**.
- `npm run build`: passed, including the CMS bundle-budget gate. Focused ESLint on the six changed CMS files passed.
- TypeScript application check with the installed TypeScript 5.9 override (`npx tsc -p tsconfig.app.json --noEmit --ignoreDeprecations 5.0`) reported **126 repository baseline errors** on the Group-picker correction, with none in its touched files. The default project setting `ignoreDeprecations: "6.0"` is incompatible with the installed compiler.

## Still required

- Real-service role withdrawal, Group pagination with production-sized data, and actual pairing/recovery through the CMS and player.
- A real-service Group Create/Edit journey with production-sized data is still required; the browser cases above use route fixtures and the route test uses a dedicated test database. The picker does not enforce exclusive Group membership at mutation time; the server's existing membership-write contract remains authoritative.
- Server-side fleet health filtering before a status filter can be offered for a paginated list.
