/**
 * InkUI — Ink-backed implementation of WizardUI.
 *
 * Translates business logic calls into store setter calls.
 * No direct session mutation. No imperative screen transitions.
 * The router derives the active screen from session state.
 */

import type {
  WizardUI,
  SpinnerHandle,
  EventPlanDecision,
} from '../wizard-ui.js';
import type { WizardStore } from './store.js';
import { Overlay } from './router.js';
import { RunPhase, OutroKind } from './session-constants.js';

// Strip ANSI escape codes (chalk formatting) from strings
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export class InkUI implements WizardUI {
  constructor(private store: WizardStore) {}

  intro(message: string): void {
    this.store.pushStatus(message);
  }

  outro(message: string): void {
    this.store.pushStatus(stripAnsi(message));

    if (!this.store.session.outroData) {
      this.store.setOutroData({
        kind: OutroKind.Success,
        message: stripAnsi(message),
      });
    }

    // Signal that the main work is done — router resolves to mcp or outro
    if (this.store.session.runPhase === RunPhase.Running) {
      this.store.setRunPhase(RunPhase.Completed);
    }
  }

  setCredentials(credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    projectId: number;
  }): void {
    this.store.setCredentials(credentials);
  }

  setDetectedFramework(label: string): void {
    this.store.setDetectedFramework(label);
  }

  onEnterScreen(screen: string, fn: () => void): void {
    this.store.onEnterScreen(
      screen as Parameters<WizardStore['onEnterScreen']>[0],
      fn,
    );
  }

  setLoginUrl(url: string | null): void {
    this.store.setLoginUrl(url);
  }

  setRegion(region: string): void {
    this.store.setRegion(region);
  }

  setProjectHasData(value: boolean): void {
    this.store.setProjectHasData(value);
  }

  showServiceStatus(data: {
    description: string;
    statusPageUrl: string;
  }): void {
    this.store.setServiceStatus(data);
    this.store.pushOverlay(Overlay.Outage);
  }

  showSettingsOverride(
    keys: string[],
    backupAndFix: () => boolean,
  ): Promise<void> {
    return this.store.showSettingsOverride(keys, backupAndFix);
  }

  startRun(): void {
    this.store.setRunPhase(RunPhase.Running);
  }

  async setRunError(error: Error): Promise<boolean> {
    this.store.setScreenError(error);
    await this.store.waitForRetry();
    return true;
  }

  cancel(message: string, options?: { docsUrl?: string }): void {
    this.store.pushStatus(stripAnsi(message));

    if (!this.store.session.outroData) {
      this.store.setOutroData({
        kind: OutroKind.Cancel,
        message: stripAnsi(message),
        docsUrl: options?.docsUrl,
      });
    }

    // Advance past Run screen (RunPhase.Error also skips MCP screen)
    if (
      this.store.session.runPhase === RunPhase.Running ||
      this.store.session.runPhase === RunPhase.Idle
    ) {
      this.store.setRunPhase(RunPhase.Error);
    }
  }

  log = {
    info: (message: string): void => {
      this.store.pushStatus(message);
    },
    warn: (message: string): void => {
      this.store.pushStatus(message);
    },
    error: (message: string): void => {
      this.store.pushStatus(message);
    },
    success: (message: string): void => {
      this.store.pushStatus(message);
    },
    step: (message: string): void => {
      this.store.pushStatus(message);
    },
  };

  note(message: string): void {
    this.store.pushStatus(message);
  }

  spinner(): SpinnerHandle {
    return {
      start: (message?: string) => {
        if (message) this.store.pushStatus(message);
      },
      stop: (message?: string) => {
        if (message) this.store.pushStatus(message);
      },
      message: (msg?: string) => {
        if (msg) this.store.pushStatus(msg);
      },
    };
  }

  pushStatus(message: string): void {
    this.store.pushStatus(message);
  }

  heartbeat(_statuses: string[]): void {
    // TUI already shows live status updates reactively via pushStatus — no-op
  }

  promptConfirm(message: string): Promise<boolean> {
    return this.store.promptConfirm(message);
  }

  promptChoice(message: string, options: string[]): Promise<string> {
    return this.store.promptChoice(message, options);
  }

  promptEventPlan(
    events: Array<{ name: string; description: string }>,
  ): Promise<EventPlanDecision> {
    return this.store.promptEventPlan(events);
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    this.store.syncTodos(todos);
  }

  setEventPlan(events: Array<{ name: string; description: string }>): void {
    this.store.setEventPlan(events);
  }

  setEventIngestionDetected(_eventNames: string[]): void {
    // In TUI mode, DataIngestionCheckScreen handles this via polling — no-op here.
  }

  setDashboardUrl(url: string): void {
    this.store.setChecklistDashboardUrl(url);
  }
}
