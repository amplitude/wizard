#!/usr/bin/env bash
# Refresh bundled instrumentation skills from amplitude/mcp-marketplace.
# Requires the GitHub CLI (gh) to be installed and authenticated.
# Usage: pnpm skills:refresh

set -euo pipefail

REPO="amplitude/mcp-marketplace"
REMOTE_BASE="plugins/instrumentation/skills"
LOCAL_BASE="$(cd "$(dirname "$0")/.." && pwd)/skills/instrumentation"

SKILLS=(
  add-analytics-instrumentation
  diff-intake
  discover-analytics-patterns
  discover-event-surfaces
  instrument-events
)

fetch_file() {
  local remote_path="$1"
  local local_path="$2"
  mkdir -p "$(dirname "$local_path")"
  gh api "repos/$REPO/contents/$remote_path" --jq '.content' | base64 -d > "$local_path"
  echo "  fetched $remote_path"
}

echo "Refreshing instrumentation skills from $REPO..."

for skill in "${SKILLS[@]}"; do
  echo "[$skill]"
  fetch_file "$REMOTE_BASE/$skill/SKILL.md" "$LOCAL_BASE/$skill/SKILL.md"
done

# instrument-events has a references/ directory
echo "[instrument-events/references]"
fetch_file "$REMOTE_BASE/instrument-events/references/best-practices.md" \
  "$LOCAL_BASE/instrument-events/references/best-practices.md"

# discover-event-surfaces references the same best-practices.md
echo "[discover-event-surfaces/references]"
cp "$LOCAL_BASE/instrument-events/references/best-practices.md" \
   "$LOCAL_BASE/discover-event-surfaces/references/best-practices.md"
echo "  copied best-practices.md from instrument-events"

echo "Done."
