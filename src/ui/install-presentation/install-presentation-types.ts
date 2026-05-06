/**
 * Install-time presentation boundary (ported from wizard-rewrite's
 * `WizardInstallPresentation`, without a `pino` type dependency).
 *
 * Orchestration code depends on this interface; Ink / Inquirer / NDJSON /
 * logging implement it. See {@link createWizardUiInstallPresentation}.
 */

export interface InstallSpinnerPresenter {
  start(message: string): void;
  setMessage(message: string): void;
  stop(finalMessage?: string): void;
}

/**
 * Minimal logger shape for install surfaces. Callers may adapt `pino`, the
 * structured file logger, or {@link WizardUI} `log`.
 */
export interface WizardInstallPresentationLog {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface WizardInstallPresentation {
  readonly log: WizardInstallPresentationLog;

  readonly supportsRichPrompts: boolean;
  /** e.g. `ink-wizard-ui`, `machine-json`, `clack-human` (rewrite parity). */
  readonly surfaceId: string;

  intro(title: string, subtitle?: string): void;

  promptPassword(opts: { message: string }): Promise<string | null>;

  confirm(opts: {
    message: string;
    initial?: boolean;
  }): Promise<boolean | null>;

  selectFramework(opts: {
    message: string;
    options: { value: string; label: string }[];
  }): Promise<string | null>;

  createInstallSpinner(): InstallSpinnerPresenter;

  emitResultLine(icon: string, line: string): void;

  emitWarningLine(line: string): void;

  emitPlainStdoutLine(line: string): void;

  emitPlainStderr(line: string): void;

  appendAgentText?(delta: string): void;

  appendToolStart?(
    toolOrOpts: { toolName: string; input?: unknown } | string,
    summary?: string,
  ): void;

  appendToolResult?(
    toolOrOpts:
      | { toolName: string; error?: unknown; result?: unknown }
      | string,
    summary?: string,
    ok?: boolean,
  ): void;

  outroSuccess(message: string): void;

  outroDryRun(message?: string): void;

  exitIncomplete(message?: string): void;

  interruptFirstStrike(message: string): void;

  cancel(message: string): void;
}
