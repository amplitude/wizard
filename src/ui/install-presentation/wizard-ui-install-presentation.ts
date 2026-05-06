import type { WizardUI } from '../wizard-ui.js';
import type {
  InstallSpinnerPresenter,
  WizardInstallPresentation,
  WizardInstallPresentationLog,
} from './install-presentation-types.js';

function buildLogAdapter(ui: WizardUI): WizardInstallPresentationLog {
  return {
    debug(obj, msg) {
      const suffix = msg ? ` ${msg}` : '';
      ui.log.step(`[install-debug]${suffix} ${JSON.stringify(obj)}`);
    },
    info(msg) {
      ui.log.info(msg);
    },
    warn(msg) {
      ui.log.warn(msg);
    },
    error(msg) {
      ui.log.error(msg);
    },
  };
}

class WizardUiSpinnerPresenter implements InstallSpinnerPresenter {
  constructor(private readonly inner: ReturnType<WizardUI['spinner']>) {}

  start(message: string): void {
    this.inner.start(message);
  }

  setMessage(message: string): void {
    this.inner.message(message);
  }

  stop(finalMessage?: string): void {
    this.inner.stop(finalMessage);
  }
}

/**
 * Maps {@link WizardInstallPresentation} onto the existing {@link WizardUI}
 * abstraction (Ink / Logging / Agent consumers all implement `WizardUI`).
 *
 * **Interactive prompts** (`promptPassword`, `confirm`, `selectFramework`)
 * are not implemented here: the shipped wizard owns prompts through full-screen
 * Ink flows. This surface throws — same contract as wizard-rewrite's
 * `MachineJsonInstallPresentation` — until a future phase routes install-graph
 * prompts through Inquirer or dedicated TUI hooks.
 */
export function createWizardUiInstallPresentation(
  ui: WizardUI,
  surfaceId: string,
): WizardInstallPresentation {
  const log = buildLogAdapter(ui);

  const notInteractive = (method: string): never => {
    throw new Error(
      `${surfaceId}: ${method} is not available on the WizardUI-backed install surface ` +
        `(prompts are owned by Ink screens today; use a dedicated Inquirer or TUI bridge when the install graph lands).`,
    );
  };

  return {
    log,
    supportsRichPrompts: false,
    surfaceId,

    intro(title: string, subtitle?: string): void {
      const full = subtitle ? `${title} — ${subtitle}` : title;
      ui.intro(full);
    },

    promptPassword(_opts: { message: string }): Promise<string | null> {
      return Promise.resolve().then(() => notInteractive('promptPassword'));
    },

    confirm(_opts: {
      message: string;
      initial?: boolean;
    }): Promise<boolean | null> {
      return Promise.resolve().then(() => notInteractive('confirm'));
    },

    selectFramework(_opts: {
      message: string;
      options: { value: string; label: string }[];
    }): Promise<string | null> {
      return Promise.resolve().then(() => notInteractive('selectFramework'));
    },

    createInstallSpinner(): InstallSpinnerPresenter {
      return new WizardUiSpinnerPresenter(ui.spinner());
    },

    emitResultLine(icon: string, line: string): void {
      ui.log.info(`${icon}  ${line}`);
    },

    emitWarningLine(line: string): void {
      ui.log.warn(line);
    },

    emitPlainStdoutLine(line: string): void {
      ui.note(line);
    },

    emitPlainStderr(line: string): void {
      ui.log.error(line);
    },

    appendAgentText(delta: string): void {
      if (!delta) return;
      ui.log.step(delta);
    },

    appendToolStart(
      toolOrOpts: { toolName: string; input?: unknown } | string,
      summary?: string,
    ): void {
      if (typeof toolOrOpts === 'string') {
        ui.log.step(summary ? `→ ${toolOrOpts} ${summary}` : `→ ${toolOrOpts}`);
        return;
      }
      ui.log.step(`→ ${toolOrOpts.toolName}${summary ? ` ${summary}` : ''}`);
    },

    appendToolResult(
      toolOrOpts:
        | { toolName: string; error?: unknown; result?: unknown }
        | string,
      summary?: string,
      ok?: boolean,
    ): void {
      if (typeof toolOrOpts === 'string') {
        const label = ok === false ? '✖' : '✔';
        ui.log.step(`${label} ${toolOrOpts}${summary ? ` ${summary}` : ''}`);
        return;
      }
      if (toolOrOpts.error != null) {
        const err = toolOrOpts.error;
        const message =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
            ? err
            : JSON.stringify(err);
        ui.log.warn(`${toolOrOpts.toolName}: ${message}`);
        return;
      }
      ui.log.step(`✔ ${toolOrOpts.toolName}`);
    },

    outroSuccess(message: string): void {
      ui.outro(message);
    },

    outroDryRun(message?: string): void {
      ui.log.info(message ?? 'Dry run — no changes written.');
    },

    exitIncomplete(message?: string): void {
      if (message) ui.log.warn(message);
    },

    interruptFirstStrike(message: string): void {
      ui.log.warn(message);
    },

    cancel(message: string): void {
      void ui.cancel(message);
    },
  };
}
