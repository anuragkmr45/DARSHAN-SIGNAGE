# AGENTS.md

## Purpose
This repo is the CMS/operator frontend. Future agents must validate real operator workflows, not only helper utilities.

## Required workflow
1. Trace the feature end-to-end before editing.
2. Inspect the real surface in this order when relevant:
   - page/route
   - modal/component
   - API domain/endpoints/types
   - query keys/hooks/cache behavior
   - existing tests
   - docs/runbooks
3. Edit the smallest correct set of files.
4. If operator workflow changes, update tests and docs in the same change.
5. Do not declare a feature complete until required local validation passes.

## CMS-specific tracing rules
- Trace page -> modal/component -> API domain -> query keys/hooks -> tests.
- When a feature depends on backend realtime or lifecycle state, inspect the backend contract docs first.
- Utility tests are not enough for operator workflow changes.
- Prefer accessible selectors (`aria-label`, visible button text) when adding UI controls so browser tests stay stable.

## Testing policy
Every feature change must include one or more of:
- unit tests for touched hooks/components/utils
- Playwright browser tests for touched operator flows
- docs update if visible workflow or backend contract usage changes

Browser-level coverage is required for `/screens` operator workflow changes.

## Minimum validation before completion
- `npm run build`
- `npm run test:unit`
- `npx playwright test tests/screens.e2e.spec.ts` when screen operator flow changes

## File change guidance
- Keep API types aligned with backend payloads.
- Do not invent frontend-only lifecycle truth when backend already exposes it.
- Prefer cache patching through existing query-key utilities and hooks.
- Remove outdated UI assumptions when backend contracts change.
