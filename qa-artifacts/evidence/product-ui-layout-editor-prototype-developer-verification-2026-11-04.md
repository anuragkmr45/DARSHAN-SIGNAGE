# Product UI Layout editor prototype: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: prototype developer verification. This does not approve the Layout workflow for release.

## Task and behavior

An operator enters a name and aspect ratio, adds or draws slots, adjusts their positions and sizes, and saves normalized coordinates through the existing Layout API. The editor now fits the canvas on a phone, offers Select and Draw modes, local zoom and geometry undo/redo, numeric controls, and a selectable slot list. The server remains authoritative for saving and authorization.

## Evidence

- `darshan-cms/src/lib/layoutEditorGeometry.test.ts`: ratio fallback, unique slot ID after deletion, non-overlapping placement, bounds, decimal snap midpoint, and draw threshold.
- `darshan-cms/tests/layout-editor.e2e.spec.ts`: signed-in fixture-backed CMS browser journeys for phone-width numeric editing and save payload, browser touch drawing, keyboard nudge, mouse move/resize, undo/redo, deletion recovery, and ID reuse. Canvas-fit checks at 390, 820, and 1440 CSS pixels.
- Rendered captures: [phone 390](product-ui-layout-editor/phone-390.png) and [desktop 1440](product-ui-layout-editor/desktop-1440.png).
- `npm run build` including the bundle budget: passed on 2026-11-04. Entry JavaScript was 220.2 KiB (69.7 KiB gzip).
- `npm run test:unit`: 42 files and 271 tests passed.
- `npx playwright test tests/layout-editor.e2e.spec.ts`: 3 browser journeys passed with one worker.
- Focused ESLint for the edited CMS files and `git diff --check`: passed without warnings.

The browser routes in these tests return fixtures. They do not prove a real database save, player presentation, permissions, or interrupted-session recovery.

Follow-up: [the real-service developer verification](product-ui-layout-editor-real-service-developer-verification-2026-11-04.md) records a later packet that added internal navigation protection and completed an isolated backend create/list/reopen/delete journey. The remaining items below describe the original prototype boundary; use the follow-up for current status.

## Remaining QA

- Save and reopen a Layout against isolated real services; compare database geometry and authored preview.
- Verify touch and numeric editing on a physical phone or tablet, including portrait and mobile keyboard behavior.
- Exercise browser back, sidebar navigation, refresh, failed save, stale edit, and permission withdrawal with unsaved changes. The current Cancel and refresh warnings do not cover every internal navigation.
- Confirm edited Layout geometry through presentation publishing and the packaged Ubuntu and Windows player.
- Review both themes, five accents, text zoom, reduced motion, focus order, 390/820/1440 boundaries, and nontechnical operator comprehension.
