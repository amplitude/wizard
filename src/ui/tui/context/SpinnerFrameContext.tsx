/**
 * SpinnerFrameContext — single shared 200ms tick driving every BrailleSpinner.
 *
 * Why this exists
 *
 *   Each `BrailleSpinner` rendered without a `frame` prop used to start its
 *   own `setInterval(200ms)` + `setState` loop. Multiple screens (Auth,
 *   Intro, SigningUp, DataIngestionCheck, DataSetup, ActivityLine) each
 *   spun up independent timers, producing N separate re-render cascades
 *   per second across the Ink tree. Even when only one spinner was on
 *   screen, the FileWritesPanel + RunScreen's own tick was still in
 *   addition to whatever per-instance timers the active screen owned.
 *
 *   This provider hoists the timer to one location: the App root. All
 *   subscribers see the same `frame` value, so all spinners are perfectly
 *   in-phase (a feature, not a bug — the eye notices when adjacent
 *   spinners drift) and the entire tree re-renders in a single batch
 *   every 200ms instead of `N * 200ms` ticks.
 *
 * Pause when idle
 *
 *   The provider counts subscribers via `register()` / `unregister()`.
 *   When zero spinners are mounted the interval is cleared, so screens
 *   without spinning indicators (e.g. text-only confirm screens) don't
 *   pay for an idle tick.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SPINNER_FRAMES, SPINNER_INTERVAL } from '../styles.js';

interface SpinnerFrameContextValue {
  /** Current frame index, modulo SPINNER_FRAMES.length. */
  frame: number;
  /** Called by BrailleSpinner on mount; provider starts the timer if needed. */
  register: () => void;
  /** Called by BrailleSpinner on unmount; provider stops the timer if count hits 0. */
  unregister: () => void;
}

const SpinnerFrameContext = createContext<SpinnerFrameContextValue | null>(
  null,
);

interface SpinnerFrameProviderProps {
  children: ReactNode;
}

export const SpinnerFrameProvider = ({
  children,
}: SpinnerFrameProviderProps) => {
  const [frame, setFrame] = useState(0);
  // Subscriber count + interval handle live in refs so register / unregister
  // don't trigger their own re-renders. Only `frame` updates re-render
  // the provider (and therefore all subscribed spinners).
  const subscribersRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    if (intervalRef.current !== null) return;
    intervalRef.current = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);
  };

  const stopTimer = () => {
    if (intervalRef.current === null) return;
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  };

  const register = () => {
    subscribersRef.current += 1;
    if (subscribersRef.current === 1) startTimer();
  };

  const unregister = () => {
    subscribersRef.current = Math.max(0, subscribersRef.current - 1);
    if (subscribersRef.current === 0) stopTimer();
  };

  // Defensive cleanup if the provider itself unmounts while timer is live.
  useEffect(() => {
    return () => stopTimer();
  }, []);

  return (
    <SpinnerFrameContext.Provider value={{ frame, register, unregister }}>
      {children}
    </SpinnerFrameContext.Provider>
  );
};

/**
 * Subscribe to the shared spinner frame. Returns `null` when no provider
 * is mounted (e.g. unit tests rendering a screen in isolation) — callers
 * should fall back to a self-contained timer in that case.
 *
 * register / unregister run exactly once per mount: we capture them in a
 * ref so the effect's dependency array can stay empty. If we depended on
 * `ctx` directly, every re-render (which happens every 200ms when the
 * provider's `frame` updates) would unregister + re-register, restarting
 * the interval each tick and producing a timer that never fires.
 */
export function useSpinnerFrame(): number | null {
  const ctx = useContext(SpinnerFrameContext);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // Empty deps on purpose: see jsdoc above. We capture `ctx` via a ref so
  // the effect can read the current value without depending on it, which
  // avoids the unregister/register thrash that would otherwise reset the
  // provider's interval on every tick.
  useEffect(() => {
    const c = ctxRef.current;
    if (!c) return;
    c.register();
    return () => {
      c.unregister();
    };
  }, []);

  return ctx ? ctx.frame : null;
}
