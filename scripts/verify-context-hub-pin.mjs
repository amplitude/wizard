#!/usr/bin/env node
/**
 * Verify the pinned context-hub release tag in .context-hub-version exists
 * on amplitude/context-hub. Wire this into CI to fail loudly if a developer
 * mis-types a tag or pins to a release that was deleted.
 *
 * Token model:
 *   - Local dev: uses `gh api` if available (auth-aware) or unauthenticated REST.
 *   - CI: prefers `CONTEXT_HUB_RO_TOKEN` (a PAT with read access to the
 *     private context-hub repo) and falls back to `GITHUB_TOKEN`. The default
 *     `GITHUB_TOKEN` is repo-scoped and CANNOT read a sibling private repo,
 *     so without `CONTEXT_HUB_RO_TOKEN` the release lookup will 404 even when
 *     the tag exists. We disambiguate "tag really missing" from "token can't
 *     see the repo" by probing `repos/{owner}/{name}` first:
 *       - repo lookup 404 → can't see the repo → soft-warn, exit 0
 *       - repo lookup ok but tag 404 → real missing-tag → hard-fail, exit 1
 *
 * Exit codes:
 *   0 — pin is valid and exists on the remote, OR token cannot see the repo
 *       (warning emitted; not treated as a CI failure)
 *   1 — pin file is missing/malformed, or the tag does not exist on a repo
 *       we CAN see, or the network/API call failed for an unexpected reason
 *
 * Ported from wizard-rewrite/scripts/context-hub/verify-pin.mjs.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const PIN_FILE = join(REPO_ROOT, ".context-hub-version");
const CONTEXT_HUB_REPO = "amplitude/context-hub";
const TAG_RE = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function readPinnedTag() {
  let raw;
  try {
    raw = readFileSync(PIN_FILE, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read context-hub pin at ${PIN_FILE}: ${err.message}. ` +
        `Create the file with a single line like "v1.2.6".`,
    );
  }
  const tag = raw.trim();
  if (!tag) {
    throw new Error(
      `${PIN_FILE} is empty. Set a context-hub release tag like "v1.2.6".`,
    );
  }
  if (!TAG_RE.test(tag)) {
    throw new Error(
      `${PIN_FILE} contains "${tag}", which is not a valid context-hub release tag. ` +
        `Expected the form vMAJOR.MINOR.PATCH (e.g. v1.2.6).`,
    );
  }
  return tag;
}

function pickToken() {
  return (
    process.env.CONTEXT_HUB_RO_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()
  );
}

function tryGh(tag) {
  const r = spawnSync(
    "gh",
    [
      "api",
      `repos/${CONTEXT_HUB_REPO}/releases/tags/${tag}`,
      "--jq",
      ".tag_name",
    ],
    { encoding: "utf8" },
  );
  // ghRan distinguishes "gh wasn't usable" (ENOENT, not authed, etc.) from
  // "gh ran and returned a definitive answer". Only the latter is trustworthy
  // enough to short-circuit the unauthenticated REST soft-pass path.
  if (r.error) {
    return {
      ok: false,
      ghRan: false,
      stderr: r.stderr ?? r.error?.message ?? "",
    };
  }
  if (r.status !== 0) {
    return {
      ok: false,
      ghRan: false,
      stderr: r.stderr ?? "",
    };
  }
  const found = (r.stdout ?? "").trim();
  return { ok: found === tag, ghRan: true, stderr: "", found };
}

async function fetchJson(path, token) {
  const url = `https://api.github.com/${path}`;
  const headers = { "User-Agent": "wizard-context-hub-verify" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    return { status: 0, error: `network error: ${err.message ?? err}` };
  }
  return { status: res.status, statusText: res.statusText, res };
}

async function repoVisible(token) {
  const r = await fetchJson(`repos/${CONTEXT_HUB_REPO}`, token);
  if (r.status === 200) return true;
  if (r.status === 404 || r.status === 401 || r.status === 403) return false;
  return null;
}

async function tryFetchRelease(tag, token) {
  const r = await fetchJson(
    `repos/${CONTEXT_HUB_REPO}/releases/tags/${tag}`,
    token,
  );
  if (r.error) return { ok: false, stderr: r.error };
  if (r.status === 404) {
    return {
      ok: false,
      status: 404,
      stderr: `release not found at https://api.github.com/repos/${CONTEXT_HUB_REPO}/releases/tags/${tag} (status 404)`,
    };
  }
  if (r.status === 401 || r.status === 403) {
    return {
      ok: false,
      status: r.status,
      stderr: `auth failure (${r.status} ${r.statusText}) — token cannot read ${CONTEXT_HUB_REPO}`,
    };
  }
  if (r.status >= 400) {
    return {
      ok: false,
      status: r.status,
      stderr: `GitHub API returned ${r.status} ${r.statusText}`,
    };
  }
  let body;
  try {
    body = await r.res.json();
  } catch (err) {
    return { ok: false, stderr: `failed to parse JSON: ${err.message ?? err}` };
  }
  return { ok: body?.tag_name === tag, found: body?.tag_name, stderr: "" };
}

async function main() {
  let tag;
  try {
    tag = readPinnedTag();
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }

  console.log(`Pinned context-hub release: ${tag}`);
  console.log(`Verifying against https://github.com/${CONTEXT_HUB_REPO} ...`);

  const ghResult = tryGh(tag);
  if (ghResult.ok) {
    console.log(`OK: ${tag} exists on ${CONTEXT_HUB_REPO} (verified via gh).`);
    return 0;
  }

  // gh ran successfully and authoritatively reported a different (or missing)
  // tag — this is a conclusive miss. Don't fall through to the REST soft-pass
  // path, which can mask a real bad pin behind "token can't see the repo".
  if (ghResult.ghRan) {
    console.error(
      `error: pinned tag "${tag}" was not found on ${CONTEXT_HUB_REPO} (gh confirmed).`,
    );
    if (ghResult.found) {
      console.error(`  gh returned tag_name="${ghResult.found}" instead.`);
    }
    if (ghResult.stderr) console.error(`  gh: ${ghResult.stderr.trim()}`);
    console.error(
      `\nFix: edit .context-hub-version to a valid release from ` +
        `https://github.com/${CONTEXT_HUB_REPO}/releases (rotate the pin to an ` +
        `existing tag), then commit the change.`,
    );
    return 1;
  }

  const token = pickToken();
  const fetchResult = await tryFetchRelease(tag, token);
  if (fetchResult.ok) {
    console.log(
      `OK: ${tag} exists on ${CONTEXT_HUB_REPO} (verified via REST API).`,
    );
    return 0;
  }

  if (
    fetchResult.status === 404 ||
    fetchResult.status === 401 ||
    fetchResult.status === 403
  ) {
    const visible = await repoVisible(token);
    if (visible === false) {
      console.warn(
        `warning: cannot verify ${tag} — current token cannot read ${CONTEXT_HUB_REPO}.`,
      );
      console.warn(
        `  Add a CONTEXT_HUB_RO_TOKEN org secret (PAT with repo:read on ${CONTEXT_HUB_REPO}) to enable strict verification.`,
      );
      console.warn(`  Skipping verification (treated as soft-pass).`);
      return 0;
    }
  }

  console.error(`error: pinned tag "${tag}" was not found on ${CONTEXT_HUB_REPO}.`);
  if (ghResult.stderr) console.error(`  gh: ${ghResult.stderr.trim()}`);
  if (fetchResult.stderr) console.error(`  rest: ${fetchResult.stderr.trim()}`);
  console.error(
    `\nFix: edit .context-hub-version to a valid release from ` +
      `https://github.com/${CONTEXT_HUB_REPO}/releases, then commit the change.`,
  );
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`unexpected error: ${err?.message ?? err}`);
    process.exit(1);
  },
);
