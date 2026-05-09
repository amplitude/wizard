/**
 * claude-settings-scope — Non-destructive scoping of Claude Code settings.
 *
 * Why this exists
 *
 *   The Claude Agent SDK loads `.claude/settings.json` from the working
 *   directory whenever `settingSources: ['project']` is set (we need that
 *   for `.claude/skills/` to be discovered). Anything that file declares
 *   under `env` is then injected into the spawned `claude-code` subprocess,
 *   overriding whatever env we explicitly passed to the SDK.
 *
 *   For users who keep a `.claude/settings.json` checked into their repo
 *   with `ANTHROPIC_BASE_URL` (LiteLLM, corporate proxy, custom gateway,
 *   Claude Pro/Max OAuth, etc.) — i.e. the *typical* Claude Code user on
 *   any team larger than one — that overrides the wizard's Amplitude LLM
 *   gateway URL and the wizard can no longer authenticate. The previous
 *   recovery flow (`SettingsOverrideScreen`) "fixed" this by moving the
 *   user's checked-in `.claude/settings.json` to `.wizard-backup` and
 *   running without it. That was destructive (any non-graceful exit lost
 *   the file) AND hostile (it asked permission to disturb a config the
 *   user had deliberately set up for their tooling).
 *
 * What this module does instead
 *
 *   The SDK's settings precedence is: `local` > `project` > `user`. We
 *   write our wizard-managed env override into `.claude/settings.local.json`
 *   — the *machine-local, gitignored* settings layer — and add `'local'`
 *   to `settingSources`. Local wins, the wizard reaches its gateway, and
 *   the user's checked-in `.claude/settings.json` is untouched on disk
 *   for the entire run.
 *
 *   We also preserve any pre-existing `.claude/settings.local.json` the
 *   user might already have (uncommon for projects, but possible), by
 *   loading it, deep-merging our `env` keys into its existing `env`, and
 *   restoring the original content on exit. If no file existed, we delete
 *   ours on exit. Both paths register as a wizard cleanup so they fire on
 *   any termination (success, cancel, crash).
 *
 *   Result: zero user prompts, zero data-loss risk, and the wizard works
 *   for every Claude Code user — including the ones who route through a
 *   custom gateway.
 */

import * as fs from 'fs';
import path from 'path';
import { atomicWriteJSON } from '../utils/atomic-write.js';
import { logToFile } from '../utils/debug.js';

/**
 * The exact set of env keys we override at the local-settings layer. Kept
 * narrow on purpose: anything we don't *need* to override stays whatever
 * the user configured at the project layer.
 *
 *   - `ANTHROPIC_BASE_URL` — points the SDK at the Amplitude LLM gateway
 *     (instead of e.g. the user's LiteLLM proxy or Anthropic direct).
 *   - `ANTHROPIC_AUTH_TOKEN` — the wizard's session-scoped bearer token.
 *   - `CLAUDE_CODE_OAUTH_TOKEN` — overrides any stored `/login` credential
 *     so the SDK doesn't accidentally use the user's personal Claude
 *     subscription token to talk to our gateway.
 *   - `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` — disables beta headers our
 *     gateway doesn't accept.
 *
 *   Note that `ANTHROPIC_API_KEY` is intentionally NOT scoped here. Users
 *   running with a direct Anthropic key bypass the gateway entirely (see
 *   `agent-interface.ts:useDirectApiKey`); for them this whole module is
 *   a no-op.
 */
const SCOPED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
] as const;

type ScopedEnvKey = (typeof SCOPED_ENV_KEYS)[number];

/**
 * Auto-compact window (in tokens) the wizard requests for the inner SDK
 * conversation. Sized for Sonnet 4.6's 1M context window, which is GA at
 * the standard $3/$15 pricing tier (no `context-1m-2025-08-07` beta header
 * required — Anthropic retired that beta for 4.5 on 2026-04-30, and 4.6
 * gets 1M natively). Raising this to 750K means compaction effectively
 * never fires on a normal-sized run: the SDK applies a safety cushion
 * under the configured ceiling, so the practical first-compaction
 * watermark moves from ~87K (under the prior 120K) to ~700K (under 750K),
 * which is past the working size of every wizard run we've measured.
 *
 * Why this matters: the prior 120K was set after the May 2026 reliability
 * audit caught compaction at `pre_tokens: 168,943` losing a load-bearing
 * user-feedback turn ("More funny names"). Lowering the threshold
 * traded summary fidelity for frequency — but on Excalidraw-class runs
 * that meant ~14 compactions × ~80s each = ~160s of stalled wall-clock
 * per run (~30% of agent runtime). With Sonnet 4.6's 1M window we can
 * stop compacting altogether on the runs we care about, which is
 * strictly better than tuning the summary trigger: no compaction means
 * no summary loss at all.
 *
 * Override via `AMPLITUDE_WIZARD_COMPACTION_WINDOW` (set to `0` or
 * `disable` to opt out and use the SDK default).
 *
 * Note: only effective when the user's `.claude/settings.json` doesn't
 * also set `autoCompactWindow` at the project layer (settings-local
 * wins over project, project wins over user — same precedence as the
 * env block above).
 */
const DEFAULT_AUTO_COMPACT_WINDOW = 750_000;

/**
 * Marker written alongside `autoCompactWindow` so the next wizard run can
 * recognise its own prior write and re-stamp with the current default.
 *
 * Why this exists: pre-#634 wizard runs (default = 120_000) wrote the
 * value into `.claude/settings.local.json` with no way to distinguish the
 * wizard's own write from a deliberate user override. The "respect prior
 * value" guard then refused to upgrade those stale 120K values when
 * #634 raised the default to 750K — leaving every affected user stuck
 * with compaction firing at ~88K tokens (120K × 0.73 SDK safety cushion)
 * for 4–6 unnecessary compactions per Excalidraw-class run, ~100s each.
 *
 * The fix: write this marker any time the wizard owns the value. On the
 * next run, presence of the marker is unambiguous proof that the wizard
 * (not the user) put the value there, so it's safe to overwrite with the
 * current default.
 *
 * The marker key is intentionally underscore-prefixed and verbose so it
 * never collides with a real Claude Code SDK setting.
 *
 * Lifetime: this lives in the file ONLY while the wizard owns it. The
 * restore-on-exit path rewrites the user's original raw bytes verbatim,
 * which never contained the marker — so an untouched user file never
 * sees a wizard-internal key persisted.
 */
const WIZARD_MANAGED_MARKER = '_wizardManagedAutoCompact' as const;

/**
 * Highest `autoCompactWindow` value any pre-#634 wizard ever wrote
 * (the historical default before 1M-context support landed). We treat
 * unmarked values at or below this ceiling as "almost certainly a stale
 * wizard write" and upgrade them. Anything above 200K is treated as a
 * deliberate user customisation and respected, even without a marker.
 */
const PRE_634_WIZARD_CEILING = 200_000;

/**
 * Resolve the wizard's auto-compact-window override. Returns `null`
 * when the override is explicitly disabled (env=`0` / `disable` / `off`)
 * so the caller skips writing the key entirely. Invalid env values fall
 * back to the default — better to keep the safety net than refuse to
 * boot on a typo.
 */
function resolveAutoCompactWindow(): number | null {
  const raw = process.env.AMPLITUDE_WIZARD_COMPACTION_WINDOW;
  if (raw === undefined || raw === '') return DEFAULT_AUTO_COMPACT_WINDOW;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '0' || trimmed === 'disable' || trimmed === 'off') {
    return null;
  }
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return DEFAULT_AUTO_COMPACT_WINDOW;
}

/** Minimal shape we care about. Everything else is preserved verbatim. */
interface ClaudeSettingsLocal {
  env?: Record<string, string | undefined>;
  /**
   * SDK's auto-compact threshold (tokens). Documented on the bundled
   * `Settings` type in `@anthropic-ai/claude-agent-sdk`. We write this
   * to lower the compaction trigger from "near 200K" to a more
   * conservative window — see `DEFAULT_AUTO_COMPACT_WINDOW` above.
   */
  autoCompactWindow?: number;
  /**
   * Internal marker — when `true`, the value of `autoCompactWindow` was
   * written by a prior wizard run (not by the user). The wizard treats
   * this as its own value and re-stamps it with the current default on
   * the next run. See `WIZARD_MANAGED_MARKER` for the full rationale.
   */
  _wizardManagedAutoCompact?: boolean;
  [key: string]: unknown;
}

/** Tracks what we wrote and how to undo it. */
export interface ScopedSettingsHandle {
  /** Absolute path to `.claude/settings.local.json` we wrote to. */
  filePath: string;
  /** Restore the file (or delete if it didn't exist) to its pre-wizard state. */
  restore: () => void;
}

/**
 * Build the env block we need the SDK subprocess to see.
 *
 * Pulls values from the parent's `process.env` (which `agent-interface.ts`
 * has already populated with the gateway URL + bearer). Skips undefined /
 * empty values so we don't write null entries into the user's local
 * settings. Returns null if there's nothing to scope (e.g. direct API
 * key path, where the gateway env vars aren't set).
 */
function collectEnvOverride(): Partial<Record<ScopedEnvKey, string>> | null {
  const env: Partial<Record<ScopedEnvKey, string>> = {};
  for (const key of SCOPED_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value;
    }
  }
  return Object.keys(env).length > 0 ? env : null;
}

/**
 * Read `.claude/settings.local.json` if it exists. Returns the parsed
 * contents on success, or `null` if the file doesn't exist / isn't valid
 * JSON. We deliberately don't throw on parse errors — the user might have
 * a stray hand-edited file we don't want to crash on. In the unhealthy
 * case we treat it as "no prior settings" and overwrite, but we ALSO
 * stash the raw bytes so `restore()` can put it back exactly as we found
 * it (preserving even invalid content).
 */
function readSettingsLocal(filePath: string): {
  parsed: ClaudeSettingsLocal | null;
  raw: string | null;
} {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { parsed: parsed as ClaudeSettingsLocal, raw };
      }
      // JSON valid but not an object (e.g. `null`, `42`, `[]`). Preserve
      // the raw bytes for restoration but treat as no-prior for merging.
      return { parsed: null, raw };
    } catch {
      // Invalid JSON — preserve raw, treat as no-prior.
      return { parsed: null, raw };
    }
  } catch {
    // ENOENT or unreadable — file effectively doesn't exist.
    return { parsed: null, raw: null };
  }
}

/**
 * Write `.claude/settings.local.json` with the wizard's env override merged
 * into any pre-existing content, and return a `restore()` callback that
 * undoes the write.
 *
 *   - If the file did NOT exist before, restore() deletes it (and the
 *     `.claude/` dir if we created it and it's now empty).
 *   - If the file DID exist, restore() rewrites the original raw bytes.
 *     We use raw bytes (not re-serialized JSON) so we preserve user
 *     formatting / comments / whitespace exactly.
 *
 * Returns null when there's nothing to scope — in which case the caller
 * should NOT add `'local'` to `settingSources` (no point loading an empty
 * layer).
 *
 * No-throw contract: any IO failure here is logged and surfaces as a
 * null return so the wizard falls back to the previous behavior (the
 * subprocess will use whatever the project settings.json says, which
 * the gateway will reject — the user gets the standard auth-error path
 * rather than a worse mid-run failure).
 */
export function applyScopedSettings(
  workingDirectory: string,
): ScopedSettingsHandle | null {
  const envOverride = collectEnvOverride();
  if (!envOverride) {
    logToFile('claude-settings-scope: no scoped env to write — skipping');
    return null;
  }

  const claudeDir = path.join(workingDirectory, '.claude');
  const filePath = path.join(claudeDir, 'settings.local.json');

  // Track whether `.claude/` existed before we touched it so restore()
  // can clean up on the file-didn't-exist path. mkdirSync below is
  // idempotent; the `existed` snapshot is what matters for cleanup.
  let claudeDirExisted = true;
  try {
    fs.statSync(claudeDir);
  } catch {
    claudeDirExisted = false;
  }
  try {
    fs.mkdirSync(claudeDir, { recursive: true });
  } catch (err) {
    logToFile('claude-settings-scope: mkdir failed', err);
    return null;
  }

  const { parsed: prior, raw: priorRaw } = readSettingsLocal(filePath);

  // Deep-merge env: preserve every key the user already had, only
  // overwriting the specific gateway-routing keys we manage. Anything
  // else in the file (permissions, hooks, model, plugins, …) is copied
  // through unchanged.
  const mergedEnv: Record<string, string | undefined> = {
    ...(prior?.env ?? {}),
    ...envOverride,
  };
  const merged: ClaudeSettingsLocal = {
    ...(prior ?? {}),
    env: mergedEnv,
  };

  // Set / upgrade the SDK's auto-compact threshold so compaction effectively
  // never fires on a normal-sized run with Sonnet 4.6's 1M context. The
  // tricky bit is deciding when an existing value in the prior file is the
  // wizard's own stale write vs. a deliberate user customisation:
  //
  //   1. Marker present (`_wizardManagedAutoCompact: true`)
  //        → unambiguously wizard-owned. Re-stamp with current default.
  //          This is the path that fixes the pre-#634 stale-120K bug for
  //          everyone going forward.
  //   2. Marker absent + value ≤ PRE_634_WIZARD_CEILING (200K)
  //        → almost certainly a stale wizard write from before the marker
  //          existed (the historical default was 120K; the wizard never
  //          shipped a default above 200K). Upgrade with a one-time log
  //          so the change is visible in `~/.amplitude/wizard/runs/.../log.txt`.
  //   3. Marker absent + value > 200K
  //        → the user set a window the wizard never would have. Respect it.
  //          (Same as the original "respect prior value" semantics.)
  //   4. No prior value at all
  //        → write the default + marker.
  //
  // In every "wizard owns this" path we also stamp the marker so future
  // runs follow path (1) instead of having to guess again via path (2).
  // The restore-on-exit path rewrites the user's original raw bytes
  // verbatim, so the marker never persists past the wizard's lifetime.
  const autoCompactWindow = resolveAutoCompactWindow();
  if (autoCompactWindow === null) {
    logToFile(
      'claude-settings-scope: autoCompactWindow override disabled via env',
    );
  } else {
    const priorValue = prior?.autoCompactWindow;
    const priorMarker = prior?.[WIZARD_MANAGED_MARKER] === true;
    const noPrior = priorValue === undefined;
    const wizardOwned = priorMarker;
    const looksStale =
      !priorMarker &&
      typeof priorValue === 'number' &&
      priorValue <= PRE_634_WIZARD_CEILING;

    if (noPrior || wizardOwned) {
      merged.autoCompactWindow = autoCompactWindow;
      merged[WIZARD_MANAGED_MARKER] = true;
      logToFile(
        wizardOwned
          ? `claude-settings-scope: re-stamping wizard-managed autoCompactWindow=${autoCompactWindow} (was ${priorValue})`
          : `claude-settings-scope: setting autoCompactWindow=${autoCompactWindow}`,
      );
    } else if (looksStale) {
      merged.autoCompactWindow = autoCompactWindow;
      merged[WIZARD_MANAGED_MARKER] = true;
      logToFile(
        `claude-settings-scope: upgrading stale unmarked autoCompactWindow ${priorValue} -> ${autoCompactWindow} (≤ ${PRE_634_WIZARD_CEILING}; treating as pre-#634 wizard write)`,
      );
    } else {
      logToFile(
        `claude-settings-scope: respecting user autoCompactWindow=${priorValue}`,
      );
    }
  }

  try {
    atomicWriteJSON(filePath, merged);
    logToFile('claude-settings-scope: wrote', filePath);
  } catch (err) {
    logToFile('claude-settings-scope: write failed', err);
    return null;
  }

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    try {
      if (priorRaw === null) {
        // We created the file; delete it.
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Already gone — fine.
        }
        if (!claudeDirExisted) {
          // We also created `.claude/`. Remove it only if it's empty;
          // the agent may have written skills into `.claude/skills/`
          // during the run and those should be preserved (they're how
          // the wizard's resumability works).
          try {
            const entries = fs.readdirSync(claudeDir);
            if (entries.length === 0) {
              fs.rmdirSync(claudeDir);
            }
          } catch {
            // Best-effort.
          }
        }
      } else {
        // File existed; rewrite the original bytes verbatim.
        fs.writeFileSync(filePath, priorRaw);
      }
      logToFile('claude-settings-scope: restored', filePath);
    } catch (err) {
      logToFile('claude-settings-scope: restore failed', err);
    }
  };

  return { filePath, restore };
}
