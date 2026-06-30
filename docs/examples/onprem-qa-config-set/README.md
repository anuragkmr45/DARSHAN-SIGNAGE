# On-Prem QA Config Set

This profile is a non-secret QA example using placeholder internal hostnames. Replace hostnames and secrets on the target site.

## Docker placement

Use these paths when the backend and CMS run through the Docker role deployment:

- backend: copy `backend-config.example.json` to `darshan-server/config/backend.json`.
- backend selector: `DARSHAN_CONFIG_FILE=/app/config/backend.json`.
- CMS runtime: copy `cms-runtime-config.example.json` to `darshan-cms/public/config/app-config.json`; the CMS container serves it as `/config/app-config.json`.
- player: copy `player-config.example.json` to `/etc/darshan/player/config.json` on the player machine and set `DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json`.

## Direct-host compatibility

Use these only when running processes directly on the host without Docker:

- backend: `/etc/darshan/server/config.qa.json`.
- backend selector: `DARSHAN_CONFIG_FILE=/etc/darshan/server/config.qa.json`.
- CMS runtime: deploy as `config/app-config.json` beside the built CMS `index.html`.
- player: `/etc/darshan/player/config.qa.json`.

Set selectors only on the relevant process:

- backend Docker: `DARSHAN_CONFIG_FILE=/app/config/backend.json`.
- backend direct-host: `DARSHAN_CONFIG_FILE=/etc/darshan/server/config.qa.json`.
- player: `DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json` or the direct-host profile path above.

Do not include credentialed URLs in backend, player, or CMS JSON config files. Keep credentials in the local secret store.
Current source supports `player.security`; older installed player packages may reject that section until the package is updated.
