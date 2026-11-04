# Player setup state: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`.

The main process already sends a BOOT presentation with `Configuration required: …` when site configuration validation fails. The renderer formerly treated that status as pairing, showing the instruction to enter a code and rendering “CONFIG” in the OTP field. The player now shows setup guidance, hostname and validation reason; it hides OTP and expiry while configuration is invalid. Ordinary pairing copy returns for actual pairing states.

- Player `npm run build` passed.
- The built Chromium renderer presentation case passed **1/1**, including the production-mode invalid-configuration state at 390px, absence of code/expiry, visible hostname, no viewport overflow and subsequent emergency state.
- The [390px setup capture](product-ui-player-prototype/production-configuration-required-390.png) was inspected.

This is a controlled renderer IPC check. A packaged Ubuntu/Windows launch with an invalid site config, administrator correction and restart, physical-display legibility, and full lifecycle QA remain open. The full 542-unit suite and 6 integration tests passed earlier in this packet before this renderer-only correction; they were not repeated after it.
