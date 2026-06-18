# On-Prem Dev Config Set

This profile is a non-secret local development example using `192.168.0.5`.

Copy the JSON files to the appropriate site paths before use:

- backend: `/etc/darshan/server/config.dev.json`
- player: `/etc/darshan/player/config.dev.json`
- CMS runtime: deploy as `config/app-config.json` beside the built CMS `index.html`

Set selectors only on the relevant process:

- backend: `DARSHAN_CONFIG_FILE=/etc/darshan/server/config.dev.json`
- player: `DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.dev.json`

Do not copy `secrets.env.example` directly without replacing placeholders in a local secret store.
