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

  componentDidCatch(error: Error): void {
    this.props.store.setScreenError(error);
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
