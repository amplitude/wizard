#!/usr/bin/env bash
# Refresh bundled integration skills from amplitude/context-hub latest release.
# Requires the GitHub CLI (gh) to be installed and authenticated.
# Usage: pnpm skills:refresh:integration

set -euo pipefail

REPO="amplitude/context-hub"
LOCAL_BASE="$(cd "$(dirname "$0")/.." && pwd)/skills/integration"
TMP_DIR=$(mktemp -d)

trap "rm -rf '$TMP_DIR'" EXIT

echo "Refreshing integration skills from $REPO (latest release)..."

# Resolve the latest release tag (the 'latest' alias doesn't work with gh release download)
LATEST_TAG=$(gh api "repos/$REPO/releases/latest" --jq '.tag_name')
echo "Latest release: $LATEST_TAG"

# Download all integration-*.zip assets from the latest release
cd "$TMP_DIR"
gh release download "$LATEST_TAG" --repo "$REPO" --pattern "integration-*.zip" --clobber

for zip in integration-*.zip; do
  skill_id="${zip%.zip}"
  echo "[$skill_id]"
  rm -rf "$LOCAL_BASE/$skill_id"
  mkdir -p "$LOCAL_BASE/$skill_id"
  unzip -q "$zip" -d "$LOCAL_BASE/$skill_id"
  echo "  extracted $zip"
done

echo "Done."
