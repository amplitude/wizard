/**
 * safety-scanner — L2 enforcement layer for agent-emitted content and commands.
 *
 * The wizard relies on prompt-level "commandments" (`src/lib/commandments.ts`)
 * to instruct the model not to hardcode secrets, run destructive shell
 * commands, etc. — that's L0. Models occasionally violate L0. This module
 * adds an L2 regex layer that runs as a hook on every Write/Edit (content)
 * and Bash (command) tool use, so the wizard catches violations the
 * commandments missed.
 *
 * Scope of v1:
 *   - {@link scanWriteContentForSecrets}: scan Write/Edit content for
 *     hardcoded Amplitude API keys and OAuth-shaped JWTs. Match → emit a
 *     PostToolUse `additionalContext` that nudges the model to revert and
 *     use an env-var pattern. Does not block the write (it already
 *     happened); the goal is self-correction on the next turn.
 *
 *   - {@link scanBashCommandForDestructive}: scan Bash commands for the
 *     specific destructive patterns the wizard never wants to run
 *     (rm -rf on broad paths, git reset --hard, force-push, broad
 *     git checkout/restore/clean). Match → emit a PreToolUse `deny` with a
 *     specific "this is destructive, abandon this path" message instead of
 *     the generic "command not in allowlist" deny from `wizardCanUseTool`.
 *     The specific message stops the model from looping through rephrased
 *     variants of the same destructive intent.
 *
 * Fail-closed: callers should treat a thrown exception as a block
 * decision. Regex compilation is at module load, so runtime exceptions
 * here would only come from pathological input (e.g. enormous strings
 * exceeding regex backtracking budget) — and on those, blocking is the
 * right call.
 */

/**
 * A safety rule matched against agent-emitted content. Each rule has a
 * stable identifier so analytics can aggregate violations by rule
 * regardless of message wording, and a human-readable message that's
 * forwarded to the model on a match.
 */
export interface SafetyRule {
  /** Stable rule ID — analytics key. lowercase-with-spaces to match the
   *  wider analytics convention (see CLAUDE.md). */
  id: string;
  /** Short label for log output. */
  label: string;
  /** Pattern to match against the input. */
  pattern: RegExp;
  /** Message surfaced to the model on a match. Should describe what was
   *  matched and what the model should do instead. */
  message: string;
}

export interface ScanResult {
  matched: boolean;
  rule?: SafetyRule;
}

// ── Hardcoded-secret rules ────────────────────────────────────────────────
//
// Context-keyed: matching just `[a-f0-9]{32}` would hit every git SHA, MD5,
// and API-key-shaped string in the codebase. We anchor to the surrounding
// assignment idiom (`apiKey: '...'`, `AMPLITUDE_API_KEY=...`,
// `projectApiKey: "..."`) so false positives are minimal.
//
// Why these specific shapes:
//   - `e5a2c9bdffe949f7da77e6b481e118fa` is the literal format the wizard
//     itself uses — both the prod-telemetry key and any project key the
//     agent might inline (a non-redacted leak).
//   - Bearer JWTs (`eyJ...`) cover OAuth tokens and any Amplitude-issued
//     bearer; matching here is independent of context because the JWT
//     header literal is unique enough on its own.

const SECRET_RULES: SafetyRule[] = [
  {
    id: 'hardcoded amplitude api key',
    label: 'amplitude-api-key',
    pattern:
      /(?:api[_-]?key|amplitudeapikey|amplitude_api_key|projectapikey|project_api_key)\s*[:=]\s*['"]?([a-f0-9]{32})['"]?/i,
    message:
      'A 32-character hex string was written into an `apiKey`/`projectApiKey` assignment. Amplitude project keys must NEVER be hardcoded into source. Replace this with an environment variable read (e.g. `process.env.AMPLITUDE_API_KEY`) and use the wizard-tools `set_env_values` MCP tool to write the value to .env.local. Then revert this file change before continuing.',
  },
  {
    id: 'hardcoded jwt token',
    label: 'jwt-token',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    message:
      'A JWT-shaped bearer token was written into source. Bearer tokens (OAuth access tokens, signed credentials) must never be committed. Replace with an environment variable read and revert this file change before continuing.',
  },
];

// ── Destructive-bash rules ────────────────────────────────────────────────
//
// These are the patterns the wizard NEVER wants to run, regardless of how
// the agent phrases them. The existing `wizardCanUseTool` allowlist already
// rejects these (rm/git aren't in the package-manager allowlist), but its
// generic deny message — "command not in allowlist" — invites the model to
// retry with rephrased variants of the same destructive intent. A specific
// "this is destructive policy, abandon this path" message stops the loop.
//
// References for what NOT to run:
//   - https://github.com/amplitude/wizard CLAUDE.md (project policy)
//   - ~/.claude/rules/git-worktree-safety.md (user-level worktree rule)

const DESTRUCTIVE_BASH_RULES: SafetyRule[] = [
  {
    id: 'destructive rm rf',
    label: 'rm-rf-broad',
    // rm -rf on / ~ . ./ or any home/system path. Excludes safe tmp/cache
    // targets that build tools legitimately remove.
    //
    // Flag-set lookahead: matches both `rm -rf` and `rm -fr` (and `-Rf`,
    // `-fR`) — agents emit these interchangeably. The double lookahead
    // requires both `[rR]` and `f` to appear somewhere in the flag chars,
    // in any order.
    pattern:
      /\brm\s+-(?=[a-zA-Z]*[rR])(?=[a-zA-Z]*f)[a-zA-Z]+\s+(\/(?!tmp\b|var\/(?:folders|tmp|log)\b)|~|\$HOME\b|\.{1,2}(?:\s|\/|$))/,
    message:
      'Recursive `rm -rf` against `/`, `~`, `.`, or `..` is permanently denied by wizard policy regardless of phrasing. This is not a retry-with-different-flags situation — abandon this approach. If you genuinely need to clean a build artifact, target the specific subdirectory (e.g. `dist/`) explicitly. If you need to remove a single file, use a targeted path. If neither applies, document the limitation in the setup report and proceed.',
  },
  {
    id: 'destructive git reset hard',
    label: 'git-reset-hard',
    // `git reset --hard` (with or without a ref) wipes unstaged work.
    pattern: /\bgit\s+reset\s+--hard\b/,
    message:
      '`git reset --hard` is permanently denied — it silently destroys uncommitted user work, which often exists in NO branch and is NOT pushed anywhere. Recovery may not be possible. Do not retry with a different ref. If you need to revert a single file you yourself just modified, use `git checkout HEAD -- <specific-file>` (never `.` or a broad path). If you need a clean tree, use `git stash push --include-untracked -m "<reason>"` and pop when done.',
  },
  {
    id: 'destructive force push',
    label: 'git-force-push',
    // `git push --force` and `git push -f`. Allows `--force-with-lease`,
    // which is meaningfully safer (refuses to clobber remote tip the
    // local doesn\'t know about).
    pattern: /\bgit\s+push\s+(?:--force(?!-with-lease)|-f\b)/,
    message:
      "`git push --force` is permanently denied — it can wipe other contributors' commits on the remote. If you genuinely need to rewrite published history (rare in a wizard run), use `--force-with-lease` instead, but more often this means the wizard is on the wrong branch or has accidentally rewritten local history. Stop and document the situation in the setup report.",
  },
  {
    id: 'destructive git checkout broad',
    label: 'git-checkout-broad',
    // `git checkout -- .` / `git checkout HEAD -- .` and friends. Broad
    // targets wipe any matching unstaged file. Specific paths are fine
    // and not matched here.
    pattern:
      /\bgit\s+checkout\s+(?:[A-Za-z0-9_/.@^~-]+\s+)?--\s+(?:\.{1,2}|\*)(?:\s|$)/,
    message:
      '`git checkout -- .` (or with a broad path) is permanently denied — it silently overwrites every unstaged change, destroying user work that may exist in no branch. To revert a single file, use `git checkout HEAD -- <specific-file>` with an explicit path. To get a clean tree, use `git stash push --include-untracked` and pop when done.',
  },
  {
    id: 'destructive git restore broad',
    label: 'git-restore-broad',
    // `git restore .` / `git restore --source <ref> .`. Same blast radius
    // as broad git checkout above.
    pattern: /\bgit\s+restore\s+(?:--source[= ]\S+\s+)?(?:\.{1,2}|\*)(?:\s|$)/,
    message:
      '`git restore` against `.` (or a broad path) is permanently denied — it silently overwrites every unstaged change. Use a specific filename if you need to revert one file, or `git stash push --include-untracked` if you need a clean tree.',
  },
  {
    id: 'destructive git clean force',
    label: 'git-clean-force',
    // `git clean -f` and combinations: -fd, -fdx, -fxd, etc.
    pattern: /\bgit\s+clean\s+-[a-z]*f/,
    message:
      '`git clean -f` is permanently denied — it deletes every untracked file, which often includes uncommitted user work. Do not retry with different flags. Use `git stash push --include-untracked` to set work aside safely, then `stash pop` when done.',
  },
  {
    id: 'destructive curl pipe shell',
    label: 'curl-pipe-shell',
    // `curl ... | bash` / `curl ... | sh` / `wget ... | bash`. Running
    // remote scripts unverified in the user\'s repo context is a
    // supply-chain risk regardless of intent.
    pattern: /\b(?:curl|wget)\s[^|]*\|\s*(?:bash|sh|zsh)\b/,
    message:
      "Piping `curl`/`wget` output into a shell is permanently denied — it executes arbitrary remote code in the user's repository, which is a supply-chain risk even if the URL looks legitimate. If a setup step requires a binary or script, install via the user's package manager (npm/pnpm/brew/pip) so the lockfile records what was installed.",
  },
];

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Scan Write/Edit content for hardcoded secrets. Returns the first matched
 * rule, or `{ matched: false }` if no rule fires.
 *
 * Returning the FIRST match (not all matches) keeps the model-facing
 * message focused on one fix — telling the agent it has three problems at
 * once tends to produce sprawling un-targeted edits.
 */
export function scanWriteContentForSecrets(content: string): ScanResult {
  if (typeof content !== 'string' || content.length === 0) {
    return { matched: false };
  }
  for (const rule of SECRET_RULES) {
    if (rule.pattern.test(content)) {
      return { matched: true, rule };
    }
  }
  return { matched: false };
}

/**
 * Scan a Bash command for destructive patterns. Returns the first matched
 * rule, or `{ matched: false }` if no rule fires.
 */
export function scanBashCommandForDestructive(command: string): ScanResult {
  if (typeof command !== 'string' || command.length === 0) {
    return { matched: false };
  }
  for (const rule of DESTRUCTIVE_BASH_RULES) {
    if (rule.pattern.test(command)) {
      return { matched: true, rule };
    }
  }
  return { matched: false };
}

// Exported for tests so the rule sets can be exercised exhaustively
// without re-deriving them.
export const __INTERNAL_RULES = {
  secrets: SECRET_RULES,
  destructiveBash: DESTRUCTIVE_BASH_RULES,
};
