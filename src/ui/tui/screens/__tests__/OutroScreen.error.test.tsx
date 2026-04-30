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
import * as fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutroScreen, exitCodeForOutroKind } from '../OutroScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { OutroKind } from '../../session-constants.js';
import { toWizardDashboardOpenUrl } from '../../../../utils/dashboard-open-url.js';
import { ExitCode } from '../../../../lib/exit-codes.js';

const GATEWAY_DOWN_MESSAGE = `Amplitude LLM gateway unavailable

Every retry attempt failed with the same upstream error (API Error: 400 terminated). This is an issue with the Amplitude LLM gateway, not your project.

Workaround: re-run with a direct Anthropic API key to bypass the Amplitude gateway:
  ANTHROPIC_API_KEY=sk-ant-... npx @amplitude/wizard

Or wait a few minutes and try again — gateway incidents typically resolve quickly.

If this persists, please report it (with the log file at ${join(
  tmpdir(),
  'amplitude-wizard.log',
)}) to: wizard@amplitude.com`;

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
    const canonicalDashboard =
      'https://app.amplitude.com/analytics/d/abc123';
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Success,
        changes: ['Set up tracking plan'],
      },
      checklistDashboardUrl: canonicalDashboard,
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Your dashboard is ready');
    expect(frame).toContain(toWizardDashboardOpenUrl(canonicalDashboard));
    expect(frame).toContain('Open your analytics dashboard');
    expect(frame).not.toContain('Open Amplitude');
  });

  it('uses the generic Open Amplitude label when no dashboard URL is set', () => {
    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Success, changes: ['x'] },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Open Amplitude');
    expect(frame).not.toContain('Your dashboard is ready');
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

  // ── Regression: "Press any key to exit" doesn't work ────────────────────
  //
  // If the user opened the slash console (e.g. `/feedback`) and the wizard
  // transitioned to the OutroScreen before the input deactivated,
  // `commandMode` stayed true. `useScreenInput` is gated on `!commandMode`,
  // so the outro's "any-key dismisses" handler was inactive — every keypress
  // was silently consumed by the dormant text input and the outro appeared
  // unresponsive. Force-deactivate on mount so the outro always owns input.
  it('forces commandMode off on mount (cancel path)', () => {
    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Cancel, message: 'Setup cancelled.' },
    });
    // Simulate a user with the slash console still active when the wizard
    // routes to outro.
    store.setCommandMode(true);
    expect(store.commandMode).toBe(true);

    renderSnapshot(<OutroScreen store={store} />, store);

    expect(store.commandMode).toBe(false);
  });

  it('forces commandMode off on mount (error path)', () => {
    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Error, message: 'Setup failed.' },
    });
    store.setCommandMode(true);

    renderSnapshot(<OutroScreen store={store} />, store);

    expect(store.commandMode).toBe(false);
  });

  // ── Regression: screen-initiated dismissal must honor the outro kind ────
  //
  // PR #379 wired `wizardSuccessExit(0)` into the outro's dismissal
  // handler so that screens which navigate to outro via setOutroData
  // (without going through wizardAbort) actually exit when the user
  // presses any key. Hardcoding `0` was a regression though: every
  // user-cancelled run reported success to CI / outer agents (USER_CANCELLED
  // = 130 and AGENT_FAILED = 10 exist in lib/exit-codes.ts but were unused
  // on this path). This guard locks the kind→code mapping in.
  describe('exitCodeForOutroKind', () => {
    it('maps Cancel → USER_CANCELLED (130)', () => {
      expect(exitCodeForOutroKind(OutroKind.Cancel)).toBe(
        ExitCode.USER_CANCELLED,
      );
    });

    it('maps Error → AGENT_FAILED (10)', () => {
      expect(exitCodeForOutroKind(OutroKind.Error)).toBe(ExitCode.AGENT_FAILED);
    });

    it('maps Success → SUCCESS (0)', () => {
      expect(exitCodeForOutroKind(OutroKind.Success)).toBe(ExitCode.SUCCESS);
    });

    it('maps undefined → SUCCESS (0) for defense in depth', () => {
      // Undefined isn't reachable in practice — outroData has a kind by
      // the time this screen renders — but the helper should still produce
      // a sane code instead of NaN / undefined leaking into process.exit.
      expect(exitCodeForOutroKind(undefined)).toBe(ExitCode.SUCCESS);
    });
  });

  it('renders the MCP_MISSING copy without leaking "MCP" jargon', () => {
    // Mirrors what agent-runner.ts emits for AgentErrorType.MCP_MISSING.
    // The wizard's user is installing Amplitude — they shouldn't have to
    // learn what an MCP server is to read an error message.
    const message = `Couldn't reach Amplitude's setup service — this looks like a network or service issue.\n\nTry again in a moment, or set up Next.js manually:\nhttps://amplitude.com/docs/sdks/sdks/typescript-browser`;
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message,
        docsUrl: 'https://amplitude.com/docs/get-started/quickstart',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain("Couldn't reach Amplitude's setup service");
    expect(frame).toContain('Try again in a moment');
    expect(frame).toContain('set up Next.js manually');
    // The whole point of the rewrite — internal jargon must not leak.
    expect(frame).not.toMatch(/\bMCP\b/);
    expect(frame).not.toContain('wizard MCP service');
    expect(frame).not.toContain('in-process tooling server');
  });

  it('renders the RESOURCE_MISSING copy without leaking "setup resource" jargon', () => {
    const message = `Couldn't load setup instructions for Vue — this may be a temporary service issue or a version mismatch.\n\nTry again in a moment, or set up Vue manually:\nhttps://amplitude.com/docs/sdks/sdks/typescript-browser`;
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message,
        docsUrl: 'https://amplitude.com/docs/get-started/quickstart',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain("Couldn't load setup instructions for Vue");
    expect(frame).toContain('Try again in a moment');
    expect(frame).not.toMatch(/\bMCP\b/);
    // Old copy used the generic phrase "setup resource" which doesn't
    // mean anything to a user trying to install Amplitude.
    expect(frame).not.toContain('the setup resource');
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

// ── Full-activation re-runs (returning users with a healthy project) ──
//
// When a user re-runs the wizard against a project that's already
// ingesting events, `activationLevel === 'full'` causes the flow to
// skip Run + DataIngestionCheck. The agent never executes, which means
// `outroData` is null AND the in-process dashboard-URL watcher never
// fires. The OutroScreen has to handle this case directly: synthesize a
// success state, read the persisted dashboard URL from disk, and
// surface it prominently — otherwise the user lands on a mute
// "Finishing up…" placeholder forever.
describe('OutroScreen — full-activation re-runs', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'outro-full-test-'));
  });

  afterEach(() => {
    try {
      rmSync(installDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('renders a calm "project is healthy" success when activationLevel is full and outroData is null', () => {
    const store = makeStoreForSnapshot({
      outroData: null,
      activationLevel: 'full',
      selectedProjectName: 'Acme Analytics',
      installDir,
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Your Amplitude project is healthy');
    expect(frame).toContain('Acme Analytics is already ingesting events');
    // The "live!" celebration is for fresh installs only — it would feel
    // false to a returning user whose project was already healthy when
    // they ran the wizard.
    expect(frame).not.toContain('Amplitude is live');
    // Must NOT fall through to "Finishing up…" — that was the bug.
    expect(frame).not.toContain('Finishing up');
  });

  it('surfaces the dashboard URL read from .amplitude/dashboard.json on disk', () => {
    fs.mkdirSync(join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      join(installDir, '.amplitude', 'dashboard.json'),
      JSON.stringify({
        dashboardUrl: 'https://app.amplitude.com/analytics/d/persisted-1',
      }),
    );

    const store = makeStoreForSnapshot({
      outroData: null,
      activationLevel: 'full',
      selectedProjectName: 'Acme Analytics',
      installDir,
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Your dashboard is ready');
    // Use a unique substring of the dashboard ID — the full URL gets
    // line-wrapped at 80 cols, so toContain on the entire URL fails.
    expect(frame).toContain('persisted-1');
    // The wrapped URL flows through the same toWizardDashboardOpenUrl
    // helper; verify the redirect host is present rather than the whole
    // URL.
    expect(frame).toContain('app.amplitude.com/login');
    // Returning-user copy on the dashboard hero — fresh-install copy
    // would mention "first charts populate" and feel weird to a user
    // who's been collecting data for months.
    expect(frame).toContain('see what your users are up to today');
    expect(frame).not.toContain('first charts populate');
  });

  it('reads the legacy .amplitude-dashboard.json when canonical is absent', () => {
    fs.writeFileSync(
      join(installDir, '.amplitude-dashboard.json'),
      JSON.stringify({
        dashboardUrl: 'https://app.amplitude.com/analytics/d/legacy-2',
      }),
    );

    const store = makeStoreForSnapshot({
      outroData: null,
      activationLevel: 'full',
      installDir,
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Your dashboard is ready');
    expect(frame).toContain('legacy-2');
  });

  it('falls back gracefully to "Open Amplitude" when no dashboard file exists', () => {
    const store = makeStoreForSnapshot({
      outroData: null,
      activationLevel: 'full',
      installDir,
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    // Heading still renders — the user is not stranded.
    expect(frame).toContain('Your Amplitude project is healthy');
    // No dashboard hero block, but the picker still offers a way out.
    expect(frame).not.toContain('Your dashboard is ready');
    expect(frame).toContain('Open Amplitude');
  });

  it('silently skips a malformed dashboard.json without crashing', () => {
    fs.mkdirSync(join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      join(installDir, '.amplitude', 'dashboard.json'),
      'this is not valid json {{',
    );

    const store = makeStoreForSnapshot({
      outroData: null,
      activationLevel: 'full',
      installDir,
    });
    expect(() =>
      renderSnapshot(<OutroScreen store={store} />, store),
    ).not.toThrow();
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Your Amplitude project is healthy');
    expect(frame).not.toContain('Your dashboard is ready');
  });

  it('rejects a non-https dashboardUrl as suspect / hand-edited', () => {
    fs.mkdirSync(join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      join(installDir, '.amplitude', 'dashboard.json'),
      JSON.stringify({ dashboardUrl: 'javascript:alert(1)' }),
    );

    const store = makeStoreForSnapshot({
      outroData: null,
      activationLevel: 'full',
      installDir,
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).not.toContain('Your dashboard is ready');
    expect(frame).not.toContain('javascript:');
  });

  it('does not synthesize success for partial activation (those users still saw Run)', () => {
    const store = makeStoreForSnapshot({
      outroData: null,
      activationLevel: 'partial',
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    // Partial users go through Run; if they reach Outro with no data
    // it's a different bug — render the placeholder so we don't mask it.
    expect(frame).toContain('Finishing up');
  });

  it('prefers session.checklistDashboardUrl over the on-disk file', () => {
    fs.mkdirSync(join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      join(installDir, '.amplitude', 'dashboard.json'),
      JSON.stringify({
        dashboardUrl: 'https://app.amplitude.com/analytics/d/from-disk',
      }),
    );

    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Success, changes: [] },
      activationLevel: 'full',
      checklistDashboardUrl: 'https://app.amplitude.com/analytics/d/from-session',
      installDir,
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('from-session');
    expect(frame).not.toContain('from-disk');
  });
});
