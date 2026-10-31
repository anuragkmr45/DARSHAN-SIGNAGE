# D3 retained-age Docker roundtrip — developer evidence, 2026-10-30

Status: **passed for the bounded D3 crypto foundation only**. This is not backup, restore, API, worker, CMS, player, promotion, rollback, production-topology or RTO evidence.

## Scope and safety gate

- D1 readiness immediately before execution: `READY`.
- Available memory: `3330867200` bytes; required: `2717908992` bytes.
- Swap used: `2599059456` bytes; pressure avg10: `0`.
- Running Docker containers before execution: `0`.
- Firefox was present and untouched.
- Docker Desktop remained stopped; the enrolled native Docker daemon/context was used.
- No host package was installed.
- Only the fixed, enrolled D3 tools image and protected `.controlled-recovery-d3` paths were used.

## Observed failure and correction

The first bounded run safely stopped after the original tools image created ciphertext with mode `0644`. The protected-output check returned `CONTROLLED_RECOVERY_D3_PROTECTED_PATH_UNSAFE`; the exact labelled container was removed and no slot lock remained. The retained private key and public receipt were already safe at `0600` and were preserved. Only that failed test ciphertext was later removed.

The corrected image uses a fixed, statically compiled wrapper that calls `umask(0077)` and then `execv` for an exact whitelist of age/age-keygen/ffmpeg/ffprobe paths. It uses no shell or post-output chmod. The wrapper binary was rebuilt twice, with the second build verifying its enrolled SHA-256.

Corrected image enrollment:

- image ID: `sha256:22c34e187a9650e0bc319e95cfcbd12e770a2643df898c12880d9be96a6b35a3`
- repository digest: `darshan-d3-tools@sha256:22c34e187a9650e0bc319e95cfcbd12e770a2643df898c12880d9be96a6b35a3`
- config SHA-256: `c2741ddea226184879e850990e1717128d9b7cf5bf003703d89cdd082a7fa7a8`
- wrapper source SHA-256: `6510eebe8c9b99efb11eb5da04bab2c54674f83d65fc87b53a066510986f3bc8`
- wrapper binary SHA-256: `b860f34f61b12a820a6f3dd78c5df711fbedf3e209735750b1873a73eaa446b9`
- pinned temporary build dependency: `build-base=0.5-r4`, removed from the final runtime stage
- runtime packages: `age=1.3.2-r1`, `ffmpeg=8.1.3-r0`

## Passing live observations

- operation: `d2000000-0000-4000-8000-000000000001`
- retained identity receipt SHA-256: `a5e908b3fce787c33399e202449fcceff2ed8284cd56af690e278630d4ab76cf`
- fresh-process identity reload: passed; the retained key was re-derived and not regenerated
- receipt history: `2` immutable versions; the legacy receipt was preserved and the corrected tools authority was appended
- plaintext SHA-256: `b2797a7998e01b1d4c7e9c0a31a0e1d3982028655eaa53615f50e24ece188773`
- ciphertext SHA-256: `60c8347dc47293f829c735e27546a98fc3153418bc4b4275e3c48f54b3a19a02`
- decrypted SHA-256: `b2797a7998e01b1d4c7e9c0a31a0e1d3982028655eaa53615f50e24ece188773`
- tampered ciphertext: rejected with `CONTROLLED_RECOVERY_D4_TOOLS_FAILED`
- valid decrypt after the failed tamper attempt: passed with the original plaintext hash
- retained key mode: `0600`
- legacy receipt mode: `0600`
- ciphertext mode: `0600`
- decrypted output mode: `0600`
- remaining D3 tool-slot entries: none
- remaining labelled D3 tool containers: none

The private key and recipient are intentionally absent from this evidence.

## Static and fake-process evidence supporting the live result

- final D1/D2/D3/D4/foundation/executor suites: **84/84 passed**
- recovery-tests typecheck: passed
- scripts typecheck: passed
- focused ESLint with zero warnings: passed
- diff checks: passed
- independent bounded foundation review: no P1/P2 finding and go for this roundtrip

## Remaining gates

The complete disposable backup/restore flow remains unpassed. Source PostgreSQL/MinIO/Valkey provisioning, real seed and capture, broker/capsule authority, fresh-target restore and verification, API/worker/CMS/player validation, separate promotion, rollback and exact final cleanup remain required. Production/native recovery remains frozen and unavailable.
