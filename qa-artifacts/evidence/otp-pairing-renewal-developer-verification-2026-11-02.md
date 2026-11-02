# OTP pairing renewal developer verification — 2026-11-02

Branch: `codex/pairing-otp-renewal-20261102`

## Contract checked

- A current unpaired player stores a private pairing credential before requesting its first OTP. The backend assigns one Device ID to that credential and returns the same active code on an uncertain initial retry.
- Renewal keeps the Device ID, immediately retires the prior OTP and its approval, and uses a renewal request ID to make retries idempotent. CMS lists current unused codes separately from history.
- The visible OTP card shows the OS hostname in production and minimal layouts. Countdown uses backend time plus a monotonic clock, with backend expiry authoritative. Legacy players without a credential retain their older request contract and wait for expiry before one-time rollover.

## Automated developer checks

| Check | Result |
|---|---|
| Server TypeScript build | Passed |
| Database-backed pairing route suite | 20/20 passed: stable ID, retry, renewal, stale approval, revocation, completion, concurrency, active/history |
| Screen lifecycle dry run | Passed |
| Player build; unit, integration, and fault suites | Passed |
| Player pairing presentation browser check | 1/1 passed, including production/minimal hostname and skewed player clock |
| CMS build and bundle budget | Passed |
| CMS unit suite | 126/126 passed |
| CMS Screens Chromium suite | 6/6 passed, including active/history pairing list |
| `git diff --check` | Passed |

## Isolated live application journey

The updated API ran in a disposable Docker container against a dedicated PostgreSQL test database. A separately packaged CMS served the updated build through Nginx. The updated Electron player ran with a private test profile and reached the API through its normal HTTP client. No production VM or existing beta deployment database was used.

1. Electron requested an OTP. The CMS Active codes view displayed its pending Device ID and code.
2. The API renewed that session. The response kept the Device ID and changed the code; the running player adopted the new code in approximately six seconds. CMS Active codes showed the replacement, while History showed the old code as `SUPERSEDED`.
3. Entering the superseded code in the real CMS Pair Device modal returned a visible rejection. The current code was accepted.
4. With the test player configured for the API's actual `development / local / darshan-api` identity, the player completed CSR and certificate exchange, cleared the OTP and private pairing credential, kept its Device ID, entered `PAIRED_RUNTIME`, and appeared online in CMS.

The first completion attempt deliberately exposed an inherited host `DARSHAN_PLAYER_CONFIG_FILE` that overrode the isolated test profile with another site identity. The server rejected it as `ENVIRONMENT_MISMATCH`, and the player reset its test identity. Repeating the journey without that inherited file setting succeeded. This was test configuration contamination, not a bypass of site identity validation.

## Human release QA still open

- Repeat renewal, approval cancellation, restart, missed response, backend outage, hostname rename, and skewed-clock journeys on real Ubuntu and Windows packages and displays.
- Verify production HTTPS, firewall, and five-VM deployment integration; measure visible countdown and OTP replacement on physical screens.
- Confirm installation/upgrade behavior for a pre-upgrade player with an active legacy code and test rollback with the deployed player version.

This is developer verification, not production or physical-display acceptance.
