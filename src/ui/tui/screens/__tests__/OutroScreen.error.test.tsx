/**
 * OutroScreen — extra coverage beyond the canonical success/error/cancel
 * snapshots in OutroScreen.snap.test.tsx.
 *
 * Specifically:
 *   1. The GATEWAY_DOWN regression from PR #266 — the agent-runner formats a
 *      multi-line error message with a workaround paragraph and a
 *      wizard@amplitude.com mailto. We assert the message survives intact
 *      through OutroScreen render (including newlines) and is not
 *      truncated by the layout container.
 *   2. The success view with a checklistDashboardUrl shows the dashboard
 *      block AND swaps the second picker label from "Open Amplitude" to
 *      "Open your analytics dashboard" — easy to silently break with a
 *      copy edit.
 *   3. The "Finishing up…" placeholder when outroData is still null —
 *      verifies the screen never renders an empty frame after route.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { OutroScreen } from '../OutroScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { OutroKind } from '../../session-constants.js';

const GATEWAY_DOWN_MESSAGE = `Amplitude LLM gateway unavailable

Every retry attempt failed with the same upstream error (API Error: 400 terminated). This is an issue with the Amplitude LLM gateway, not your project.

Workaround: re-run with a direct Anthropic API key to bypass the Amplitude gateway:
  ANTHROPIC_API_KEY=sk-ant-... npx @amplitude/wizard

Or wait a few minutes and try again — gateway incidents typically resolve quickly.

If this persists, please report it (with the log file at /tmp/amplitude-wizard.log) to: wizard@amplitude.com`;

describe('OutroScreen — error variants', () => {
  it('renders the multi-line GATEWAY_DOWN message verbatim', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message: GATEWAY_DOWN_MESSAGE,
        docsUrl: 'https://amplitude.com/docs/get-started/quickstart',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);

    // Heading still shown
    expect(frame).toContain('Setup failed');
    // Each substantive line of the error is preserved
    expect(frame).toContain('Amplitude LLM gateway unavailable');
    expect(frame).toContain('Workaround: re-run with a direct');
    expect(frame).toContain('ANTHROPIC_API_KEY=sk-ant-');
    expect(frame).toContain('wizard@amplitude.com');
    // Docs fallback still rendered
    expect(frame).toContain('Docs:');
  });

  it('renders the success path with --debug hint absent (only error path mentions it)', () => {
    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Success, changes: [] },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Amplitude is live');
    expect(frame).not.toContain('--debug');
  });

  it('uses the dashboard-aware label when checklistDashboardUrl is set', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Success,
        changes: ['Set up tracking plan'],
      },
      checklistDashboardUrl: 'https://app.amplitude.com/analytics/d/abc123',
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Dashboard ready');
    expect(frame).toContain('https://app.amplitude.com/analytics/d/abc123');
    expect(frame).toContain('Open your analytics dashboard');
    expect(frame).not.toContain('Open Amplitude');
  });

  it('uses the generic Open Amplitude label when no dashboard URL is set', () => {
    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Success, changes: ['x'] },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Open Amplitude');
    expect(frame).not.toContain('Dashboard ready');
  });

  it('falls back to "Finishing up…" when outroData is still null', () => {
    const store = makeStoreForSnapshot({ outroData: null });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Finishing up');
  });

  it('prompts "Press any key to exit" on the cancel path', () => {
    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Cancel, message: 'Setup cancelled.' },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Press any key to exit');
    // Cancel path must NOT show the success picker actions
    expect(frame).not.toContain('View setup report');
  });

  it('shows event count + env name in success summary when events were planned', () => {
    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Success, changes: ['x'] },
      selectedEnvName: 'Production',
    });
    store.setEventPlan([
      { name: 'signup_started', description: 'User started signup' },
      { name: 'signup_completed', description: 'User finished signup' },
    ]);
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('2 events instrumented in Production');
    expect(frame).toContain('signup_started');
    expect(frame).toContain('signup_completed');
  });
});
