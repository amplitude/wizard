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

export class LoggingUI implements WizardUI {
  intro(message: string): void {
    console.log(`┌  ${message}`);
  }

  outro(message: string): void {
    console.log(`└  ${message}`);
  }

  cancel(message: string, options?: { docsUrl?: string }): void {
    console.log(`■  ${message}`);
    if (options?.docsUrl) {
      console.log(`│  Manual setup guide: ${options.docsUrl}`);
    }
  }

  log = {
    info(message: string): void {
      console.log(`│  ${message}`);
    },
    warn(message: string): void {
      console.log(`▲  ${message}`);
    },
    error(message: string): void {
      console.log(`✖  ${message}`);
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
    console.log(`▲  The setup agent is temporarily unavailable.`);
    console.log(`│  Status: ${data.description}`);
    console.log(`│  Status page: ${data.statusPageUrl}`);
    console.log(
      `│  The wizard may not work reliably while services are affected.`,
    );
  }

  showSettingsOverride(
    keys: string[],
    _backupAndFix: () => boolean,
  ): Promise<void> {
    console.log(
      `▲  Security warning: .claude/settings.json overrides detected`,
    );
    for (const key of keys) {
      console.log(`│    • ${key}`);
    }
    console.log(
      `│  These overrides prevent the Wizard from accessing the Amplitude LLM Gateway.`,
    );
    return Promise.resolve();
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
    projectId: number;
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
}
