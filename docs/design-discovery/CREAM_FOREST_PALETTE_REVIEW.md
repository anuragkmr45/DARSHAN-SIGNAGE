# Cream-and-forest palette: visual checkpoint

Status: **visual direction approved by the user on 2026-11-04 for the entire CMS and player-owned states**. The previous six-surface checkpoint approved composition and task order; the 2026-11-04 palette revision is a separate visual decision. This study is isolated from production CMS and player code.

Open the interactive [palette study](CREAM_FOREST_PALETTE_CHECKPOINT.html) to change surface, light/dark appearance, and one of the five CMS accent choices. Forest is the default and continues to use the stored `emerald` identifier. The forest sidebar remains structural in every accent. The player study also fixes its accent to Forest and disables the CMS accent selector on player views, matching the product decision that player-owned screens do not sync CMS accents.

| Surface | Review image | What to judge |
| --- | --- | --- |
| Public Home | [Light desktop](../../qa-artifacts/evidence/product-ui-cream-forest-checkpoint/home-light-emerald-1440.png) | Cream canvas, one clear sign-in action, no card stack. |
| Login | [Light phone](../../qa-artifacts/evidence/product-ui-cream-forest-checkpoint/login-light-emerald-390.png) | Form clarity, help text, visual weight on a small screen. |
| Invitation activation | [Dark tablet](../../qa-artifacts/evidence/product-ui-cream-forest-checkpoint/activate-dark-emerald-820.png) | One-time code and password form on dark surfaces. |
| Authenticated Screens | [Light desktop](../../qa-artifacts/evidence/product-ui-cream-forest-checkpoint/screens-light-emerald-1440.png), [dark phone with Blue selected](../../qa-artifacts/evidence/product-ui-cream-forest-checkpoint/screens-dark-blue-390.png) | Forest navigation, cream working canvas, readable fleet states. |
| Schedule review | [Light tablet with Amber selected](../../qa-artifacts/evidence/product-ui-cream-forest-checkpoint/schedule-light-amber-820.png) | Draft status, content/audience/time order, clear Submit action. |
| Player pairing | [Light desktop](../../qa-artifacts/evidence/product-ui-cream-forest-checkpoint/pairing-light-emerald-1440.png) | OTP, expiry, hostname and waiting state legibility. |
| Player recovery | [Dark phone](../../qa-artifacts/evidence/product-ui-cream-forest-checkpoint/recovery-dark-emerald-390.png) | Clear reason and next action with no normal playback overlay. |
| Player standby | [Light desktop](../../qa-artifacts/evidence/product-ui-cream-forest-checkpoint/standby-light-emerald-1440.png) | Quiet locally available state when no content is eligible. |

The review controls were hidden in the image captures. The HTML remains interactive for comparison. All names, OTPs, dates, fleet counts, statuses, and device identifiers in this study are illustrative fixture data; buttons do not perform product actions.

## Developer visual checks

Chromium rendered **240 combinations**: eight sample surfaces × light/dark × five accents × 390/820/1440 CSS-pixel widths. The study showed exactly one active surface and no document-wide horizontal overflow in every combination. Eleven sampled text/background token pairs were checked at a 4.5:1 minimum per combination, including page, card, action, sidebar, selected and semantic status pairs; all passed. The light control boundary `#8A9088` against cream and white exceeds 3:1, and the dark boundary `#8D9C8E` against the dark panel exceeds 3:1. Nine clean browser captures were inspected, including public entry, dense Screens and player states. The caption token is `#6D726D`, darker than the attachment's `#767B76` because the latter fails 4.5:1 on cream and white.

These checks validate the **study**, not production readiness. The first CMS foundation packet now wires the public appearance bootstrap, saved accent mapping, and neutral logo backing; see [developer verification](../../qa-artifacts/evidence/product-ui-palette-foundation-developer-verification-2026-11-04.md). The remaining CMS routes and player-owned renderer states still require built-app and packaged-player regression. Real media and live video must retain their authored pixels.
