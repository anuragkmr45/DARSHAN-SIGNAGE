#!/bin/sh
set -eu

role="${DARSHAN_CONTAINER_ROLE:-}"
case "$role" in
  api|worker|recovery) ;;
  *) echo "DARSHAN_CONTAINER_ROLE must be api, worker, or recovery." >&2; exit 1 ;;
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
    worker_secrets_required=true
    if [ "${BACKUP_MODE:-APPLICATION_OFFHOST}" = EXTERNAL_SIDECAR ]; then
      worker_secrets_required=false
    fi
    copy_inputs /run/darshan-input-worker-secrets /run/worker-secrets "$worker_secrets_required"
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
