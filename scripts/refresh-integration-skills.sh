#!/usr/bin/env bash
# Refresh bundled integration skills.
#
# Local dev mode (default when sibling context-hub/dist/skills exists):
#   Reads ZIPs from the sibling context-hub repo after running 'pnpm build' there.
#   Override: CONTEXT_HUB_DIST=/path/to/dist/skills
#
# Remote mode (CI / no local build):
#   Pulls integration-*.zip from the latest amplitude/context-hub GitHub release.
#   Requires the GitHub CLI (gh) to be installed and authenticated.
#
# Usage:
#   pnpm skills:refresh:integration
#   CONTEXT_HUB_DIST=/path/to/dist/skills pnpm skills:refresh:integration

set -euo pipefail

REPO="amplitude/context-hub"
WIZARD_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_BASE="$WIZARD_ROOT/skills/integration"
DEFAULT_LOCAL_DIST="$WIZARD_ROOT/../context-hub/dist/skills"

# Prefer local dist if it exists (or an explicit override is set)
if [[ -n "${CONTEXT_HUB_DIST:-}" ]]; then
  SOURCE_DIR="$CONTEXT_HUB_DIST"
  echo "Refreshing integration skills from $SOURCE_DIR..."
  use_local=true
elif [[ -d "$DEFAULT_LOCAL_DIST" ]]; then
  SOURCE_DIR="$DEFAULT_LOCAL_DIST"
  echo "Refreshing integration skills from local context-hub ($SOURCE_DIR)..."
  use_local=true
else
  use_local=false
fi

rm -rf "$LOCAL_BASE"
mkdir -p "$LOCAL_BASE"

if [[ "$use_local" == "true" ]]; then
  count=0
  for zip in "$SOURCE_DIR"/integration-*.zip; do
    [[ -f "$zip" ]] || continue
    skill_id="$(basename "$zip" .zip)"
    mkdir -p "$LOCAL_BASE/$skill_id"
    unzip -q -o "$zip" -d "$LOCAL_BASE/$skill_id"
    echo "  extracted $skill_id"
    ((count++))
  done
  echo "Done. $count integration skills refreshed."
else
  TMP_DIR=$(mktemp -d)
  trap "rm -rf '$TMP_DIR'" EXIT

  echo "Refreshing integration skills from $REPO (latest release)..."
  LATEST_TAG=$(gh api "repos/$REPO/releases/latest" --jq '.tag_name')
  echo "Latest release: $LATEST_TAG"

  cd "$TMP_DIR"
  gh release download "$LATEST_TAG" --repo "$REPO" --pattern "integration-*.zip" --clobber

  count=0
  for zip in integration-*.zip; do
    skill_id="${zip%.zip}"
    mkdir -p "$LOCAL_BASE/$skill_id"
    unzip -q "$zip" -d "$LOCAL_BASE/$skill_id"
    echo "  extracted $skill_id"
    ((count++))
  done
  echo "Done. $count integration skills refreshed."
fi
