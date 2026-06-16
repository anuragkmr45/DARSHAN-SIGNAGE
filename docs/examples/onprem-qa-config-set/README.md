# On-Prem QA Config Set

This profile is a non-secret QA example using placeholder internal hostnames. Replace hostnames and secrets on the target site.

Copy the JSON files to the appropriate site paths before use:

- backend: `/etc/darshan/server/config.qa.json`
- player: `/etc/darshan/player/config.qa.json`
- CMS runtime: deploy as `config/app-config.json` beside the built CMS `index.html`

Set selectors only on the relevant process:

- backend: `DARSHAN_CONFIG_FILE=/etc/darshan/server/config.qa.json`
- player: `DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.qa.json`

Do not include credentialed URLs in backend, player, or CMS JSON config files. Keep credentials in the local secret store.
