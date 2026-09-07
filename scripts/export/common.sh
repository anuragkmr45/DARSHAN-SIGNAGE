#!/usr/bin/env bash

export_common_log() {
  printf '[darshan-export] %s\n' "$*"
}

export_require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required." >&2
    exit 1
  fi
}

export_require_directory() {
  local label="$1"
  local directory="$2"
  if [[ ! -d "$directory" ]]; then
    echo "$label directory not found: $directory" >&2
    exit 1
  fi
}

export_require_file() {
  local label="$1"
  local file_path="$2"
  if [[ ! -f "$file_path" ]]; then
    echo "$label file not found: $file_path" >&2
    exit 1
  fi
}

export_ensure_npm_dependencies() {
  local repo_dir="$1"
  if [[ ! -d "$repo_dir/node_modules" ]]; then
    export_common_log "Installing npm dependencies in $repo_dir"
    (
      cd "$repo_dir"
      npm install
    )
  fi
}

export_make_clean_dir() {
  local target_dir="$1"
  rm -rf "$target_dir"
  mkdir -p "$target_dir"
}

export_image_archive_name() {
  local image_ref="$1"
  printf '%s.tar' "${image_ref//[:\/]/-}"
}

export_find_first_artifact() {
  local directory="$1"
  local pattern="$2"
  find "$directory" -type f -iname "$pattern" | LC_ALL=C sort | head -n 1
}

export_host_platform() {
  case "$(uname -s)" in
    Linux)
      printf 'linux'
      ;;
    Darwin)
      printf 'macos'
      ;;
    CYGWIN*|MINGW*|MSYS*)
      printf 'windows'
      ;;
    *)
      printf 'unknown'
      ;;
  esac
}

export_write_load_images_script() {
  local destination="$1"
  cat > "$destination" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob
for image in ./images/*.tar; do
  echo "Loading $image"
  docker load -i "$image"
done
EOF
}

export_write_checksums() {
  local target_dir="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    (
      cd "$target_dir"
      find . -type f ! -name 'SHA256SUMS.txt' -print | LC_ALL=C sort | while IFS= read -r file; do
        sha256sum "$file"
      done
    ) > "$target_dir/SHA256SUMS.txt"
    return 0
  fi

  if command -v shasum >/dev/null 2>&1; then
    (
      cd "$target_dir"
      find . -type f ! -name 'SHA256SUMS.txt' -print | LC_ALL=C sort | while IFS= read -r file; do
        shasum -a 256 "$file"
      done
    ) > "$target_dir/SHA256SUMS.txt"
    return 0
  fi

  echo "Either sha256sum or shasum is required to generate SHA256SUMS.txt." >&2
  exit 1
}

export_assert_clean_git_tree() {
  local repo_dir="$1"
  export_require_command git
  if [[ -n "$(git -C "$repo_dir" status --porcelain)" ]]; then
    echo "Refusing to package a dirty source tree: $repo_dir" >&2
    exit 1
  fi
}

export_write_artifact_manifest() {
  local output_dir="$1"
  local repo_dir="$2"
  local release_id="$3"
  local component="$4"
  local platform="${5:-any}"
  local architecture="${6:-any}"
  node "$PLATFORM_ROOT/scripts/export/artifact-manifest.mjs" write \
    --output "$output_dir" --repo "$repo_dir" --release "$release_id" \
    --component "$component" --platform "$platform" --arch "$architecture"
}
