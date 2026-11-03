# Sourced only by assemble-runtime-bundle.sh after its normal production roles.
stage_live_media_role() {
  [[ "${INCLUDE_LIVE_MEDIA:-false}" == true ]] || return 0
  : "${MEDIA_PACKAGE_DIR:?MEDIA_PACKAGE_DIR is required}"
  : "${MEDIA_PRIVATE_HOST:?MEDIA_PRIVATE_HOST is required}"
  : "${MEDIA_BIND_ADDRESS:?MEDIA_BIND_ADDRESS is required}"
  local metadata media_commit server_commit archive
  metadata="$(node "$PLATFORM_ROOT/scripts/export/artifact-manifest.mjs" verify --output "$MEDIA_PACKAGE_DIR" --release "$DARSHAN_RELEASE_ID" --component media --platform linux)"
  media_commit="$(jq -r .sourceCommit <<<"$metadata")"
  server_commit="$(jq -r .sourceCommit "$SERVER_PACKAGE_DIR/ARTIFACT_MANIFEST.json")"
  [[ "$media_commit" == "$server_commit" ]] || { echo "Media and Backend packages must have identical clean source commits." >&2; exit 1; }
  local -a archives=()
  mapfile -t archives < <(find "$MEDIA_PACKAGE_DIR/images" -maxdepth 1 -type f -name '*.tar' -print)
  [[ ${#archives[@]} == 1 ]] || { echo "Media package must contain exactly one Docker image archive." >&2; exit 1; }
  archive="${archives[0]}"
  PROD_MEDIA_DIR="$PRODUCTION_ROOT/media"
  mkdir -p "$PROD_MEDIA_DIR/images"
  cp "$archive" "$PROD_MEDIA_DIR/images/"
  cp "$MEDIA_PACKAGE_DIR/ARTIFACT_MANIFEST.json" "$PROD_MEDIA_DIR/MEDIA_ARTIFACT_MANIFEST.json"
  DARSHAN_RELEASE_ID="$DARSHAN_RELEASE_ID" PLAYER_SOURCE_COMMIT="$PLAYER_SOURCE_COMMIT" \
    DARSHAN_COMPATIBILITY_GENERATION="$DARSHAN_COMPATIBILITY_GENERATION" \
    node "$PLATFORM_ROOT/scripts/bundle/render-live-media-role.mjs" "$PROD_MEDIA_DIR" "$PROD_BACKEND_DIR" "$PLATFORM_ROOT"
  write_load_images_script "$PROD_MEDIA_DIR/load-images.sh"
  if [[ "$SKIP_DOCKER" == true ]]; then
    write_skip_placeholder "$PROD_MEDIA_DIR/images" "$(basename "$archive")" "$MEDIA_IMAGE"
  else
    write_image_metadata_manifest "$PROD_MEDIA_DIR/images" "$(basename "$archive")" "$MEDIA_IMAGE"
  fi
  chmod 750 "$PROD_MEDIA_DIR"/*.sh "$PROD_MEDIA_DIR"/*.py
}
