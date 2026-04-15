#!/usr/bin/env bash
# Refresh all bundled skills from context-hub.
#
# context-hub is the single source of truth for all wizard skills:
#   - integration/*  (generated from transformation-config + example apps)
#   - instrumentation/* (sourced from amplitude/mcp-marketplace via context-hub)
#   - taxonomy/*     (maintained in context-hub/skills/taxonomy/)
#
# Local dev mode (default when sibling context-hub/dist/skills exists):
#   Build context-hub first: cd ../context-hub && pnpm build
#   Then run this script — it reads ZIPs from that local build.
#   Override: CONTEXT_HUB_DIST=/path/to/dist/skills
#
# Remote mode (CI / no local build):
#   Pulls all skill ZIPs from the latest amplitude/context-hub GitHub release.
#   Requires the GitHub CLI (gh) to be installed and authenticated.
#
# Usage:
#   pnpm skills:refresh
#   CONTEXT_HUB_DIST=/path/to/dist/skills pnpm skills:refresh

set -euo pipefail

REPO="amplitude/context-hub"
WIZARD_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_ROOT="$WIZARD_ROOT/skills"
DEFAULT_LOCAL_DIST="$WIZARD_ROOT/../context-hub/dist/skills"

# skill-menu.json category → local subdirectory mapping
# Only categories listed here will be extracted
CATEGORIES=(integration instrumentation taxonomy)

# Prefer local dist if it exists (or an explicit override is set)
if [[ -n "${CONTEXT_HUB_DIST:-}" ]]; then
  SOURCE_DIR="$CONTEXT_HUB_DIST"
  use_local=true
elif [[ -d "$DEFAULT_LOCAL_DIST" ]]; then
  SOURCE_DIR="$DEFAULT_LOCAL_DIST"
  use_local=true
else
  use_local=false
fi

extract_zip() {
  local zip="$1"
  local skill_id
  skill_id="$(basename "$zip" .zip)"

  # Determine category from skill-menu.json if available, else use prefix matching
  local dest=""
  for cat in "${CATEGORIES[@]}"; do
    if [[ "$skill_id" == ${cat}-* || "$skill_id" == amplitude-* && "$cat" == "taxonomy" || "$cat" == "instrumentation" ]]; then
      :
    fi
  done

  # Route by skill-menu category using the skill_id prefix
  if [[ "$skill_id" == integration-* ]]; then
    dest="$SKILLS_ROOT/integration/$skill_id"
  elif [[ "$skill_id" == amplitude-quickstart-taxonomy-agent || "$skill_id" == amplitude-chart-dashboard-plan ]]; then
    dest="$SKILLS_ROOT/taxonomy/$skill_id"
  elif [[ "$skill_id" == add-analytics-instrumentation || "$skill_id" == diff-intake || \
          "$skill_id" == discover-analytics-patterns || "$skill_id" == discover-event-surfaces || \
          "$skill_id" == instrument-events ]]; then
    dest="$SKILLS_ROOT/instrumentation/$skill_id"
  else
    return 0  # skip unknown skills
  fi

  mkdir -p "$dest"
  unzip -q -o "$zip" -d "$dest"
  echo "  extracted $skill_id"
}

# Clear existing skill directories managed by context-hub
for cat in "${CATEGORIES[@]}"; do
  rm -rf "${SKILLS_ROOT:?}/$cat"
  mkdir -p "$SKILLS_ROOT/$cat"
done

count=0

if [[ "$use_local" == "true" ]]; then
  echo "Refreshing all skills from local context-hub ($SOURCE_DIR)..."
  for zip in "$SOURCE_DIR"/*.zip; do
    [[ -f "$zip" ]] || continue
    [[ "$(basename "$zip")" == manifest.json ]] && continue
    extract_zip "$zip" && ((count++)) || true
  done
else
  TMP_DIR=$(mktemp -d)
  trap "rm -rf '$TMP_DIR'" EXIT

  echo "Refreshing all skills from $REPO (latest release)..."
  LATEST_TAG=$(gh api "repos/$REPO/releases/latest" --jq '.tag_name')
  echo "Latest release: $LATEST_TAG"

  cd "$TMP_DIR"
  # Download all skill ZIPs (integration, instrumentation, taxonomy)
  gh release download "$LATEST_TAG" --repo "$REPO" --pattern "*.zip" --clobber

  for zip in *.zip; do
    [[ "$zip" == skills-mcp-resources.zip ]] && continue
    extract_zip "$zip" && ((count++)) || true
  done
fi

echo "Done. $count skills refreshed."
