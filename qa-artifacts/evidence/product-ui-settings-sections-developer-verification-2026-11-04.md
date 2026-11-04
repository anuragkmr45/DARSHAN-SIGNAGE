# Settings section layout: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This is fixture-backed visual and workflow evidence, not independent human QA.

- General, Branding, Security, Appearance and the three Advanced sections use the cream/dark page canvas instead of a large outer card. Form controls, brand preview and individual log entries retain their own boundaries. The category navigation and save behavior did not change.
- The first 390px dark capture showed the inherited `operational-card` border still present after padding was removed. A scoped CSS rule removed both together. The final [dark Advanced](product-ui-settings/logs-dark-390.png) and [light Branding](product-ui-settings/390-light.png) captures were inspected; neither has the flush-to-border defect. The 1440px Branding capture was regenerated as well.
- Full Settings Chromium fixture browser file: **7/7 passed**, including read-only access, branding clear/save, invalid upload, Retry, dark/light logs, three widths and phone draft/focus behavior. Final CMS production build and bundle budget passed; unit suite **283/283** passed. Focused TypeScript ESLint passed; CSS is outside the ESLint configuration.

Open: matched-service Settings writes, live backup/log data, customer logo variants, text zoom, keyboard and screen-reader review, and independent QA. No site setting or backend contract changed in this packet.
