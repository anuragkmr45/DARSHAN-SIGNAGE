# DARSHAN interface prototype: visual checkpoint

Status: visual direction approved by the user on 2026-11-04 for extension to the remaining CMS pages and player-owned screens. Functional behavior, real-service QA, and production readiness are separate. Source prototype branch: `codex/darshan-product-ui-redesign-20261103` at `5cdca15`.

The six prototypes below cover the agreed checkpoint before applying this visual system to the remaining CMS routes and player states. Each screenshot comes from a running browser or built player renderer with controlled fixture state. Functional checks are recorded in the corresponding `qa-artifacts/evidence/product-ui-*-developer-verification-2026-11-04.md` files.

| Surface | Main task and information priority | Action and disclosure | Review image |
| --- | --- | --- | --- |
| Dashboard | Find a fleet problem and continue publishing; posture and alerts before metrics detail. | New Request is primary; Schedule Report is secondary; status sections have no outer card stack. | [Desktop](../../qa-artifacts/evidence/product-ui-core-prototypes/dashboard-1440.png), [phone](../../qa-artifacts/evidence/product-ui-core-prototypes/dashboard-390.png) |
| Screens | Find an unhealthy Screen, inspect current content, then pair or recover. | Details is the primary row action; Screen Groups and code history are labeled disclosures; destructive controls stay contextual. | [Desktop](../../qa-artifacts/evidence/product-ui-core-prototypes/screens-1440.png), [phone](../../qa-artifacts/evidence/product-ui-core-prototypes/screens-390.png) |
| Schedule review | Confirm content, audience, timing, timezone, and reservation state before submission. | Persistent Back/Submit actions; detailed geometry and item settings disclose on request; conflicts remain visible. | [Desktop](../../qa-artifacts/evidence/product-ui-core-prototypes/schedule-review-1440.png), [phone](../../qa-artifacts/evidence/product-ui-core-prototypes/schedule-review-390.png) |
| Layout editor | Add and adjust slots without losing geometry. | Canvas and selection tools remain primary; numeric inspector, layers, undo/redo, and slot list provide alternatives. | [Desktop](../../qa-artifacts/evidence/product-ui-layout-editor/desktop-1440.png), [phone](../../qa-artifacts/evidence/product-ui-layout-editor/phone-390.png) |
| Conversations | Find a chat, read messages, follow a reply. | Desktop split view; phone list → conversation → thread; message management is contextual. | [Desktop](../../qa-artifacts/evidence/product-ui-chat-navigation/desktop-split-1440.png), [phone conversation](../../qa-artifacts/evidence/product-ui-chat-navigation/phone-conversation-390.png), [phone thread](../../qa-artifacts/evidence/product-ui-chat-navigation/phone-thread-390.png) |
| Player pairing and recovery | Connect a player without input hardware and identify its host and current action. | Code, expiry, hostname, and waiting state stay visible; diagnostics and development controls are secondary; recovery fills the window. | [Pairing](../../qa-artifacts/evidence/product-ui-player-prototype/pairing-full-1440.png), [minimal pairing](../../qa-artifacts/evidence/product-ui-player-prototype/pairing-minimal-390.png), [recovery](../../qa-artifacts/evidence/product-ui-player-prototype/recovery-1440.png) |

## Review decision

The user answered “Approve this direction” to the six-prototype visual checkpoint on 2026-11-04. This authorizes extending the visual direction to remaining routes and player-owned screens. It does not approve business behavior or production readiness.

Known work after this checkpoint: complete route/control coverage register, remaining CMS and player surfaces, real-service Group membership journey, other business journeys, packaged-player regression, cross-route review, human QA, and release gates. The current screenshot data is controlled fixture data and may show old dates or unavailable monitoring.
