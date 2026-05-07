import type {
  InstallSpinnerPresenter,
  WizardInstallPresentation,
  WizardInstallPresentationLog,
} from './install-presentation-types.js';

class NoopSpinner implements InstallSpinnerPresenter {
  start(_message: string): void {}
  setMessage(_message: string): void {}
  stop(_finalMessage?: string): void {}
}

const noopLog: WizardInstallPresentationLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Test / harness surface: no stdout, no throws on prompt methods (returns null /
 * false). Prefer {@link createWizardUiInstallPresentation} for production.
 */
export function createNoopWizardInstallPresentation(
  surfaceId = 'noop',
): WizardInstallPresentation {
  return {
    log: noopLog,
    supportsRichPrompts: false,
    surfaceId,

    intro() {},

    promptPassword() {
      return Promise.resolve(null);
    },

    confirm(_opts) {
      return Promise.resolve(false);
    },

    selectFramework() {
      return Promise.resolve(null);
    },

    createInstallSpinner() {
      return new NoopSpinner();
    },

    emitResultLine() {},

    emitWarningLine() {},

    emitPlainStdoutLine() {},

    emitPlainStderr() {},

    outroSuccess() {},

    outroDryRun() {},

    exitIncomplete() {},

    interruptFirstStrike() {},

    cancel() {},
  };
}
