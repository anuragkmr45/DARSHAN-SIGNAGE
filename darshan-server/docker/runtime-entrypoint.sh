#!/bin/sh
set -eu

role="${DARSHAN_CONTAINER_ROLE:-}"
case "$role" in
  api|worker|backup-broker|recovery) ;;
  *) echo "DARSHAN_CONTAINER_ROLE must be api, worker, backup-broker, or recovery." >&2; exit 1 ;;
esac

copy_inputs() {
  source_dir="$1"
  destination_dir="$2"
  required="$3"
  install -d -m 0700 -o node -g node "$destination_dir"
  found=false
  for source_file in "$source_dir"/*; do
    [ -e "$source_file" ] || continue
    found=true
    if [ ! -f "$source_file" ] || [ -L "$source_file" ]; then
      echo "Runtime input must be a regular non-symlink file: $source_file" >&2
      exit 1
    fi
    destination_file="$destination_dir/$(basename "$source_file")"
    cp "$source_file" "$destination_file"
    chown node:node "$destination_file"
    case "$destination_file" in
      *.crt) chmod 0644 "$destination_file" ;;
      *) chmod 0600 "$destination_file" ;;
    esac
  done
  if [ "$required" = true ] && [ "$found" != true ]; then
    echo "Required runtime input directory is empty: $source_dir" >&2
    exit 1
  fi
}

prepare_worker_runtime_dirs() {
  case "${HOME:-}" in
    ""|/root|/root/*) HOME=/tmp/darshan-worker-home ;;
  esac
  case "${XDG_CONFIG_HOME:-}" in
    ""|/root|/root/*) XDG_CONFIG_HOME="$HOME/.config" ;;
  esac
  case "${XDG_CACHE_HOME:-}" in
    ""|/root|/root/*) XDG_CACHE_HOME="$HOME/.cache" ;;
  esac
  TMPDIR="${TMPDIR:-/tmp}"
  export HOME XDG_CONFIG_HOME XDG_CACHE_HOME TMPDIR
  if [ "$TMPDIR" = /tmp ]; then
    install -d -m 1777 /tmp
    chmod 1777 /tmp
  fi
  install -d -m 0700 -o node -g node "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
}

if [ "$role" = recovery ]; then
  copy_inputs /run/darshan-input-recovery /run/darshan-recovery true
elif [ "$role" = backup-broker ]; then
  # Broker inputs are mounted individually read-only. Do not copy or expose
  # application/runtime secret directories to this service. The narrowly
  # privileged listener supervisor is the only accepted root entry; it binds
  # protected sockets, drops to uid:gid 1000:1000, then execs Node by FD.
  if [ "$(id -u)" != 0 ] || [ "$(id -g)" != 0 ] || [ "${1:-}" != /usr/local/bin/backup-broker-listener ]; then
    echo "Backup broker must start through the fixed listener supervisor." >&2
    exit 1
  fi
  exec "$@"
else
  copy_inputs /run/darshan-input-certs /app/certs true
  copy_inputs /run/darshan-input-secrets /run/secrets true
  if [ -d /run/darshan-input-bootstrap ]; then
    copy_inputs /run/darshan-input-bootstrap /run/darshan-bootstrap true
  fi
  if [ -d /run/darshan-input-evidence ]; then
    copy_inputs /run/darshan-input-evidence /run/darshan-evidence true
  fi
  if [ "$role" = worker ]; then
    prepare_worker_runtime_dirs
    case "${BACKUP_REPOSITORY_KIND:-}" in
      LEGACY_OFF_HOST)
        copy_inputs /run/darshan-input-worker-secrets /run/worker-secrets true
        ;;
      LOCAL_FILESYSTEM|"")
        # Local repositories have no off-host credential input. Production
        # policy validation rejects an empty kind; the empty case keeps QA and
        # non-production workers independent of production-only secrets.
        ;;
      *)
        echo "Unsupported BACKUP_REPOSITORY_KIND: $BACKUP_REPOSITORY_KIND" >&2
        exit 1
        ;;
    esac
    install -d -m 0700 -o node -g node /var/lib/darshan-worker/tmp
  fi
fi

exec setpriv \
  --reuid=node \
  --regid=node \
  --init-groups \
  --no-new-privs \
  --bounding-set=-all \
  --inh-caps=-all \
  --ambient-caps=-all \
  -- "$@"
