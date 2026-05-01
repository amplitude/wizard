/**
 * PathInput — controlled, shell-style path input for the IntroScreen
 * "Change directory" flow.
 *
 * Design goal: behave like a terminal prompt. Users type a path with
 * `Tab` autocompleting the trailing segment, `↑`/`↓` cycling through
 * candidate matches, `Enter` to submit, `Esc` to cancel. We replaced
 * the previous DirectoryPicker (a tree navigator) because typing-with-
 * completion is what muscle memory expects from a CLI.
 *
 * Why a custom controlled input instead of `@inkjs/ui` `TextInput`:
 *   - `TextInput` is uncontrolled and hides the intermediate value, so
 *     we can't replace the trailing segment when the user hits Tab.
 *   - We need to render a block cursor at a specific position, and we
 *     need to render candidate matches *below* the input as the user
 *     cycles. Both require owning the render.
 *
 * Performance:
 *   - `readdirSync` only fires on Tab / ↑ / ↓ — never per keystroke.
 *     Slow filesystems (network mounts, sandboxed FS layers) would
 *     otherwise lag every character.
 *   - We cache the most recent completion result keyed on the
 *     "completion stem" (everything up to and including the last `/`)
 *     so cycling with arrows is instant.
 *
 * Tilde expansion + validation goes through the shared helpers in
 * `src/utils/install-dir.ts` — this file MUST NOT duplicate that logic.
 */

import { Box, Text } from 'ink';
import { useState, useMemo, useRef, useEffect } from 'react';
import { readdirSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute as pathIsAbsolute, resolve as pathResolve } from 'node:path';

import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors, Icons } from '../styles.js';
import { shortenHomePath } from '../../../lib/workspace-analysis.js';
import {
  expandTilde,
  resolveUserPath,
  validatePath as sharedValidatePath,
  type ValidationResult,
} from '../../../utils/install-dir.js';
import { createLogger } from '../../../lib/observability/logger.js';

const log = createLogger('path-input');

export interface PathInputProps {
  /** Path to seed the input with. Shown using `~` substitution. */
  initialValue: string;
  /**
   * Called with a resolved, validated absolute path when the user
   * submits a directory that exists.
   */
  onSubmit: (absolutePath: string) => void;
  /** Called when the user presses Esc without submitting. */
  onCancel: () => void;
}

// Re-exported for backward compatibility (tests + callsites that still
// import these from `PathInput`). The canonical home is
// `src/utils/install-dir.ts`.
export { resolveUserPath };

/**
 * Validate a user-typed path. Returns a tagged union — the caller
 * renders different copy for each `reason`.
 *
 * Wraps the shared resolver but rewrites error messages to use the
 * `~`-shortened form so the inline UI stays compact. Exported for
 * unit tests + tests that pre-existed against the old PathInput.
 */
export function validatePath(input: string): ValidationResult {
  const result = sharedValidatePath(input);
  if (result.ok) return result;
  // The shared helper deliberately doesn't depend on the workspace
  // analyzer (which lives in `src/lib/`), so its error messages
  // contain the raw absolute path. Rewrite that to its `~`-shortened
  // form here so the inline UI stays compact.
  if (!input.trim()) return result;
  const absolutePath = resolveUserPath(input);
  const shortened = shortenHomePath(absolutePath);
  if (shortened === absolutePath) return result;
  return {
    ok: false,
    reason: result.reason.split(absolutePath).join(shortened),
  };
}

// ── Pure helpers — exported for unit tests ──────────────────────────

/**
 * A completion candidate produced from `readdirSync`.
 */
export interface Completion {
  /** Directory name without any trailing separator. */
  name: string;
  /** Always true today — we only complete directories. */
  isDirectory: boolean;
}

/**
 * Split an input into the completion stem (everything up to and
 * including the last `/`) and the trailing partial segment. If the
 * input has no `/`, the stem is the empty string and the trailing
 * segment is the whole input.
 *
 * Examples:
 *   "~/proj"             → { stem: "~/",       partial: "proj" }
 *   "~/projects/my-"     → { stem: "~/projects/", partial: "my-" }
 *   "/etc"               → { stem: "/",        partial: "etc" }
 *   "myfolder"           → { stem: "",         partial: "myfolder" }
 *   ""                   → { stem: "",         partial: "" }
 *   "~/"                 → { stem: "~/",       partial: "" }
 *   "/usr/local/"        → { stem: "/usr/local/", partial: "" }
 *
 * We use `/` as the separator on every platform — paths typed into
 * the wizard's input are conventionally POSIX-style. Windows users
 * who type backslashes still get correct expansion via `expandTilde`
 * (which accepts both forms) at submit time.
 */
export function splitStem(input: string): { stem: string; partial: string } {
  const lastSlash = input.lastIndexOf('/');
  if (lastSlash === -1) {
    return { stem: '', partial: input };
  }
  return {
    stem: input.slice(0, lastSlash + 1),
    partial: input.slice(lastSlash + 1),
  };
}

/**
 * Resolve the directory we should `readdir` to find completions for
 * `input`. For a stem of "~/projects/" we resolve to the absolute
 * `$HOME/projects` directory. For an empty stem (no `/` typed yet)
 * we list `cwd`.
 */
export function resolveCompletionDir(stem: string, cwd: string): string {
  if (stem === '') return cwd;
  // Strip the trailing slash so `expandTilde` + `path.resolve` work
  // on the directory itself rather than on a path with a trailing
  // separator that happens to land on a file later.
  const withoutTrailingSlash = stem.endsWith('/')
    ? stem.slice(0, -1)
    : stem;
  // A bare "~" expands to homedir. A bare "/" stays as the root.
  if (withoutTrailingSlash === '') return '/';
  if (withoutTrailingSlash === '~') return homedir();
  const expanded = expandTilde(withoutTrailingSlash);
  // Absolute paths pass through. Use `path.isAbsolute` (not a `/`
  // prefix check) so Windows drive-letter paths like `C:\Users\...`
  // — which `expandTilde('~')` produces on win32 — are handled.
  if (pathIsAbsolute(expanded)) return expanded;
  // Relative paths resolve against the explicit cwd argument. Using
  // `path.resolve` here keeps the helper deterministic in tests
  // (callers pass `cwd`) while doing the right thing on every OS.
  return pathResolve(cwd, expanded);
}

/**
 * Compute completion candidates for the trailing segment of `input`.
 * Returns directories whose names start with the partial segment.
 *
 * - Hidden directories (leading `.`) are filtered unless the partial
 *   itself begins with a dot, matching shell behavior.
 * - Matching is case-sensitive on POSIX, case-insensitive on Windows.
 * - Errors (missing parent, permission denied) yield an empty list.
 */
export function computeCompletions(
  input: string,
  cwd: string,
): { stem: string; partial: string; candidates: Completion[] } {
  const { stem, partial } = splitStem(input);
  const dir = resolveCompletionDir(stem, cwd);

  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    log.debug('completion readdir failed', {
      dir,
      error: err instanceof Error ? err.message : String(err),
    });
    return { stem, partial, candidates: [] };
  }

  const caseInsensitive = process.platform === 'win32';
  const needle = caseInsensitive ? partial.toLowerCase() : partial;
  const showHidden = partial.startsWith('.');

  const candidates: Completion[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!showHidden && entry.name.startsWith('.')) continue;
    const haystack = caseInsensitive ? entry.name.toLowerCase() : entry.name;
    if (!haystack.startsWith(needle)) continue;
    candidates.push({ name: entry.name, isDirectory: true });
  }

  candidates.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  return { stem, partial, candidates };
}

/**
 * Compute the longest common prefix of an array of strings. Used when
 * Tab finds multiple matches: shells fill the prompt with the LCP and
 * leave the rest to the user.
 */
export function longestCommonPrefix(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  let prefix = items[0];
  for (let i = 1; i < items.length; i++) {
    const s = items[i];
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.slice(0, j);
    if (prefix === '') return '';
  }
  return prefix;
}

/**
 * Replace the trailing segment of `input` with `candidateName`, optionally
 * appending a separator. Pure — no filesystem access.
 */
export function applyCompletion(
  input: string,
  candidateName: string,
  appendSeparator = false,
): string {
  const { stem } = splitStem(input);
  return stem + candidateName + (appendSeparator ? '/' : '');
}

// ── Component ───────────────────────────────────────────────────────

/** How many candidates to show inline before truncating. */
const MAX_VISIBLE_CANDIDATES = 6;

export const PathInput = ({
  initialValue,
  onSubmit,
  onCancel,
}: PathInputProps) => {
  // The full text content of the input.
  const [value, setValue] = useState(() => shortenHomePath(initialValue));
  // Caret position (number of chars from the start). We render a
  // block cursor at this index.
  const [cursor, setCursor] = useState(() => shortenHomePath(initialValue).length);

  // Last validation error, cleared when the user types.
  const [error, setError] = useState<string | null>(null);

  // Active completion state. Populated when the user hits Tab / ↑ / ↓
  // and cleared as soon as they type a character (so the candidate
  // list doesn't go stale).
  const [candidates, setCandidates] = useState<Completion[]>([]);
  // Index of the currently-cycled candidate, or -1 when no preview
  // is active. The preview replaces the trailing segment in the
  // input but does NOT commit until the user presses Tab or Enter.
  const [cycleIndex, setCycleIndex] = useState(-1);
  // Snapshot of the input as it was BEFORE the user started cycling,
  // so Esc / a typed char can restore it. The input itself is the
  // one being modified to show the preview.
  const baselineRef = useRef<string>(value);

  // Clear stale state when the user types. We treat any character
  // input as "I'm done with that completion; reset."
  function clearCompletionState() {
    setCandidates([]);
    setCycleIndex(-1);
    baselineRef.current = '';
  }

  function setInput(next: string, nextCursor?: number) {
    setValue(next);
    setCursor(nextCursor === undefined ? next.length : nextCursor);
  }

  // Insert text at the cursor position.
  function insertChar(ch: string) {
    const next = value.slice(0, cursor) + ch + value.slice(cursor);
    setInput(next, cursor + ch.length);
    setError(null);
    clearCompletionState();
  }

  function backspace() {
    if (cursor === 0) return;
    const next = value.slice(0, cursor - 1) + value.slice(cursor);
    setInput(next, cursor - 1);
    setError(null);
    clearCompletionState();
  }

  function moveCursor(delta: number) {
    const next = Math.max(0, Math.min(value.length, cursor + delta));
    setCursor(next);
  }

  function moveCursorHome() {
    setCursor(0);
  }
  function moveCursorEnd() {
    setCursor(value.length);
  }

  // Run a completion against the current input. Called on Tab.
  function runCompletion() {
    // If we're already cycling, Tab accepts the current candidate
    // (filling it in fully and appending `/`).
    if (cycleIndex >= 0 && candidates.length > 0) {
      const chosen = candidates[cycleIndex];
      const filled = applyCompletion(baselineRef.current, chosen.name, true);
      setInput(filled);
      clearCompletionState();
      return;
    }

    const result = computeCompletions(value, process.cwd());
    if (result.candidates.length === 0) {
      // No matches — flash an error hint, no input change.
      setError('No matches.');
      return;
    }

    if (result.candidates.length === 1) {
      const only = result.candidates[0];
      const filled = applyCompletion(value, only.name, true);
      setInput(filled);
      clearCompletionState();
      setError(null);
      return;
    }

    // Multiple matches — fill in the LCP (so subsequent Tab presses
    // make progress even without cycling) and show the candidate list.
    const lcp = longestCommonPrefix(result.candidates.map((c) => c.name));
    const filledPrefix =
      lcp.length > result.partial.length
        ? applyCompletion(value, lcp, false)
        : value;
    setValue(filledPrefix);
    setCursor(filledPrefix.length);
    setCandidates(result.candidates);
    setCycleIndex(-1);
    baselineRef.current = filledPrefix;
    setError(null);
  }

  // Cycle through candidates. Called on ↑ / ↓.
  function cycle(direction: 1 | -1) {
    // Prime the candidate list if this is the first arrow press.
    if (candidates.length === 0) {
      const result = computeCompletions(value, process.cwd());
      if (result.candidates.length === 0) {
        setError('No matches.');
        return;
      }
      setCandidates(result.candidates);
      baselineRef.current = value;
      const first = direction === 1 ? 0 : result.candidates.length - 1;
      const previewed = applyCompletion(value, result.candidates[first].name, false);
      setValue(previewed);
      setCursor(previewed.length);
      setCycleIndex(first);
      setError(null);
      return;
    }

    // When `cycleIndex` is -1 (Tab populated candidates but the user
    // hasn't cycled yet) the modulo math `(-1 + -1 + n) % n` lands on
    // `n - 2`, which silently skips the last candidate. Treat -1 as
    // "no selection" and seed the same way the priming branch above
    // does: ↓ goes to the first item, ↑ goes to the last.
    const nextIdx =
      cycleIndex === -1
        ? direction === 1
          ? 0
          : candidates.length - 1
        : (cycleIndex + direction + candidates.length) % candidates.length;
    const previewed = applyCompletion(
      baselineRef.current,
      candidates[nextIdx].name,
      false,
    );
    setValue(previewed);
    setCursor(previewed.length);
    setCycleIndex(nextIdx);
  }

  function submit() {
    const result = validatePath(value);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    onSubmit(result.absolutePath);
  }

  useScreenInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      submit();
      return;
    }
    if (key.tab) {
      runCompletion();
      return;
    }
    if (key.upArrow) {
      cycle(-1);
      return;
    }
    if (key.downArrow) {
      cycle(1);
      return;
    }
    if (key.leftArrow) {
      moveCursor(-1);
      return;
    }
    if (key.rightArrow) {
      moveCursor(1);
      return;
    }
    if (key.backspace || key.delete) {
      backspace();
      return;
    }
    // Ctrl-A / Ctrl-E like a real shell.
    if (key.ctrl && input === 'a') {
      moveCursorHome();
      return;
    }
    if (key.ctrl && input === 'e') {
      moveCursorEnd();
      return;
    }
    // Ignore other control sequences (paste of a multi-char string
    // arrives as `input` with no key flags — we accept that below).
    if (key.ctrl || key.meta) return;
    // Filter out any non-printable input (some terminals deliver
    // arrow keys through `input` on top of the flags we already
    // handled above).
    if (!input) return;
    insertChar(input);
  });

  // Reset cycle baseline whenever the user gets a fresh result set.
  // Mostly defensive — the cycle/runCompletion paths handle this
  // themselves; this guards against any edge case where state goes
  // out of sync.
  useEffect(() => {
    if (candidates.length === 0) baselineRef.current = '';
  }, [candidates.length]);

  // Visible candidate slice + truncation marker.
  const visibleCandidates = useMemo(
    () => candidates.slice(0, MAX_VISIBLE_CANDIDATES),
    [candidates],
  );
  const moreCount = Math.max(0, candidates.length - MAX_VISIBLE_CANDIDATES);

  return (
    <Box flexDirection="column" gap={0}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.heading}>Change target directory</Text>
        <Text color={Colors.muted}>
          {Icons.dot} Use <Text color={Colors.accentSecondary}>~</Text> for your
          home directory. Relative paths resolve from where you launched the
          wizard.
        </Text>
      </Box>

      <PromptLine value={value} cursor={cursor} />

      {visibleCandidates.length > 0 && (
        <Box marginTop={1} flexWrap="wrap">
          {visibleCandidates.map((c, idx) => (
            <Box key={c.name} marginRight={2}>
              <Text
                color={idx === cycleIndex ? Colors.accent : Colors.body}
                inverse={idx === cycleIndex}
              >
                {c.name}/
              </Text>
            </Box>
          ))}
          {moreCount > 0 && (
            <Text color={Colors.muted}>
              {Icons.ellipsis} +{moreCount} more
            </Text>
          )}
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={Colors.error}>
            {Icons.warning} {error}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>
          {Icons.dot} Tab to complete {Icons.dot} ↑/↓ to cycle {Icons.dot} Enter
          to submit {Icons.dot} Esc to cancel
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Render the prompt line itself with a block cursor at `cursor`.
 *
 * We split the value into "before / at / after" the cursor so we can
 * highlight the character under the cursor with `inverse`. When the
 * cursor sits at end-of-input we render a single-space inverse block
 * so the caret is still visible.
 */
const PromptLine = ({ value, cursor }: { value: string; cursor: number }) => {
  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || ' ';
  const after = value.slice(cursor + 1);
  return (
    <Box>
      <Text color={Colors.accent}>{Icons.prompt} </Text>
      <Text color={Colors.body}>{before}</Text>
      <Text inverse>{at}</Text>
      <Text color={Colors.body}>{after}</Text>
    </Box>
  );
};
