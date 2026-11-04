# Product UI Layout editor: real-service developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This is developer evidence, not release or independent human QA approval.

## Operator task and correction

An operator creates or edits a Layout, retains unsaved work when navigating away accidentally, and sees the saved Layout immediately on return to the list. Before this packet, clicking the Screens sidebar link from a dirty editor discarded the draft without a warning. A successful save could also return to a cached pre-save list for up to the 60-second query stale period. The edit form was available before an existing Layout finished loading, including after a failed read.

The CMS now uses a data router so the editor can block internal navigation. Sidebar navigation and browser Back offer Stay or Leave; hard reload retains the browser's before-unload warning. A successful save bypasses the blocker and invalidates all Layout list queries. Existing Layouts show a loading state, then either the hydrated editor or an explicit failure/retry state.

## Running-app evidence

- Signed in through the isolated local QA CMS at `https://localhost:18445/login` with the ignored private QA administrator credential. Dashboard loaded, showing one registered and online screen. No browser page error was recorded. Grafana was unavailable in this isolated stack; that is a separate environment finding.
- Against the prior running CMS build, entered a new Layout name and clicked the Screens sidebar link. The route changed to `/screens` with no unsaved-change prompt, reproducing the data-loss case.
- Served the updated production CMS bundle in a real browser at the same isolated origin while leaving `/api/v1` requests on the running backend. Created a uniquely named QA Layout with one slot, tried the Screens link, chose Stay, saved, saw the Layout immediately in the list, reopened it with the name and one slot, then deleted it through the exact-name confirmation. No page errors occurred. The temporary QA record was removed.
- This validates the updated browser code with the real isolated authentication, Layout REST and database path. It does not validate a rebuilt deployment image, player output, production VMs, or another operator role.

## Automated checks

- `npm run build` and bundle budget passed. Entry JavaScript: 212.4 KiB, 67.5 KiB gzip.
- `npm run test:unit`: 44 files, 277 tests passed.
- Focused ESLint on App, LayoutEditor and the browser suite passed; `git diff --check` passed.
- `npx playwright test tests/layout-editor.e2e.spec.ts tests/layouts-list-ui.e2e.spec.ts tests/entry-auth.e2e.spec.ts`: 13/13 passed with one browser worker; a subsequent focused logout-from-dirty-editor case passed 1/1. The new cases cover sidebar Stay/Leave, browser Back, saved-list refresh, failed edit read and retry. Existing geometry cases cover touch, mouse, keyboard, undo/redo and canvas fit at 390/820/1440 CSS pixels.
- The updated bundle opened all 16 principal sidebar routes against the isolated backend with no browser page errors. This is a navigation smoke check, not an action-by-action pass on those pages.
- An explicit CMS TypeScript check with the deprecated-config override still reports 116 existing project diagnostics; none are in App or LayoutEditor after replacing the editor's obsolete React Query `keepPreviousData` option with `placeholderData`.

## Remaining verification

- A failed or timed-out save must retain the draft, and a stale concurrent edit needs an agreed conflict outcome. Verify permission withdrawal during an edit.
- Check hard refresh, physical touch and portrait layouts, keyboard focus, text zoom, both themes, accents and reduced motion on representative devices.
- Confirm authored geometry in a published presentation on packaged Ubuntu and Windows players, including a physical display.
- Exercise the rebuilt deployment image and the multi-VM environment before release; the isolated service run cannot stand in for those gates.
