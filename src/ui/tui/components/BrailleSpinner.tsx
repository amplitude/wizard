/**
 * BrailleSpinner — compact animated spinner using braille characters.
 *
 * Three moods (PR A2 #3): the spinner is also a tiny narrative device,
 * not just a "we're busy" indicator. The mood prop lets callers signal
 * what kind of work is happening so the animation can match:
 *
 *  - `thinking`  — default tempo (SPINNER_INTERVAL ms). The agent is
 *                  doing routine work; the spinner clicks along at the
 *                  same pace it always has.
 *  - `waiting`   — slow pulse (1.6 × SPINNER_INTERVAL). The wizard is
 *                  blocked on something external (the user, a long
 *                  remote call) and the slower cadence reads as
 *                  "patient", not "stuck".
 *  - `listening` — fast pulse (0.6 × SPINNER_INTERVAL). The agent is
 *                  actively reading something (file scan, tool result
 *                  streaming in). The faster tempo conveys "attentive".
 *
 * The mood prop is opt-in; existing callsites continue to render the
 * default thinking tempo with no code change.
 *
 * Mood is also reflected in the default color when no explicit color
 * prop is supplied: thinking → active, waiting → muted, listening →
 * accent. Callers that pass `color` retain full control (the explicit
 * prop wins).
 */

import { Text } from 'ink';
import { useState, useEffect } from 'react';
import { SPINNER_FRAMES, SPINNER_INTERVAL, Colors } from '../styles.js';

export type SpinnerMood = 'thinking' | 'waiting' | 'listening';

/**
 * Per-mood frame interval in milliseconds. Exported so tests can pin
 * the cadence without re-deriving the constants.
 */
export const SPINNER_MOOD_INTERVAL: Record<SpinnerMood, number> = {
  thinking: SPINNER_INTERVAL,
  // 1.6× slower — "patient", visibly different from thinking without
  // tipping into "stalled".
  waiting: Math.round(SPINNER_INTERVAL * 1.6),
  // 0.6× faster — "attentive". Stays above the 60 ms floor that
  // anecdotally starts to read as visual noise.
  listening: Math.max(60, Math.round(SPINNER_INTERVAL * 0.6)),
};

/** Default color per mood when the caller hasn't specified one. */
const SPINNER_MOOD_DEFAULT_COLOR: Record<SpinnerMood, string> = {
  thinking: Colors.active,
  waiting: Colors.muted,
  listening: Colors.accent,
};

interface BrailleSpinnerProps {
  color?: string;
  /** External frame index. When provided the spinner skips its own interval
   *  and renders this frame directly — lets callers share a single timer. */
  frame?: number;
  /**
   * Narrative tempo for the spinner. See module header for the three
   * mood semantics. Defaults to 'thinking' so existing callsites keep
   * their original cadence.
   */
  mood?: SpinnerMood;
}

export const BrailleSpinner = ({
  color,
  frame: frameProp,
  mood = 'thinking',
}: BrailleSpinnerProps) => {
  const [internalFrame, setInternalFrame] = useState(0);
  const interval = SPINNER_MOOD_INTERVAL[mood];

  useEffect(() => {
    if (frameProp !== undefined) return;
    const id = setInterval(
      () => setInternalFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      interval,
    );
    return () => clearInterval(id);
  }, [frameProp, interval]);

  const resolvedColor = color ?? SPINNER_MOOD_DEFAULT_COLOR[mood];

  const frame =
    frameProp !== undefined ? frameProp % SPINNER_FRAMES.length : internalFrame;

  return <Text color={resolvedColor}>{SPINNER_FRAMES[frame]}</Text>;
};
