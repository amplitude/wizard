/**
 * ScreenErrorBoundary — catches React render errors in screens
 * and surfaces them in ConsoleView via store.screenError.
 *
 * The error is displayed between the content area and the text input.
 * Pressing R in ConsoleView increments store.screenErrorRetry, which
 * causes this boundary to reset and re-render the screen.
 */

import { Component, type ReactNode } from 'react';
import type { WizardStore } from '../store.js';

interface Props {
  store: WizardStore;
  retryToken: number;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(
    error: Error,
    errorInfo: { componentStack?: string | null },
  ): void {
    this.props.store.setScreenError(error);

    // Audit 6.1 — emit a redacted diagnostic snapshot so support can
    // reproduce the boundary trigger. Writes to stderr (leaving stdout
    // clean for NDJSON consumers) and to the wizard log file.
    try {
      const store = this.props.store;
      void import('../utils/diagnostics.js')
        .then(({ createDiagnosticSnapshot }) => {
          const snapshot = createDiagnosticSnapshot(
            store,
            (store as { version?: string }).version ?? 'dev',
          );
          const payload = {
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
              component_stack: errorInfo.componentStack ?? null,
            },
            snapshot,
          };
          try {
            process.stderr.write(
              '\n[screen-error] diagnostic snapshot:\n' +
                JSON.stringify(payload, null, 2) +
                '\n',
            );
          } catch {
            // broken pipe — ignore
          }
          void import('../../../utils/debug.js')
            .then(({ logToFile }) => {
              logToFile(
                `[screen-error] ${error.name}: ${
                  error.message
                }\n${JSON.stringify(payload, null, 2)}`,
              );
            })
            .catch(() => {
              // non-fatal
            });
        })
        .catch(() => {
          // diagnostics import failure is non-fatal
        });
    } catch {
      // Never let diagnostics bubble another error out of the boundary.
    }
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.retryToken !== this.props.retryToken && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    // When errored, render nothing — ConsoleView shows the banner.
    if (this.state.error) return null;
    return this.props.children;
  }
}
