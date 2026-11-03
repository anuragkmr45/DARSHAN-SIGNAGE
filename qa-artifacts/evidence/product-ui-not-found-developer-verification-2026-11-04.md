# Unknown route: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

The authenticated unknown-route page stays in the CMS shell, follows the active theme, explains that the address may have changed, and offers Open Dashboard only when the user may read Dashboard. The old standalone gray 404 screen and route-path console error were removed.

The admin browser suite passed **4/4** cases, including direct navigation to an unknown route, authorized return, and no horizontal overflow at 390, 820, and 1440 CSS pixels. Fixture captures: [phone](product-ui-not-found/not-found-390.png), [tablet](product-ui-not-found/not-found-820.png), [desktop](product-ui-not-found/not-found-1440.png).

The direct URL reload path through the deployed reverse proxy, denied-Dashboard role, dark mode, keyboard focus and screen reader remain separate QA checks.
