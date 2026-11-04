# Shared CMS toast: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`.

- The shared notification keeps its Radix toast semantics, title, description, and optional action. It uses the current light/dark surface and a pale semantic error tone independent of the selected customer accent. The close control is visible without hover, keyboard focusable, and labeled “Dismiss notification.”
- The actual Settings browser journey rejected a PDF branding upload, showed the error description, confirmed the close control was visible, sampled different light/dark surfaces after disabling only the sampled transition, dismissed the toast, and confirmed the browser sent no upload request. Focused browser case **1/1** and lint passed.
- CMS production build and bundle budget passed. Full CMS unit suite passed **283/283**.

This is fixture-backed developer verification. Real-service workflows, assistive-technology announcements, touch-device behavior, toast actions, multiple simultaneous notifications, and selected-accent visual review remain open.
