/**
 * BrailleSpinner — compact animated spinner using braille characters.
 *
 * Frame-source priority:
 *
 *   1. Explicit `frame` prop (RunScreen, FileWritesPanel pass their own
 *      unified tick). Used as-is, modulo SPINNER_FRAMES.length.
 *   2. Shared `SpinnerFrameContext` mounted at the App root — one timer
 *      for the entire app, all spinners in-phase.
 *   3. Per-instance fallback timer — only kicks in when neither of the
 *      above is available. Snapshot tests render screens without the
 *      provider, so the fallback keeps them animating without forcing
 *      every test to wrap a provider.
 */

import { Text } from 'ink';
import { useState, useEffect } from 'react';
import { SPINNER_FRAMES, SPINNER_INTERVAL, Colors } from '../styles.js';
import { useSpinnerFrame } from '../context/SpinnerFrameContext.js';

interface BrailleSpinnerProps {
  color?: string;
  /** External frame index. When provided the spinner skips its own interval
   *  and renders this frame directly — lets callers share a single timer. */
  frame?: number;
  /**
   * When true, render three consecutive frames (offset by +1 and +2) so
   * the spinner occupies three terminal cells instead of one. Useful for
   * prominent positions like the RunScreen header where a single character
   * is too easy to miss.
   */
  wide?: boolean;
}

export const BrailleSpinner = ({
  color = Colors.active,
  frame: frameProp,
  wide = false,
}: BrailleSpinnerProps) => {
  // Shared frame from the App-root provider, when one is mounted. Returns
  // `null` outside the provider (e.g. snapshot tests rendering a screen
  // in isolation), in which case we fall back to the local interval.
  //
  // When the caller already passes an explicit `frame` prop, skip the
  // subscription entirely — we'd just ignore the shared value, but
  // calling register() would keep the provider's timer alive (and
  // re-render this spinner every 200ms) for nothing. `skip` keeps the
  // hook call itself unconditional so rules-of-hooks still hold.
  const sharedFrame = useSpinnerFrame({ skip: frameProp !== undefined });
  const useFallback = frameProp === undefined && sharedFrame === null;

  const [internalFrame, setInternalFrame] = useState(0);

  useEffect(() => {
    if (!useFallback) return;
    const id = setInterval(
      () => setInternalFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL,
    );
    return () => clearInterval(id);
  }, [useFallback]);

  let frame: number;
  if (frameProp !== undefined) {
    frame = frameProp % SPINNER_FRAMES.length;
  } else if (sharedFrame !== null) {
    frame = sharedFrame;
  } else {
    frame = internalFrame;
  }

  if (wide) {
    const n = SPINNER_FRAMES.length;
    const chars =
      SPINNER_FRAMES[frame] +
      SPINNER_FRAMES[(frame + 1) % n] +
      SPINNER_FRAMES[(frame + 2) % n];
    return <Text color={color}>{chars}</Text>;
  }

  return <Text color={color}>{SPINNER_FRAMES[frame]}</Text>;
};
