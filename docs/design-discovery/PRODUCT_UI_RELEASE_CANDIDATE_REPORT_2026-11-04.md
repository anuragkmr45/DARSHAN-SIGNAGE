# Product UI release-candidate report — 2026-11-04

Branch: `codex/darshan-product-ui-redesign-20261103`

Frozen code commit: `add5b0ed1ddd2a15f10e269bd5745f2f0e2b01fe`

This is developer release-candidate evidence, not independent QA approval and not authority to merge or push `release-01`.

## Scope freeze and resolved defects

The release-candidate audit found no confirmed P0 implementation blocker. Two confirmed P1 defects were fixed and committed separately:

- `e4c3c0e`: Schedule Queue Preview resolves the authorized Media detail on demand, renders IMAGE/VIDEO/PDF through the shared preview, and leaves a failed request retryable.
- `add5b0e`: Chat send no longer inherits automatic mutation retry. A failed/uncertain send stays visible and only the operator's labeled Retry sends another POST.

Cosmetic requests and environment-dependent Windows, physical display/audio, cross-VM TLS/media, capacity, restore, soak, hardware and independent human checks are frozen as remaining QA.

## Frozen automated boundary

| Check | Result |
| --- | --- |
| Schedule Queue affected browser file | 20/20 passed |
| Chat affected browser file | 14/14 passed |
| Focused lint for both packets | Passed |
| CMS production build and bundle budget | Passed; entry 214.7 KiB / 68.5 KiB gzip |
| CMS unit suite | 46 files, 287/287 passed |
| Broad CMS browser regression, one Chromium worker | 186 passed, five environment-dependent Chat cases skipped, zero failed |
| Player exact-source build and Ubuntu packaging | Passed |

Server/player suites were not repeated because neither P1 packet changed server or player source. The exact player source was rebuilt for packaging; previously recorded affected server/player checks remain the applicable developer evidence.

## Artifact identities

The ignored local candidate directory is `.local/product-ui/release-candidate-add5b0e/`.

| Artifact | SHA-256 |
| --- | --- |
| `darshan-cms-add5b0e.tar.gz` | `45031ad4004a2ad0cbd6affab65360514b2cd59771c003e86b996771e59cba03` |
| `darshan-player_1.0.0_add5b0e_amd64.deb` | `d653158a15cea44238569d357296a2506675ce57981e965d4a07b40f7eec86e2` |
| Packaged player `app.asar` | `7f8a22356d0161bc2f66e221631c176819b675e6446e6eda122fe6f8e08f4781` |
| Built CMS file-tree digest | `05d8c39e3827434e44b02dd3026689e0f65c9f6a789261f2d3494824d21d3184` |

The DEB identifies as package `darshan-player`, version `1.0.0`, architecture `amd64`; its `app.asar` includes `dist/renderer/index.html` and the bundled `standby-artwork.svg`.

## Exact-artifact smoke

- The exact CMS `dist` tree is mounted read-only in isolated container `darshan-live-cms-20261103` with build label `rc-add5b0e`; HTTPS Login and backend Health return `200`.
- The exact packaged player tree starts against the existing isolated private QA profile; loopback health is `healthy`, bounded queues are empty and successful backend heartbeat metrics are present.
- Authenticated real CMS journey passed: Schedule Queue opened the pending request, its Media tab resolved the authorized IMAGE detail and rendered the preview dialog, then Screens showed the exact player Online/Standby with a fresh backend heartbeat and readable CPU, memory, disk, queue, hostname, OS, version, display and power values. Direct Prometheus scraping/Grafana correctly remained unavailable in this isolated stack. The pending local QA Schedule remained unapproved and unchanged.

## Deployment readiness

**Developer status: testable candidate. Production status: not ready / no Go decision.**

Implementation and developer regression gates are green. Production Go remains blocked on the unchecked human/environment rows in `qa-artifacts/11_RELEASE_READINESS_CHECKLIST.md`, including independent Chat response-loss, native Ubuntu/Windows installation, physical display/audio, cross-VM TLS/media, capacity/load, restore, soak, security and accessibility evidence. No merge or push to `release-01` was performed.
