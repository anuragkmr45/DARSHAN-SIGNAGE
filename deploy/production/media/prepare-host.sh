#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ "$(id -u)" == 0 && "$(uname -s)" == Linux ]] || { echo "Native Linux root preparation required." >&2; exit 1; }
./verify-role.sh
source ./.env.production
for tool in docker python3 openssl curl jq systemctl findmnt flock; do command -v "$tool" >/dev/null; done
[[ "$(findmnt -n -o FSTYPE --target /run)" == tmpfs ]] || { echo "/run must be tmpfs." >&2; exit 1; }
install -d -m 0755 /run/darshan-media-watchdog /run/darshan-media-host-lease /etc/darshan/media-watchdog /opt/darshan/media
install -d -m 0700 "$PRIVATE_ROOT/host" "$PRIVATE_ROOT/host/witness-outbox"
# Install the NEW parser before any node writes backend authority boot fields.
install -m 0755 -o root -g root ./host-watchdog.py /opt/darshan/media/host-watchdog.py
install -m 0755 -o root -g root ./host-witness.py /opt/darshan/media/host-witness.py
install -m 0644 -o root -g root ./darshan-media-watchdog@.service /etc/systemd/system/darshan-media-watchdog@.service
install -d -m 0755 /etc/systemd/system/darshan-media-watchdog@.service.d
cat > /etc/systemd/system/darshan-media-watchdog@.service.d/host-lease.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/python3 /opt/darshan/media/host-watchdog.py --docker-context default --container-id ${DARSHAN_MEDIA_CONTAINER_ID} --instance-id ${DARSHAN_MEDIA_NODE_INSTANCE_ID} --heartbeat ${DARSHAN_MEDIA_HOST_HEARTBEAT_FILE} --heartbeat-uid ${DARSHAN_MEDIA_HOST_HEARTBEAT_UID} --host-lease-file ${DARSHAN_MEDIA_HOST_LEASE_FILE} --witness-ready-file ${DARSHAN_MEDIA_HOST_WITNESS_READY_FILE}
ReadWritePaths=/run/darshan-media-host-lease
EOF
role_dir="$(pwd -P)"
cat > "/etc/systemd/system/darshan-media-witness-${SITE_NAME}@.service" <<EOF
[Unit]
Description=DARSHAN physical media death witness %i ($SITE_NAME)
Wants=docker.service
After=docker.service
StartLimitIntervalSec=0
[Service]
Type=simple
EnvironmentFile=/etc/darshan/media-watchdog/%i.env
ExecStart=/usr/bin/python3 /opt/darshan/media/host-witness.py watch --metadata $role_dir/role.json --outbox $PRIVATE_ROOT/host/witness-outbox --container-id \${DARSHAN_MEDIA_CONTAINER_ID} --image-id \${DARSHAN_MEDIA_IMAGE_ID} --instance-id %i --heartbeat \${DARSHAN_MEDIA_HOST_HEARTBEAT_FILE} --readiness-directory \${DARSHAN_MEDIA_HOST_LEASE_DIRECTORY}
Restart=on-failure
RestartPreventExitStatus=2
RestartSec=1
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$PRIVATE_ROOT/host /run/darshan-media-host-lease
ProtectHome=read-only
PrivateTmp=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
EOF
cat > "/etc/systemd/system/darshan-media-witness-retry-${SITE_NAME}.service" <<EOF
[Unit]
Description=Retry immutable DARSHAN media witnesses ($SITE_NAME)
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/darshan/media/host-witness.py retry --metadata $role_dir/role.json --outbox $PRIVATE_ROOT/host/witness-outbox
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$PRIVATE_ROOT/host
EOF
cat > "/etc/systemd/system/darshan-media-witness-retry-${SITE_NAME}.timer" <<EOF
[Unit]
Description=Retry DARSHAN physical death witnesses ($SITE_NAME)
[Timer]
OnBootSec=10s
OnUnitActiveSec=10s
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now "darshan-media-witness-retry-${SITE_NAME}.timer"
echo "Updated watchdog and witness units installed. Provision private inputs/TLS, then explicitly start the node."
