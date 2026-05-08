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
}

export const BrailleSpinner = ({
  color = Colors.active,
  frame: frameProp,
}: BrailleSpinnerProps) => {
  // Shared frame from the App-root provider, when one is mounted. Returns
  // `null` outside the provider (e.g. snapshot tests rendering a screen
  // in isolation), in which case we fall back to the local interval.
  const sharedFrame = useSpinnerFrame();
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

  return <Text color={color}>{SPINNER_FRAMES[frame]}</Text>;
};
