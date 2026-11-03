# Design-skill source

The `emil-design-eng`, `apple-design`, `prototype`, `mobile-native`, `break-ui`, `review-animations`, `animation-performance`, and `ask-sonner` folders come from [emilkowalski/skills](https://github.com/emilkowalski/skills) at commit `f1090bec277140d02ed202440185ad9d02ac1490` (2026-11-03). Required adjacent references are copied with their entrypoints. The original MIT license is in `EMIL-LICENSE`.

Compatibility change: the unsupported `disable-model-invocation: true` frontmatter key was removed from `prototype/SKILL.md` and `review-animations/SKILL.md`. Their descriptions and body still specify explicit invocation. All other upstream file content is unchanged.

Use `darshan-product-ui` for product-specific business boundaries. Load the upstream design foundation during composition; load mobile, prototype, stress, motion, or toast guidance only when the current surface needs it. Native iOS conventions are inspiration for responsive web and Electron, not a requirement to simulate platform controls or haptics.
