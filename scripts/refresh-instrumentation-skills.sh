#!/usr/bin/env bash
# Refresh bundled instrumentation skills from amplitude/mcp-marketplace.
# Requires the GitHub CLI (gh) to be installed and authenticated.
#
# By default fetches SKILL.md from the repository's default branch tip.
# Pin for reproducible CI or release branches:
#   MCP_MARKETPLACE_REF=<tag-or-sha> pnpm skills:refresh:instrumentation
#
# Usage:
#   bash scripts/refresh-instrumentation-skills.sh

set -euo pipefail

REPO="amplitude/mcp-marketplace"
REMOTE_BASE="plugins/amplitude/skills"
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
  local api_path="repos/$REPO/contents/$remote_path"
  if [[ -n "${MCP_MARKETPLACE_REF:-}" ]]; then
    api_path="${api_path}?ref=${MCP_MARKETPLACE_REF}"
  fi
  gh api "$api_path" --jq '.content' | base64 -d > "$local_path"
  echo "  fetched $remote_path"
}

if [[ -n "${MCP_MARKETPLACE_REF:-}" ]]; then
  echo "Refreshing instrumentation skills from $REPO (ref: $MCP_MARKETPLACE_REF)..."
else
  echo "Refreshing instrumentation skills from $REPO (default branch)..."
fi

for skill in "${SKILLS[@]}"; do
  echo "[$skill]"
  fetch_file "$REMOTE_BASE/$skill/SKILL.md" "$LOCAL_BASE/$skill/SKILL.md"
done

echo "Done."
