/**
 * PR 8 integration tests — verifies that ExtrasPanel renders without
 * crashing inside each touched screen when WIZARD_NEW_UX=1 is set.
 *
 * The legacy path is exercised by the existing `*.snap.test.tsx`
 * snapshot files (which were updated to confirm the gate works the
 * other direction — env-unset means byte-identical output).
 *
 * We assert on the panel's label text rather than a full-frame
 * snapshot because:
 *   - The host screens already snapshot under WIZARD_NEW_UX=undefined;
 *     a second full snapshot per screen doubles maintenance for
 *     marginal value.
 *   - Spinner frames in the `installing` state are time-dependent and
 *     would force fake-timer harnesses across multiple files.
 *   - Asserting on rendered labels is enough to prove the integration
 *     wired up: an import or props mismatch blows up the render, and
 *     the panel's own unit tests in ExtrasPanel.test.tsx cover the
 *     state-matrix details.
 */

import React from 'react';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from 'vitest';
import { OutroScreen } from '../OutroScreen.js';
import { EventPlanFullScreen } from '../EventPlanFullScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { OutroKind } from '../../session-constants.js';
import { Integration } from '../../../../lib/constants.js';
import { McpOutcome, SlackOutcome } from '../../store.js';
import { configureLogFile } from '../../../../lib/observability/index.js';

const NEW_UX = 'WIZARD_NEW_UX';

describe('PR 8 — ExtrasPanel integration into screens', () => {
  beforeAll(() => {
    configureLogFile({ path: '<tmp>/amplitude-wizard.log' });
  });

  const previousFlag = process.env[NEW_UX];

  beforeEach(() => {
    process.env[NEW_UX] = '1';
  });
  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env[NEW_UX];
    } else {
      process.env[NEW_UX] = previousFlag;
    }
  });

  it('OutroScreen success path includes the Extras receipt on a web framework', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Success,
        changes: ['Installed @amplitude/analytics-browser'],
      },
      integration: Integration.nextjs,
      mcpOutcome: McpOutcome.Installed,
      mcpInstalledClients: ['Claude Code', 'Cursor'],
      slackOutcome: SlackOutcome.Skipped,
      sessionReplayOptIn: true,
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Extras');
    expect(frame).toContain('Amplitude MCP');
    expect(frame).toContain('Claude Code + Cursor');
    expect(frame).toContain('Slack');
    expect(frame).toContain('Session Replay');
  });

  it('OutroScreen success path omits Session Replay on a native framework', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Success,
        changes: ['Installed Amplitude Android SDK'],
      },
      integration: Integration.android,
      mcpOutcome: McpOutcome.Skipped,
      slackOutcome: SlackOutcome.Skipped,
      sessionReplayOptIn: false,
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Extras');
    expect(frame).toContain('Amplitude MCP');
    expect(frame).toContain('Slack');
    // Session Replay is framework-gated out.
    expect(frame).not.toContain('Session Replay');
  });

  it('EventPlanFullScreen renders the "Also queued" footer when WIZARD_NEW_UX=1', () => {
    const store = makeStoreForSnapshot({
      integration: Integration.nextjs,
      mcpComplete: false,
      slackComplete: false,
    });
    const view = renderSnapshot(
      <EventPlanFullScreen
        store={store}
        events={[
          { name: 'signup', description: 'User created an account' },
          { name: 'login', description: 'User signed in' },
        ]}
        width={80}
        height={24}
      />,
      store,
    );
    expect(view.frame).toContain('Also queued');
    expect(view.frame).toContain('Amplitude MCP');
    expect(view.frame).toContain('Slack');
    expect(view.frame).toContain('Session Replay');
  });
});
