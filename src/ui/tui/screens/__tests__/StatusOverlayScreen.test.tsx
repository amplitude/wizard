/**
 * StatusOverlayScreen — behaviour tests for the `/status` overlay.
 *
 * Covers:
 *   - Empty store: renders the no-session / no-actionables fallback.
 *   - Seeded store: renders pending choices, pending verifications,
 *     MCP capabilities, owned artifacts, and the next action.
 *   - Anti-nag visibility: an `install_skipped` MCP capability surfaces
 *     in the overlay (so users can audit) but is NOT rendered as a
 *     "needs your input" prompt.
 */
import React from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { StatusOverlayScreen } from '../StatusOverlayScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import {
  getOrchestrationStore,
  _resetOrchestrationStoreCache,
} from '../../../../lib/orchestration/store.js';
import { ChoiceKind } from '../../../../lib/orchestration/checkpoints/choices.js';
import { VerificationKind } from '../../../../lib/orchestration/checkpoints/verifications.js';
import {
  McpAppCapabilityKind,
  McpAppCapabilityState,
} from '../../../../lib/orchestration/mcp-app-lifecycle.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-overlay-'));
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = path.join(tmpDir, '.cache');
  _resetOrchestrationStoreCache();
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('StatusOverlayScreen', () => {
  it('renders all sections on a freshly-initialized store', () => {
    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    // All expected section headers present (PR 5 Operator Overview).
    expect(frame).toContain('Operator overview');
    expect(frame).toContain('Session');
    expect(frame).toContain('Primary work');
    expect(frame).toContain('Pending choices');
    expect(frame).toContain('Pending verifications');
    expect(frame).toContain('Next:');
  });

  it('surfaces a pending choice with all required UX fields', () => {
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'Test' });
    orch.addChoice({
      kind: ChoiceKind.EnvironmentSelection,
      promptId: `env_select:${tmpDir}`,
      message: 'Pick the environment to instrument',
      options: [
        {
          id: 'env-prod',
          label: 'Acme / web / prod',
          description: 'live traffic',
        },
        { id: 'env-dev', label: 'Acme / web / dev' },
      ],
      recommendedOptionId: 'env-prod',
      safeDefaultOptionId: 'env-prod',
      requiresHuman: true,
      automationAllowed: false,
      consequenceIfSkipped: 'No env, no events.',
      reversible: true,
      whyAsking: 'Multiple environments detected.',
      resumeCommand: ['npx', '@amplitude/wizard'],
      linkedSessionId: session.id,
    });

    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toContain('Pick the environment to instrument');
    expect(frame).toContain('Multiple environments detected'); // why
    expect(frame).toContain('Acme / web / prod'); // recommended
    expect(frame).toContain('reversible: yes');
    expect(frame).toContain('No env, no events'); // consequence
  });

  it('surfaces a pending manual verification', () => {
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'Test' });
    orch.addVerification({
      kind: VerificationKind.ManualPrTest,
      whatToVerify: 'Open PR and run npm test',
      expectedBehavior: 'Tests pass + dashboard chart populates',
      blockingSessionId: session.id,
      unblockerHint: 'After tests pass, run `wizard verification mark <id> --status passed`',
      resumeCommand: ['npx', '@amplitude/wizard'],
    });

    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toContain('Open PR and run npm test');
    expect(frame).toContain('Tests pass + dashboard chart populates');
    expect(frame).toContain('After tests pass'); // unblocker hint
  });

  it('lists MCP capabilities including install_skipped (anti-nag visible-but-not-prompting)', () => {
    const orch = getOrchestrationStore(tmpDir);
    const session = orch.createSession({ goal: 'Test' });
    const cap = orch.addMcpCapability({
      kind: McpAppCapabilityKind.AmplitudeMcpHttp,
      whyNeeded: 'Chat with your charts',
      whatItEnables: 'Charts + dashboards',
      required: false,
      consequenceIfSkipped: 'No chat charts',
      safeToSkip: true,
      reversible: true,
      userDecisionResumeCommand: ['npx', '@amplitude/wizard', '/mcp'],
      linkedSessionId: session.id,
    });
    orch.transitionMcpCapability(
      cap.id,
      McpAppCapabilityState.NeedsUserChoice,
      null,
    );
    orch.transitionMcpCapability(
      cap.id,
      McpAppCapabilityState.InstallSkipped,
      'user-declined-on-prompt',
    );

    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toContain('MCP capabilities');
    expect(frame).toContain('amplitude_mcp_http');
    expect(frame).toContain('install_skipped');
    // The reason is surfaced — anti-nag context.
    expect(frame).toContain('user-declined-on-prompt');
    // It must NOT appear in the "Pending" sections, i.e. the user
    // doesn't get re-prompted.
    const pendingChoicesSection = frame.split('Pending choices')[1] ?? '';
    expect(pendingChoicesSection.split('Pending verifications')[0] ?? '')
      .not.toContain('amplitude_mcp_http');
  });

  it('shows the recommended next action and resume command', () => {
    const orch = getOrchestrationStore(tmpDir);
    orch.createSession({ goal: 'Test' });

    const store = makeStoreForSnapshot({ installDir: tmpDir });
    const { frame } = renderSnapshot(
      <StatusOverlayScreen store={store} />,
      store,
    );
    expect(frame).toMatch(/resume command:/i);
  });

  describe('mode badge', () => {
    // Default test env has no agent/ci/mcp env vars set, so resolveMode()
    // falls through to `interactive`. Mirror HeaderBar: in plain
    // interactive mode the `[interactive]` badge is suppressed (would
    // just be noise on every overlay). Non-interactive modes still
    // surface the badge so operators see at a glance which mode the
    // wizard is running in.
    const ENV_KEYS = [
      'AMPLITUDE_WIZARD_AGENT_MODE',
      'AMPLITUDE_WIZARD_CI',
      'AMPLITUDE_WIZARD_MCP_SERVE',
      'CI',
      'CLAUDECODE',
      'CLAUDE_CODE_ENTRYPOINT',
    ] as const;
    let saved: Record<string, string | undefined>;
    beforeEach(() => {
      saved = Object.fromEntries(
        ENV_KEYS.map((k) => [k, process.env[k]]),
      );
      for (const k of ENV_KEYS) delete process.env[k];
    });
    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('suppresses the badge in plain interactive mode', () => {
      const store = makeStoreForSnapshot({ installDir: tmpDir });
      const { frame } = renderSnapshot(
        <StatusOverlayScreen store={store} />,
        store,
      );
      expect(frame).toContain('Operator overview');
      expect(frame).not.toContain('[interactive]');
    });

    it('shows the badge when running in agent mode', () => {
      process.env.AMPLITUDE_WIZARD_AGENT_MODE = '1';
      const store = makeStoreForSnapshot({ installDir: tmpDir });
      const { frame } = renderSnapshot(
        <StatusOverlayScreen store={store} />,
        store,
      );
      expect(frame).toContain('[agent]');
    });
  });
});
