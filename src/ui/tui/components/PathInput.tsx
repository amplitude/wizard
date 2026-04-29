/**
 * PathInput — inline directory picker for the IntroScreen "Change
 * directory" flow.
 *
 * Why a custom component instead of dropping a raw `<TextInput>` into
 * the screen:
 *   - `~` expansion is per-input, not global
 *   - Validation messages need to render inline beneath the input
 *     (file vs. directory vs. nonexistent get distinct copy)
 *   - Esc cancels without submitting; Enter only submits valid paths
 *   - The "rejected" state is sticky until the user types again, so a
 *     fast typist can't accidentally confirm an invalid path twice
 *
 * The component is uncontrolled — we only read the value on submit,
 * matching the pattern used by CreateProjectScreen. Validation runs
 * on each submit attempt, NOT on each keystroke (Ink's TextInput
 * doesn't expose intermediate values without a controlled wrapper,
 * and per-keystroke `statSync` calls on a slow filesystem would lag).
 */

import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useState } from 'react';
import { homedir } from 'node:os';
import { resolve, isAbsolute } from 'node:path';
import { statSync } from 'node:fs';

import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors, Icons } from '../styles.js';
import { shortenHomePath } from '../../../lib/workspace-analysis.js';

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

/**
 * Validation result for a single submit attempt. We keep the resolved
 * path on success so the caller doesn't have to re-resolve.
 */
type ValidationResult =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: string };

/**
 * Resolve a user-typed path into an absolute path on disk.
 *
 * Steps:
 *   1. Trim whitespace (a copy-pasted path with a trailing newline is
 *      a real failure mode).
 *   2. Expand a leading `~` to the user's home directory. We intentionally
 *      DON'T expand `$VAR` style env vars — that would surprise users who
 *      type a literal `$` in a directory name. They can type the full
 *      path or use a shell-resolved path on the command line.
 *   3. Resolve relative paths against `cwd` so `./foo` and `../foo` work
 *      from wherever the wizard was launched.
 *
 * Exported for unit tests.
 */
export function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  const expanded = trimmed.startsWith('~')
    ? trimmed === '~'
      ? homedir()
      : trimmed.startsWith('~/')
      ? homedir() + trimmed.slice(1)
      : trimmed
    : trimmed;
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

/**
 * Validate a user-typed path. Returns a tagged union — the caller
 * renders different copy for each `reason`.
 *
 * Exported for unit tests.
 */
export function validatePath(input: string): ValidationResult {
  if (!input.trim()) {
    return { ok: false, reason: 'Enter a path.' };
  }
  const absolutePath = resolveUserPath(input);
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(absolutePath);
  } catch {
    return {
      ok: false,
      reason: `No directory at ${shortenHomePath(absolutePath)}.`,
    };
  }
  if (!stats.isDirectory()) {
    return {
      ok: false,
      reason: `${shortenHomePath(absolutePath)} is a file, not a directory.`,
    };
  }
  return { ok: true, absolutePath };
}

export const PathInput = ({
  initialValue,
  onSubmit,
  onCancel,
}: PathInputProps) => {
  // Last validation error, if any. Cleared on every submit so the user
  // sees fresh feedback for the path they just typed.
  const [error, setError] = useState<string | null>(null);

  // Esc cancels regardless of input state. We attach this at the
  // screen level (not via TextInput's own input handling) so it
  // works even when the input is empty / focused / mid-edit.
  useScreenInput((_input, key) => {
    if (key.escape) onCancel();
  });

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

      <TextInput
        defaultValue={shortenHomePath(initialValue)}
        placeholder="~/projects/my-app"
        onSubmit={(value) => {
          const result = validatePath(value);
          if (!result.ok) {
            setError(result.reason);
            return;
          }
          setError(null);
          onSubmit(result.absolutePath);
        }}
      />

      {error && (
        <Box marginTop={1}>
          <Text color={Colors.error}>
            {Icons.warning} {error}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>
          {Icons.dot} Press Enter to switch, Esc to go back.
        </Text>
      </Box>
    </Box>
  );
};
