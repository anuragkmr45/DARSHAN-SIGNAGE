# Settings interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. Visual direction: approved 2026-11-04.

## Operator contract checked

The CMS now makes General, Security, Appearance, and Advanced read-only without the effective `update OrgSettings` grant. Branding choice and upload require the relevant Branding and Media grants. The server remains the final authority: both branding write paths reject deleted, unfinished, and non-image Media; a legacy invalid image does not receive a signed preview URL. The image Clear action also clears the unsaved preview, and Save persists the null ID. Error and retry states appear for settings loads, the image picker, backup history, and recent logs.

The Default Media target writer no longer automatically retries after a stale-revision `409`. Another operator's saved revision must be reviewed before a new explicit Save.

## Evidence

- API route suite: `settings.test.ts`, 9/9 passed against dedicated `darshan_users_ui_test`; new case covers READY IMAGE, PROCESSING IMAGE, READY DOCUMENT, both write routes, unchanged saved branding, and legacy URL suppression.
- Browser: `settings-ui.e2e.spec.ts`, 5/5 passed for read-only grants, image clear/save/choose, PDF upload rejection before an upload session, failed-load Retry, and layout at 390/820/1440 CSS pixels.
- A combined run of the new Settings suite with the existing Default Media suite exposed an automatic retry after `409`; after disabling that retry, the targeted stale-save browser case passed. The other three Default Media cases passed in the combined run.
- CMS unit suite: 42 files, 272/272 passed. CMS and server production builds passed. Focused CMS lint passed; server lint had two pre-existing `any` warnings and zero errors. `git diff --check` passed.
- Rendered fixture captures: [phone](product-ui-settings/390-light.png), [desktop](product-ui-settings/1440-light.png). They use controlled fixture data and show the approved quiet Settings layout.

## Remaining validation

The browser journeys use fixture API responses. Run a real-service Settings save, branding upload/clear, custom-role read-only journey, two-operator Default Media conflict, and backup sidecar display on the release candidate. The image picker currently lists only the first 50 ready images, so a larger library needs search or paging. The Roles tab, global Settings query authorization/refresh behavior, screen-reader pass, and deployed CMS/player regression remain in the broader redesign goal. Human QA sign-off is separate.
