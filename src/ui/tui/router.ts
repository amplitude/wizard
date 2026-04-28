/**
 * WizardRouter — declarative flow pipelines + overlay stack.
 *
 * Two layers:
 *   Flow cursor    — linear pipeline of screens, advanced with next()
 *   Overlay stack  — interrupts (outage, auth-expired, etc.) that push/pop
 *
 * The visible screen is: top of overlay stack if non-empty, otherwise the flow cursor.
 *
 * Adding a flow screen = append to a pipeline array.
 * Adding an overlay = call pushOverlay() from anywhere.
 * No switch statements, no hardcoded transitions in business logic.
 */

import type { WizardSession } from '../../lib/wizard-session.js';
import type { WizardStore } from './store.js';
import { OutroKind } from './session-constants.js';
import { FLOWS, Screen, Flow, type FlowEntry } from './flows.js';

// Re-export so existing imports from './router.js' keep working
export { Screen, Flow };
export type { FlowEntry };

// ── Screen name taxonomy ──────────────────────────────────────────────

/** Screens that interrupt flows as overlays */
export enum Overlay {
  Outage = 'outage',
  SettingsOverride = 'settings-override',
  Snake = 'snake',
  Mcp = 'mcp-overlay',
  Slack = 'slack-overlay',
  Logout = 'logout-overlay',
  Login = 'login-overlay',
}

/** Union of all screen names */
export type ScreenName = Screen | Overlay;

// ── Router ────────────────────────────────────────────────────────────

export class WizardRouter {
  private flow: FlowEntry[];
  private flowName: Flow;
  private overlays: Overlay[] = [];

  constructor(flowName: Flow = Flow.Wizard) {
    this.flowName = flowName;
    this.flow = FLOWS[flowName];
  }

  /**
   * Resolve which screen should be active based on session state.
   * Walks the flow pipeline, skipping hidden entries and completed entries,
   * returns the first incomplete screen.
   */
  resolve(session: WizardSession): ScreenName {
    // Cancel outro beats overlays — when wizardAbort sets
    // outroData.kind=Cancel, the user MUST see the cancel message and
    // dismiss it. Without this priority, an active overlay (Outage,
    // SettingsOverride) calling wizardAbort would keep itself rendered
    // and OutroScreen would never mount, hanging wizardAbort on its
    // 5-minute safety timeout. The overlay-popping in those screens is
    // the primary fix; this ordering is defense in depth.
    if (session.outroData?.kind === OutroKind.Cancel) {
      return Screen.Outro;
    }

    if (this.overlays.length > 0) {
      return this.overlays[this.overlays.length - 1];
    }

    for (const entry of this.flow) {
      if (entry.show && !entry.show(session)) continue;
      if (entry.isComplete && entry.isComplete(session)) continue;
      return entry.screen;
    }

    // All entries complete — show the last screen (outro)
    return this.flow[this.flow.length - 1].screen;
  }

  /** The screen that should be rendered right now. */
  get activeScreen(): ScreenName {
    // Overlays take priority — resolve() handles this too,
    // but activeScreen is called before session is available in some paths
    if (this.overlays.length > 0) {
      return this.overlays[this.overlays.length - 1];
    }
    return this.flow[0].screen;
  }

  /** The name of the active flow. */
  get activeFlow(): Flow {
    return this.flowName;
  }

  /** Whether an overlay is currently active. */
  get hasOverlay(): boolean {
    return this.overlays.length > 0;
  }

  /**
   * Push an overlay that interrupts the current flow.
   * The flow resumes when the overlay is dismissed via popOverlay().
   */
  pushOverlay(overlay: Overlay): void {
    this.overlays.push(overlay);
  }

  /**
   * Dismiss the topmost overlay. The flow screen underneath resumes.
   */
  popOverlay(): void {
    this.overlays.pop();
  }

  /**
   * Find the index of the entry that resolve() would currently land on.
   * Returns flow.length when every entry is complete (i.e. on the trailing
   * fallback screen).
   */
  private activeIndex(session: WizardSession): number {
    for (let i = 0; i < this.flow.length; i++) {
      const entry = this.flow[i];
      if (entry.show && !entry.show(session)) continue;
      if (entry.isComplete && entry.isComplete(session)) continue;
      return i;
    }
    return this.flow.length;
  }

  /**
   * Whether the user can go back from the current screen.
   *
   * Walks the flow backwards from the active entry through entries that
   * the user has already completed (regardless of whether they're still
   * "shown" — RegionSelect is a good example: once a region is picked,
   * `show` returns false but the step still happened and is revertible).
   *
   * Returns true if it finds a previously-completed entry with a `revert`
   * defined. Returns false the moment it hits a completed entry without a
   * revert — those act as a wall (e.g. Run, which would be destructive
   * to undo).
   *
   * Overlays disable back-nav so users dismiss the overlay first.
   */
  canGoBack(session: WizardSession): boolean {
    if (this.overlays.length > 0) return false;
    const activeIdx = this.activeIndex(session);
    for (let i = activeIdx - 1; i >= 0; i--) {
      const entry = this.flow[i];
      // Walk through entries that have happened. An entry "happened" if
      // its isComplete predicate is true; show=false alone doesn't disqualify
      // (a step can be hidden because it already concluded).
      if (!entry.isComplete || !entry.isComplete(session)) continue;
      // Completed entry: either it can be reverted, or it's a wall.
      return Boolean(entry.revert);
    }
    return false;
  }

  /**
   * Step back one decision. Calls the most recent revertible entry's
   * `revert` callback so the router naturally re-resolves to that screen
   * on the next render. Returns true if a revert fired.
   *
   * Reverts that return `false` are treated as no-ops (nothing meaningful
   * to undo at that step) and the walk continues further back.
   */
  goBack(session: WizardSession, store: WizardStore): boolean {
    if (this.overlays.length > 0) return false;
    const activeIdx = this.activeIndex(session);
    for (let i = activeIdx - 1; i >= 0; i--) {
      const entry = this.flow[i];
      if (!entry.isComplete || !entry.isComplete(session)) continue;
      if (!entry.revert) return false; // wall — no back past this entry
      const reverted = entry.revert(store);
      if (reverted === false) continue; // no-op revert, keep walking
      this._lastDirection = 'pop';
      return true;
    }
    return false;
  }

  /**
   * Direction hint for screen transitions.
   */
  private _lastDirection: 'push' | 'pop' | null = null;

  get lastNavDirection(): 'push' | 'pop' | null {
    return this._lastDirection;
  }

  /** @internal — called by store wrapper to track direction */
  _setDirection(dir: 'push' | 'pop' | null): void {
    this._lastDirection = dir;
  }
}
