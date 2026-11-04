---
name: darshan-product-ui
description: Design or review DARSHAN CMS and desktop-player interfaces against operator workflows, signage safety, and the approved quiet macOS direction.
---

# DARSHAN product interface

Use this skill for the CMS and application-owned player surfaces. Read the affected module's `AGENTS.md` and trace the mounted route or renderer through its data source, authorization, and tests before changing it.

The pinned upstream skills in this project support specific passes: read `emil-design-eng` and `apple-design` for composition, `prototype` when comparing alternatives, `mobile-native` for phone workflows, `break-ui` for stress cases, `review-animations` and `animation-performance` for motion, and `ask-sonner` when changing notifications. The DARSHAN business contract and user decisions take precedence over generic platform patterns. Source and license are recorded in `../EMIL-SKILLS-ORIGIN.md`.

For each surface, record: user task → information priority → primary and secondary actions → optional disclosure → safety that must remain visible → rendered evidence. Review the result at 390, 820, and 1440 CSS pixels where the surface applies, plus portrait or compact player density where applicable.

Use a quiet application structure: deep forest sidebar, warm cream content canvas, selective white panels, one page heading, compact task toolbar, source list or split view for dense work, inspector for details, and a focused sheet for a form. The sidebar is never white, including its collapsed and mobile states. Use separators and spacing before adding a card. Forest is the default of five selectable CMS accents; the stored `emerald` value represents Forest. Keep uploaded media and scheduled playback geometrically untouched. Customer accent is a selection and action cue; emergency, failure, success, warning, and unknown keep their own meaning. Use readable local system fonts and accessible focus states.

Place required choices and active problems in the main flow. Disclose optional diagnostics and advanced settings without hiding consequences or blocked actions. Write status in plain language while preserving the distinctions between assigned, delivered, player-reported playback, and proof of play. Do not invent status from missing telemetry.

Do not add decorative hero panels, repeated headings, stacked cards for ordinary rows, heavy blur behind data, icon-only critical commands, placeholder controls, or repeated entrance animation. Motion should explain a state change, remain interruptible, and honor reduced motion. Keyboard, touch, and numeric alternatives must exist for spatial editing.

The player remains a plain TypeScript/HTML/CSS kiosk. Its owned states use a fixed forest palette with offline-capable light/dark variants; CMS accent choice does not reach the player. Routine status belongs in CMS; production media has no overlay. Pairing, recovery, critical lock, emergency, and controlled unavailable states must remain legible without input. The built-in standby appears only when no schedule or default content is eligible and never creates fabricated proof of play.

Verify the rendered surface through the running application. Perform the relevant action as an operator, inspect the server or player result, and record expected and observed behavior. Treat mocked UI tests as state coverage, not proof that the real workflow succeeds.

Before sweeping a palette through all routes, render Home, Login, public activation, authenticated shell, dense Screens, Schedule review, and player pairing/recovery/standby for a visual checkpoint. The public pages follow saved site appearance with a safe cream-and-forest default. Check 390/820/1440 widths, dark/light and all five accents, 4.5:1 text contrast, 3:1 meaningful control boundaries, text zoom, focus, reduced motion, customer logos, and high-priority status labels. The attached color reference is a starting point; its `#767B76` caption fails contrast on cream and white, so use the darker approved derived token.
