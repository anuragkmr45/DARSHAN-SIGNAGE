# Config / Env Reduction Plan

Status: CONFIG-4 on-prem config profile sets implemented with backend CONFIG-1, player CONFIG-2.3, and CMS CONFIG-3 ready
Last updated: 2026-06-16

## Goal

Reduce `.env` sprawl without breaking current on-prem deployments. Secrets and sensitive URLs stay in env or secret files. Non-secret runtime/deployment settings move to versioned config examples and site-specific config files outside git.

## Phase 1: Docs And Examples

Status: in progress

Scope:

- record the target config architecture
- inventory current env vars
- create a local `192.168.0.5` example profile with no secrets
- document operator config management
- keep all existing env vars working

No runtime code changes are required in this phase.

## Phase 2: Backend Config Loader

Status: implemented for a focused JSON-only backend subset in CONFIG-1.

Scope:

- add optional `DARSHAN_CONFIG_FILE`
- keep `SIGNHEX_CONFIG_FILE` as alias
- load non-secret config before env validation
- keep env vars as overrides
- preserve all existing env vars
- reuse existing Zod validation in `darshan-server/src/config/index.ts`
- print redacted config summary
- add tests for config precedence and secret redaction

Do not remove `.env` support in this phase.

CONFIG-1 supports JSON only. YAML remains a target architecture option if a parser is approved for the air-gapped dependency mirror.

## Phase 3: Player Config Loader Alignment

Status: implemented for a focused JSON-only player subset in CONFIG-2, with CONFIG-2.3 closing remaining player URL diagnostic/log emission gaps.

Scope:

- keep existing player JSON config support
- add player-specific `DARSHAN_PLAYER_CONFIG_FILE`
- keep `SIGNHEX_PLAYER_CONFIG_FILE` as alias
- avoid generic `DARSHAN_CONFIG_FILE` fallback so backend config cannot be loaded as player config
- ensure pairing/reset diagnostics show redacted config summary without secrets
- redact URL-like diagnostics, renderer logs, startup/network logs, log-shipper upload URL logs, outgoing text log bundle contents, and support output so username/password userinfo, query strings, and fragments from env/runtime URLs are not printed
- keep raw runtime URL data for actual network operations and request-queue byte accounting
- keep env overrides and legacy aliases
- add tests for precedence and reset behavior

CONFIG-2 supports JSON only. YAML remains target architecture pending an approved parser in the air-gapped dependency mirror.

## Phase 4: CMS Runtime Config

Scope:

- move backend/socket URLs from build-time `VITE_*` to runtime config where practical
- serve a non-secret `config/app-config.json`
- keep Vite env fallback for compatibility
- add startup/browser diagnostics for environment identity

Status: implemented in CONFIG-3 for a focused browser-safe JSON subset. The CMS loads optional `/config/app-config.json` before mounting React. Missing runtime config falls back to existing `VITE_*` build-time values. Runtime config values are browser-visible and must not contain credentials, tokens, signed URLs, query strings, or fragments.

## Phase 5: Deprecation And Migration

Scope:

- add warnings for deprecated duplicate aliases
- keep secrets in env
- migrate deployment examples
- provide a site migration checklist
- do not remove old env vars until QA/prod usage is audited

Status: CONFIG-4 created dev/QA/prod on-prem profile sets and a static validator. Deprecation warnings remain future work.

## Phase 6: QA / Production Validation

Scope:

- run browser/on-prem ghost-pairing QA using the selected config file
- run Node 20 builds/tests
- run packaged player reset/revoke/re-pair smoke
- capture redacted evidence

Production readiness stays blocked until this phase produces runtime evidence.

## Compatibility Rules

- env overrides config
- absent config file means current behavior
- examples must not contain real secrets
- private key paths and secret file paths are treated as sensitive
- credentialed URLs should be treated as sensitive even though player diagnostics, doctor output, support diagnostics, renderer logs, log-shipper URL logs, outgoing text log bundle contents, and player URL-bearing logs redact userinfo, query strings, and fragments
- default duplicate identity enforcement remains `warn`
- polling, heartbeat, and offline fallback remain unchanged

## Implementation Notes

Backend loader order should be:

1. built-in defaults
2. optional profile config
3. optional site config from `SIGNHEX_CONFIG_FILE`
4. env overrides
5. validation

Player loader order should stay close to the existing JSON config manager:

1. built-in defaults
2. existing runtime config selected by `DARSHAN_CONFIG_PATH` / `SIGNAGE_CONFIG_PATH` / `HEXMON_CONFIG_PATH`
3. optional player site config selected by `DARSHAN_PLAYER_CONFIG_FILE` / `SIGNHEX_PLAYER_CONFIG_FILE`
4. env overrides
5. command-line/operator overrides where present

Runtime identity, certificates, pairing state, install/session IDs, cache metadata, proof-of-play queues, request queues, and media files are not moved into site config.

CMS runtime config avoids requiring a rebuild for non-secret endpoint changes when a site deploys `/config/app-config.json`. Existing `VITE_*` values remain the fallback when that file is absent.

## Status

CONFIG-0 is documentation and inventory only. CONFIG-1 adds backend JSON config loading. CONFIG-2 adds optional player-specific JSON site config alignment. CONFIG-2.3 closes remaining player URL diagnostic/log emission gaps. CONFIG-3 adds optional CMS browser runtime JSON config for public endpoint/environment labels while preserving build-time `VITE_*` compatibility. CONFIG-4 adds dev/QA/prod profile sets under `docs/examples/onprem-*-config-set/` and validates them with `scripts/verify/validate-onprem-config-examples.sh`.
