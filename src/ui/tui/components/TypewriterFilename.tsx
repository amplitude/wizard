/**
 * TypewriterFilename — reveals a path char-by-char at TYPEWRITER_INTERVAL_MS.
 *
 * Used on the RunScreen "currently editing" header slot to add a
 * little texture to the agent's file-write progression. Without it,
 * the path slot would either snap from blank → full path on each new
 * PreToolUse hook (jarring) or stay statically pinned (boring).
 *
 * Behavior contract:
 *
 *  - On `path` change: drop back to an empty reveal and stream forward
 *    25 ms per char. The previous path's stream is cancelled.
 *  - On `path === null`: render nothing. We pin it as `null` rather
 *    than holding the last path so the slot clears when the agent
 *    finishes a write batch.
 *  - On unmount: timers are cancelled in the effect-return.
 *
 * The LLM hook in the PR scope mentioned NOT requiring an LLM —
 * this component reads its single input (`path`) from the existing
 * FileChangeLedger entry the parent already exposes via
 * store.fileWrites. There's no model call.
 */

import { useEffect, useState } from 'react';
import { Text } from 'ink';
import { Colors } from '../styles.js';

/** Reveal cadence in ms per character. Exported for tests. */
export const TYPEWRITER_INTERVAL_MS = 25;

interface TypewriterFilenameProps {
  /**
   * The path to reveal. When it changes, the typewriter restarts from
   * the beginning. When it becomes null, the component renders
   * nothing.
   */
  path: string | null;
  /**
   * Optional prefix copy that renders before the path itself.
   * Defaults to "editing " (lowercase verb form to match the wizard's
   * other dim status lines). The prefix is shown immediately — only
   * the path is typewriter-revealed.
   */
  prefix?: string;
  /** Color to render the path/prefix in. Defaults to Colors.muted. */
  color?: string;
}

export const TypewriterFilename = ({
  path,
  prefix = 'editing ',
  color = Colors.muted,
}: TypewriterFilenameProps) => {
  // The number of characters revealed so far. We deliberately don't
  // store the substring itself — recomputing it from path + count is
  // cheap and avoids "revealed slice belongs to a stale path" bugs if
  // path changes between an effect scheduling and its callback firing.
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    // Path cleared — nothing to reveal.
    if (!path) {
      setRevealedCount(0);
      return undefined;
    }
    // Reset to empty on path change so the new path streams from
    // scratch rather than picking up at the old reveal length.
    setRevealedCount(0);

    let cancelled = false;
    let count = 0;
    const tick = (): void => {
      if (cancelled) return;
      count += 1;
      setRevealedCount(count);
      if (count < path.length) {
        timer = setTimeout(tick, TYPEWRITER_INTERVAL_MS);
      }
    };
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(
      tick,
      TYPEWRITER_INTERVAL_MS,
    );

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [path]);

  if (!path) return null;

  // Clamp on the off-chance state and prop are momentarily out of
  // sync (e.g. path shortened between renders) — substring of a
  // longer-than-length count returns the full string, but we still
  // want exact ergonomics.
  const visible = path.slice(0, Math.min(revealedCount, path.length));
  return (
    <Text color={color} wrap="truncate-end">
      {prefix}
      {visible}
    </Text>
  );
};
