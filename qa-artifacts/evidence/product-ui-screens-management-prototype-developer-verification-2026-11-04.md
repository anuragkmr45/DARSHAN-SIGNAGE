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
- The refreshed Screens captures at 390, 820, and 1440 CSS pixels are in `product-ui-core-prototypes/`.
- `npx playwright test tests/screens.e2e.spec.ts`: **14/14 passed**, one Chromium worker. The cases use route fixtures.
- `npm run test:unit`: **42 files, 271/271 passed**.
- `npm run build`: passed, including the CMS bundle-budget gate. Focused ESLint on the six changed CMS files passed.
- TypeScript application check with the installed TypeScript 5.9 override (`npx tsc -p tsconfig.app.json --noEmit --ignoreDeprecations 5.0`) still reports **127 repository baseline errors**, with none in this packet's touched files. The default project setting `ignoreDeprecations: "6.0"` is incompatible with the installed compiler.

## Still required

- Real-service role withdrawal, Group pagination with production-sized data, and actual pairing/recovery through the CMS and player.
- The Create/Edit Group membership pickers still fetch only the first 100 Screens and Groups. A large-fleet membership picker and its server contract need a separate correction before that workflow can be accepted for production-sized data.
- Server-side fleet health filtering before a status filter can be offered for a paginated list.
