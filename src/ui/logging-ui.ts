/**
 * LoggingUI — Logging-only implementation for CI mode.
 * No prompts, no TUI, no interactivity. Just console output.
 */

import {
  TaskStatus,
  type WizardUI,
  type SpinnerHandle,
  type EventPlanDecision,
} from './wizard-ui';
import type { RetryState } from '../lib/wizard-session';

export class LoggingUI implements WizardUI {
  intro(message: string): void {
    console.log(`┌  ${message}`);
  }

  outro(message: string): void {
    console.log(`└  ${message}`);
  }

  cancel(message: string, options?: { docsUrl?: string }): Promise<void> {
    // Cancel implies failure/abort — direct to stderr so callers can detect it
    console.error(`■  ${message}`);
    if (options?.docsUrl) {
      console.error(`│  Manual setup guide: ${options.docsUrl}`);
    }
    // No TUI in logging mode — stderr write completes synchronously,
    // resolve immediately so wizardAbort isn't held up.
    return Promise.resolve();
  }

  setOutroData(data: import('../lib/wizard-session.js').OutroData): void {
    // No TUI to render — emit the message inline so CI logs capture it.
    if (data.message) console.error(`■  ${data.message}`);
  }

  log = {
    info(message: string): void {
      console.log(`│  ${message}`);
    },
    warn(message: string): void {
      // Route warnings to stderr so pipe consumers can separate signal from errors
      console.error(`▲  ${message}`);
    },
    error(message: string): void {
      // Route errors to stderr — stdout should remain clean for structured
      // output (e.g. --json / agent mode) and for shell piping.
      console.error(`✖  ${message}`);
    },
    success(message: string): void {
      console.log(`✔  ${message}`);
    },
    step(message: string): void {
      console.log(`◇  ${message}`);
    },
  };

  note(message: string): void {
    console.log(`│  ${message}`);
  }

  spinner(): SpinnerHandle {
    let activeMessage: string | undefined;
    return {
      start(message?: string) {
        if (message) {
          activeMessage = message;
          // Write without newline so stop() can overwrite in-place
          process.stdout.write(`◌  ${message}`);
        }
      },
      stop(message?: string) {
        if (activeMessage !== undefined) {
          // Overwrite the current spinner line: carriage-return → solid dot → newline
          process.stdout.write(`\r●  ${message ?? activeMessage}\n`);
          activeMessage = undefined;
        } else if (message) {
          console.log(`●  ${message}`);
        }
      },
      message(msg?: string) {
        if (!msg) return;
        if (activeMessage !== undefined) {
          // Overwrite the current spinner line with the new task
          process.stdout.write(`\r◌  ${msg}`);
        } else {
          process.stdout.write(`◌  ${msg}`);
        }
        activeMessage = msg;
      },
    };
  }

  pushStatus(message: string): void {
    console.log(`◇  ${message}`);
  }

  heartbeat(statuses: string[]): void {
    if (statuses.length === 0) return;
    // End the current in-progress spinner line before printing
    process.stdout.write('\n');
    for (const s of statuses) {
      console.log(`│  ${s}`);
    }
  }

  setDetectedFramework(label: string): void {
    console.log(`✔  Framework: ${label}`);
  }

  onEnterScreen(_screen: string, _fn: () => void): void {
    // No screen transitions in CI
  }

  setLoginUrl(url: string | null): void {
    if (url) {
      console.log(
        `│  If the browser didn't open automatically, use this link:`,
      );
      console.log(`│  ${url}`);
    }
  }

  showServiceStatus(data: {
    description: string;
    statusPageUrl: string;
  }): void {
    // Service status is a warning — goes to stderr
    console.error(`▲  The setup agent is temporarily unavailable.`);
    console.error(`│  Status: ${data.description}`);
    console.error(`│  Status page: ${data.statusPageUrl}`);
    console.error(
      `│  The wizard may not work reliably while services are affected.`,
    );
  }

  setRetryState(state: RetryState | null): void {
    if (!state) return;
    const status = state.errorStatus ? ` (HTTP ${state.errorStatus})` : '';
    const eta = Math.max(
      0,
      Math.round((state.nextRetryAtMs - Date.now()) / 1000),
    );
    // Retry notices are warning-level — stderr
    console.error(
      `▲  ${state.reason}${status} — retrying attempt ${state.attempt}/${
        state.maxRetries
      }${eta > 0 ? ` in ${eta}s` : ''}`,
    );
  }

  startRun(): void {
    // No-op in CI mode
  }

  setRunError(_error: Error): Promise<boolean> {
    // No retry in CI — let the caller fall through to wizardAbort
    return Promise.resolve(false);
  }

  setCredentials(_credentials: {
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
    // No-op in CI mode — credentials are handled directly
  }

  setRegion(_region: string): void {
    // No-op in CI mode
  }

  setProjectHasData(_value: boolean): void {
    // No-op in CI mode
  }

  promptConfirm(message: string): Promise<boolean> {
    console.log(`?  ${message} (auto-skipped in CI)`);
    return Promise.resolve(false);
  }

  promptChoice(message: string, options: string[]): Promise<string> {
    console.log(`?  ${message} (auto-skipped in CI)`);
    console.log(`│  Options: ${options.join(', ')}`);
    return Promise.resolve('');
  }

  promptEventPlan(
    events: Array<{ name: string; description: string }>,
  ): Promise<EventPlanDecision> {
    console.log(`?  Instrumentation plan (auto-approved in CI):`);
    for (const e of events) {
      console.log(`│  - ${e.name}: ${e.description}`);
    }
    return Promise.resolve({ decision: 'approved' });
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    const completed = todos.filter(
      (t) => (t.status as TaskStatus) === TaskStatus.Completed,
    ).length;
    const inProgress = todos.find(
      (t) => (t.status as TaskStatus) === TaskStatus.InProgress,
    );
    if (inProgress) {
      console.log(
        `◌  [${completed}/${todos.length}] ${
          inProgress.activeForm || inProgress.content
        }`,
      );
    }
  }

  setEventPlan(_events: Array<{ name: string; description: string }>): void {
    // No-op in CI mode
  }

  recordFileChangePlanned(data: {
    path: string;
    operation: 'create' | 'modify' | 'delete';
  }): void {
    // CI logs the plan-then-apply pair as a single line per file. Verbose
    // enough to be useful when scanning a CI run, quiet enough not to drown
    // out the rest of the output.
    console.log(`◌  ${data.operation} ${data.path}`);
  }

  recordFileChangeApplied(_data: {
    path: string;
    operation: 'create' | 'modify' | 'delete';
    bytes?: number;
  }): void {
    // The planned-line above already announced the write. Skip the applied
    // line in CI to avoid doubling the per-file output volume.
  }

  setEventIngestionDetected(_eventNames: string[]): void {
    // No-op in CI/logging mode
  }

  setDashboardUrl(_url: string): void {
    // No-op in CI/logging mode
  }
}
