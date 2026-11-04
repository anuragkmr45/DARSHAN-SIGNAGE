# Player emergency presentation: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This packet changes the player-owned native emergency message and emergency-media warning strip. It does not change emergency authority, snapshot parsing, scheduling, authored media, or offline behavior.

- The native message uses one flat severity surface and retains explicit LOW, MEDIUM, HIGH, or CRITICAL text. Unknown severity falls back to HIGH. The message remains a live alert; emergency media keeps its readable warning strip over the authored content.
- Incoming emergency text replaces the previous frame without a decorative fade. At a compact width, the duplicate status badge is hidden while the native message is visible. An initial rendered inspection exposed both the badge overlap and an old/new text overlap; the follow-up rendered inspection confirmed both were removed.
- The built player Chromium renderer passed **1/1** end-to-end presentation case: each severity and unknown fallback via the ordinary renderer media event, no gradients, semantic alert role, dark 390px long copy with all text inside its surface, one current message, and no duplicate badge. [Critical 390px dark capture](product-ui-player-prototype/production-emergency-critical-dark-390.png) was inspected.
- Player `npm run build` passed. Full `npm run test:unit` passed **542/542**. `npm run test:integration` passed **6/6**.
- Contrast calculations for white body text against LOW/MEDIUM/HIGH/CRITICAL surfaces are **11.50/9.95/11.25/14.73:1**. Severity heading accent contrast is **6.38/6.90/5.83/8.66:1**.

This is local developer verification. The browser uses controlled renderer IPC, not a real CMS emergency. A packaged Ubuntu and Windows player, physical viewing distance, 1000-character message legibility, real backend takeover/clear, and independent human QA remain open.
