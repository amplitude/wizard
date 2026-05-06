#!/usr/bin/env bash
# Refresh all bundled skills from context-hub.
#
# context-hub is the single source of truth for all wizard skills:
#   - integration/*  (generated from transformation-config + example apps)
#   - instrumentation/* (sourced from amplitude/mcp-marketplace via context-hub)
#   - taxonomy/*     (maintained in context-hub/skills/taxonomy/)
#
# Source selection (in order):
#
#   1. CONTEXT_HUB_DIST=/path/to/dist/skills    (explicit local override)
#   2. WIZARD_FORCE_REMOTE_SKILLS=1             (always download from GH release,
#                                               ignore any sibling clone)
#   3. ../context-hub/dist/skills/              (sibling repo dev mode — opted
#                                               IN ONLY when explicitly chosen
#                                               via WIZARD_USE_LOCAL_SKILLS=1.
#                                               This used to be the silent
#                                               default and shipped `version: dev`
#                                               into wizard whenever a sibling
#                                               clone existed — see PR #538.)
#   4. amplitude/context-hub GitHub release at the tag pinned in
#      ./.context-hub-version  (default — reproducible across machines)
#
# Local dev workflow (recommended):
#   cd ../context-hub && pnpm build
#   cd -                               # back to wizard
#   WIZARD_USE_LOCAL_SKILLS=1 pnpm skills:refresh
#
# Remote / CI workflow (default):
#   pnpm skills:refresh                # downloads pinned GH release
#
# Bumping the pin:
#   echo "v1.2.7" > .context-hub-version
#   pnpm skills:refresh                # re-downloads with the new tag
#   git commit .context-hub-version skills/
#
# Dev-version guard:
#   By default this script REFUSES to import any SKILL.md whose
#   `version:` frontmatter is `dev`. Set WIZARD_ALLOW_DEV_SKILLS=1 to
#   skip the guard (only do this when consciously testing dev skills
#   locally — never commit the result).

set -euo pipefail

REPO="amplitude/context-hub"
WIZARD_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_ROOT="$WIZARD_ROOT/skills"
DEFAULT_LOCAL_DIST="$WIZARD_ROOT/../context-hub/dist/skills"
PIN_FILE="$WIZARD_ROOT/.context-hub-version"

# skill-menu.json category → local subdirectory mapping
# Only categories listed here will be extracted
CATEGORIES=(integration instrumentation taxonomy)

# Read pinned tag (single source of truth for which release to pull).
# Hard-fails when the pin file is missing or empty — refusing to silently
# fall back to "latest" keeps refreshes reproducible across machines and CI.
read_pinned_tag() {
  if [[ ! -f "$PIN_FILE" ]]; then
    echo "ERROR: .context-hub-version is missing at $PIN_FILE." >&2
    echo "  Create it with a single line containing a context-hub release tag," >&2
    echo "  e.g. 'echo v1.2.3 > .context-hub-version', then re-run this script." >&2
    exit 1
  fi
  local tag
  tag="$(tr -d '[:space:]' < "$PIN_FILE")"
  if [[ -z "$tag" ]]; then
    echo "ERROR: .context-hub-version is empty after trimming whitespace." >&2
    echo "  Populate $PIN_FILE with a context-hub release tag (e.g. v1.2.3)" >&2
    echo "  from https://github.com/$REPO/releases, then re-run this script." >&2
    exit 1
  fi
  echo "$tag"
}

PINNED_TAG="$(read_pinned_tag)"

# Source selection (see header comment for full precedence).
use_local=false
SOURCE_DIR=""

if [[ -n "${CONTEXT_HUB_DIST:-}" ]]; then
  SOURCE_DIR="$CONTEXT_HUB_DIST"
  use_local=true
elif [[ "${WIZARD_FORCE_REMOTE_SKILLS:-}" == "1" || "${WIZARD_FORCE_REMOTE_SKILLS:-}" == "true" ]]; then
  use_local=false
elif [[ "${WIZARD_USE_LOCAL_SKILLS:-}" == "1" || "${WIZARD_USE_LOCAL_SKILLS:-}" == "true" ]]; then
  if [[ -d "$DEFAULT_LOCAL_DIST" ]]; then
    SOURCE_DIR="$DEFAULT_LOCAL_DIST"
    use_local=true
  else
    echo "WIZARD_USE_LOCAL_SKILLS=1 but $DEFAULT_LOCAL_DIST is missing." >&2
    echo "  Run 'cd ../context-hub && pnpm build' first, or unset the flag." >&2
    exit 1
  fi
elif [[ -d "$DEFAULT_LOCAL_DIST" ]]; then
  echo "Note: detected sibling $DEFAULT_LOCAL_DIST but ignoring it." >&2
  echo "  Pass WIZARD_USE_LOCAL_SKILLS=1 to opt in to local-dev mode" >&2
  echo "  (silently using sibling clones shipped 'version: dev' into wizard — see PR #538)." >&2
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

# Refuse to ship `version: dev` skills unless explicitly allowed. Catches the
# silent regression that PR #538 hit when a sibling context-hub working copy
# was used for a refresh and the `dev` placeholder leaked into wizard skills.
guard_against_dev_versions() {
  if [[ "${WIZARD_ALLOW_DEV_SKILLS:-}" == "1" || "${WIZARD_ALLOW_DEV_SKILLS:-}" == "true" ]]; then
    echo "WIZARD_ALLOW_DEV_SKILLS=1 — skipping dev-version guard." >&2
    return 0
  fi
  local hits
  hits="$(grep -rEl '^[[:space:]]*version:[[:space:]]*dev[[:space:]]*$' "$SKILLS_ROOT" 2>/dev/null || true)"
  if [[ -n "$hits" ]]; then
    echo "ERROR: refresh produced SKILL.md files with 'version: dev':" >&2
    echo "$hits" | sed 's/^/  /' >&2
    echo "" >&2
    echo "This usually means the source had unstamped dev versions — e.g. a sibling" >&2
    echo "context-hub working copy that wasn't built from a release tag. To proceed" >&2
    echo "anyway (testing only — DO NOT commit the result), set WIZARD_ALLOW_DEV_SKILLS=1." >&2
    exit 1
  fi
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

  # read_pinned_tag hard-fails when .context-hub-version is missing/empty,
  # so PINNED_TAG is guaranteed non-empty here.
  echo "Refreshing all skills from $REPO (pinned $PINNED_TAG)..."
  DOWNLOAD_TAG="$PINNED_TAG"

  cd "$TMP_DIR"
  if ! gh release download "$DOWNLOAD_TAG" --repo "$REPO" --pattern "*.zip" --clobber; then
    echo "ERROR: failed to download skill ZIPs for $DOWNLOAD_TAG from $REPO." >&2
    echo "  Check that the tag exists: https://github.com/$REPO/releases/tag/$DOWNLOAD_TAG" >&2
    exit 1
  fi

  for zip in *.zip; do
    [[ "$zip" == skills-mcp-resources.zip ]] && continue
    extract_zip "$zip" && ((count++)) || true
  done
fi

guard_against_dev_versions

echo "Done. $count skills refreshed."
