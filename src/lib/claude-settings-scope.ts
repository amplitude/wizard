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
 *   Result: zero user prompts, zero data-loss risk, the wizard works for
 *   every Claude Code user — including the ones who route through a
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

/** Minimal shape we care about. Everything else is preserved verbatim. */
interface ClaudeSettingsLocal {
  env?: Record<string, string | undefined>;
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
