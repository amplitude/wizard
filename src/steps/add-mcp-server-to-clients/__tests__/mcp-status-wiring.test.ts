/**
 * PR B7 — wire-level regression test for the `mcp_status` events
 * emitted by `addMCPServerToClientsStep` (the agent-mode / CLI path
 * that doesn't go through the TUI McpScreen).
 *
 * Today the step's `getSupportedClients` callsite is internal to the
 * same module, so we can't dependency-inject it cleanly without a
 * refactor; instead we cover the two branches that don't require
 * client detection at all — CI-mode short-circuit (which exits before
 * detection) and the explicit emit shape. The remaining branches
 * (not_applicable / installed / failed) are covered end-to-end by
 * the AgentUI envelope test in
 * `src/ui/__tests__/agent-ui-mcp-status.test.ts`, which pins the
 * wire shape that all callers (this step, McpScreen, agent-interface)
 * route through.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { addMCPServerToClientsStep } from '../index';
import { setUI, getUI } from '../../../ui/index';
import { LoggingUI } from '../../../ui/logging-ui';

vi.mock('../../../telemetry', () => ({
  traceStep: vi.fn(async (_label: string, fn: () => Promise<void>) => fn()),
}));

vi.mock('../../../utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

vi.mock('../../../utils/debug', () => ({
  logToFile: vi.fn(),
  debug: vi.fn(),
}));

/**
 * Install a recording `emitMcpStatus` spy onto the live UI singleton.
 * Returns the captured calls (cleared between tests via beforeEach).
 */
function installEmitSpy(): {
  calls: Array<{
    server: string;
    state: string;
    transition_ts: number;
    detail?: string;
  }>;
  restore: () => void;
} {
  const calls: Array<{
    server: string;
    state: string;
    transition_ts: number;
    detail?: string;
  }> = [];
  const ui = new LoggingUI() as LoggingUI & {
    emitMcpStatus?: (data: {
      server: string;
      state: string;
      transition_ts: number;
      detail?: string;
    }) => void;
  };
  ui.emitMcpStatus = (data) => {
    calls.push(data);
  };
  // Stub the chatty log surface so the test stdout stays readable.
  ui.log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
  };
  const previous = getUI();
  setUI(ui);
  return { calls, restore: () => setUI(previous) };
}

describe('addMCPServerToClientsStep — mcp_status wiring (PR B7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits editor_install/install_skipped when CI mode short-circuits', async () => {
    // CI mode is the one branch that never calls the host
    // filesystem (it short-circuits before `getSupportedClients`).
    // Verifies the lifecycle event fires AND that the early return
    // skips the supported-clients probe entirely.
    const { calls, restore } = installEmitSpy();
    try {
      const result = await addMCPServerToClientsStep({ ci: true });
      expect(result).toEqual([]);
      expect(calls.length).toBe(1);
      expect(calls[0].server).toBe('editor_install');
      expect(calls[0].state).toBe('install_skipped');
      expect(typeof calls[0].transition_ts).toBe('number');
      expect(calls[0].detail).toContain('CI mode');
    } finally {
      restore();
    }
  });

  it('ships a numeric transition_ts close to the wall clock', async () => {
    const before = Date.now();
    const { calls, restore } = installEmitSpy();
    try {
      await addMCPServerToClientsStep({ ci: true });
      const after = Date.now();
      expect(calls[0].transition_ts).toBeGreaterThanOrEqual(before);
      expect(calls[0].transition_ts).toBeLessThanOrEqual(after);
    } finally {
      restore();
    }
  });

  it('never throws when emitMcpStatus is undefined on the active UI', async () => {
    // The optional-method contract: the step must work in TUI / CI
    // mode where `emitMcpStatus` is absent. A bare LoggingUI (no
    // spy installed) has no `emitMcpStatus` method, and the step
    // should still complete cleanly.
    const previous = getUI();
    const ui = new LoggingUI();
    ui.log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      step: vi.fn(),
    };
    setUI(ui);
    try {
      const result = await addMCPServerToClientsStep({ ci: true });
      expect(result).toEqual([]);
    } finally {
      setUI(previous);
    }
  });
});
