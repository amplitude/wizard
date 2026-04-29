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
import type { RetryState } from '../../lib/wizard-session.js';
import { toCredentialAppId } from '../../lib/wizard-session.js';
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
    appId: number;
    orgId?: string | null;
    orgName?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    envName?: string | null;
  }): void {
    // The store-level WizardSession.credentials type only carries the four
    // core fields; org/project names live elsewhere on the session. Scope
    // fields here are for the NDJSON layer only — the TUI path ignores them.
    this.store.setCredentials({
      accessToken: credentials.accessToken,
      projectApiKey: credentials.projectApiKey,
      host: credentials.host,
      // Re-validate at the trust boundary: the upstream NDJSON contract
      // accepts a raw `number`, but the store type is `AppId | 0`.
      appId: toCredentialAppId(credentials.appId),
    });
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

  setRetryState(state: RetryState | null): void {
    this.store.setRetryState(state);
  }

  startRun(): void {
    this.store.setRunPhase(RunPhase.Running);
  }

  async setRunError(error: Error): Promise<boolean> {
    this.store.setScreenError(error);
    await this.store.waitForRetry();
    return true;
  }

  async cancel(message: string, options?: { docsUrl?: string }): Promise<void> {
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

    // Block until the user dismisses the OutroScreen (or a safety
    // timeout fires). Without this, wizardAbort would call process.exit
    // before Ink rendered the next frame and the user would never see
    // the cancel/error message — they'd just get a half-rendered status
    // banner and a sudden process death.
    //
    // Safety timeout exists because the TUI can theoretically deadlock
    // (e.g. an error during render itself). 5 minutes is generous —
    // long enough for a human to read the bug-report instructions and
    // open the log file, short enough that an unattended CI run that
    // somehow reaches this path doesn't hang forever.
    const SAFETY_TIMEOUT_MS = 5 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SAFETY_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.store.outroDismissed(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
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
