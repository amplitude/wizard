/**
 * Regression tests for the create-dashboard step.
 *
 * 1. The events-file reader delegates to parseEventPlanContent (the canonical
 *    parser) so it tolerates every field-name variant the agent emits in the
 *    wild — `name`, `event`, `eventName`, `event_name`.
 * 2. The fallback JSON extractor handles nested braces (the dashboard result
 *    embeds a `charts` array of objects).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { __test__, createDashboardStep } from '../create-dashboard';

const { readEventsFromContent, parseAgentOutput, extractJsonContaining } =
  __test__;

vi.mock('../../lib/mcp-with-fallback', () => ({
  callAmplitudeMcp: vi.fn(),
}));
vi.mock('../../lib/wizard-tools', () => ({
  persistDashboard: vi.fn(() => true),
}));
vi.mock('../../utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
vi.mock('../../utils/debug', () => ({ logToFile: vi.fn() }));
vi.mock('../../ui', () => {
  const ui = {
    pushStatus: vi.fn(),
    setDashboardUrl: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
    })),
    log: { warn: vi.fn() },
  };
  return { getUI: () => ui, __ui: ui };
});

import { callAmplitudeMcp } from '../../lib/mcp-with-fallback';
import { persistDashboard } from '../../lib/wizard-tools';
import { analytics } from '../../utils/analytics';

import * as uiModule from '../../ui';

describe('readEventsFromContent', () => {
  it('accepts canonical `name` key with bare top-level array', () => {
    const out = readEventsFromContent(
      JSON.stringify([
        { name: 'Signup Completed', description: 'User finished signup' },
      ]),
    );
    expect(out?.events[0].name).toBe('Signup Completed');
    expect(out?.events[0].description).toBe('User finished signup');
  });

  it('unwraps a `{ events: [...] }` wrapper object', () => {
    const out = readEventsFromContent(
      JSON.stringify({ events: [{ name: 'Project Created' }] }),
    );
    expect(out?.events[0].name).toBe('Project Created');
  });

  it('accepts legacy `event` key and normalizes to `name`', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ event: 'Project Created' }]),
    );
    expect(out?.events[0].name).toBe('Project Created');
  });

  it('accepts `eventName` (camelCase) key', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ eventName: 'Checkout Started' }]),
    );
    expect(out?.events[0].name).toBe('Checkout Started');
  });

  it('accepts `event_name` (snake_case) key — observed in the wild', () => {
    // Regression: the previous create-dashboard parser missed this variant
    // even though the canonical event-plan-parser handles it.
    const out = readEventsFromContent(
      JSON.stringify([{ event_name: 'External Resource Opened' }]),
    );
    expect(out?.events[0].name).toBe('External Resource Opened');
  });

  it('prefers `name` when multiple keys are present', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ name: 'Canonical', event: 'Legacy' }]),
    );
    expect(out?.events[0].name).toBe('Canonical');
  });

  it('returns null when no entry has a recognizable name key', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ description: 'orphan' }]),
    );
    expect(out).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(readEventsFromContent('[]')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(readEventsFromContent('{not json')).toBeNull();
  });

  it('filters out entries whose name is whitespace-only', () => {
    const out = readEventsFromContent(
      JSON.stringify([
        { name: 'Real Event' },
        { name: '   ' },
        { name: '\t\n' },
      ]),
    );
    expect(out?.events).toHaveLength(1);
    expect(out?.events[0].name).toBe('Real Event');
  });

  it('returns null when every entry has a whitespace-only name', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ name: ' ' }, { name: '   ' }]),
    );
    expect(out).toBeNull();
  });

  it('trims surrounding whitespace from event names', () => {
    const out = readEventsFromContent(
      JSON.stringify([{ name: '  Signup Completed  ' }]),
    );
    expect(out?.events[0].name).toBe('Signup Completed');
  });

  it('accepts `eventDescriptionAndReasoning` as description alias', () => {
    const out = readEventsFromContent(
      JSON.stringify([
        {
          name: 'Foo',
          eventDescriptionAndReasoning: 'Fires when users foo',
        },
      ]),
    );
    expect(out?.events[0].description).toBe('Fires when users foo');
  });
});

describe('extractJsonContaining', () => {
  it('extracts a flat object', () => {
    const text = 'prefix {"dashboardUrl":"https://x.com/d/1"} suffix';
    expect(extractJsonContaining(text, '"dashboardUrl"')).toBe(
      '{"dashboardUrl":"https://x.com/d/1"}',
    );
  });

  it('extracts an object containing a nested charts array', () => {
    const json =
      '{"dashboardUrl":"https://x.com/d/1","charts":[{"id":"c1","title":"Funnel"}]}';
    const text = `noise before ${json} noise after`;
    expect(extractJsonContaining(text, '"dashboardUrl"')).toBe(json);
  });

  it('handles deeply nested objects', () => {
    const json =
      '{"dashboardUrl":"https://x.com","meta":{"nested":{"deep":true}},"charts":[{"id":"1"}]}';
    expect(extractJsonContaining(json, '"dashboardUrl"')).toBe(json);
  });

  it('ignores braces inside string literals', () => {
    const json = '{"dashboardUrl":"https://x.com","note":"has { and } in it"}';
    expect(extractJsonContaining(json, '"dashboardUrl"')).toBe(json);
  });

  it('handles escaped quotes inside strings', () => {
    const json =
      '{"dashboardUrl":"https://x.com","note":"quote: \\" and brace }"}';
    expect(extractJsonContaining(json, '"dashboardUrl"')).toBe(json);
  });

  it('returns null when the needle is absent', () => {
    expect(
      extractJsonContaining('{"other":"value"}', '"dashboardUrl"'),
    ).toBeNull();
  });

  it('skips a leading object that lacks the needle and finds a later one', () => {
    const text =
      '{"unrelated":"x"} then {"dashboardUrl":"https://x.com","charts":[{"id":"1"}]}';
    expect(extractJsonContaining(text, '"dashboardUrl"')).toBe(
      '{"dashboardUrl":"https://x.com","charts":[{"id":"1"}]}',
    );
  });
});

describe('parseAgentOutput', () => {
  it('parses the happy path with markers', () => {
    const text = `Planning complete. <<<WIZARD_DASHBOARD_RESULT>>>{"dashboardUrl":"https://app.amplitude.com/1/dashboard/abc","dashboardId":"abc","charts":[{"id":"c1","title":"Funnel","type":"funnel"}]}<<<END>>> trailing noise`;
    const result = parseAgentOutput(text);
    expect(result).not.toBeNull();
    expect(result?.dashboardUrl).toBe(
      'https://app.amplitude.com/1/dashboard/abc',
    );
    expect(result?.charts).toHaveLength(1);
  });

  it('falls back to balanced JSON extraction when markers are missing', () => {
    const text = `I forgot the markers but here's the result: {"dashboardUrl":"https://app.amplitude.com/1/dashboard/abc","charts":[{"id":"c1","title":"Funnel"}]}`;
    const result = parseAgentOutput(text);
    expect(result).not.toBeNull();
    expect(result?.dashboardUrl).toBe(
      'https://app.amplitude.com/1/dashboard/abc',
    );
    expect(result?.charts).toHaveLength(1);
  });

  it('returns null when no dashboardUrl is present', () => {
    expect(parseAgentOutput('nothing useful here')).toBeNull();
  });

  it('returns null when the URL is not a valid URL', () => {
    const text = `<<<WIZARD_DASHBOARD_RESULT>>>{"dashboardUrl":"not-a-url"}<<<END>>>`;
    expect(parseAgentOutput(text)).toBeNull();
  });
});

// ── createDashboardStep — defensive skip when agent already created one ─────

describe('createDashboardStep — agent already created dashboard', () => {
  let installDir: string;

  const mockedCallAmplitudeMcp = callAmplitudeMcp as any;

  const mockedPersistDashboard = persistDashboard as any;

  const mockedWizardCapture = analytics.wizardCapture as any;

  const ui = (uiModule as any).__ui;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-dashboard-'));
    fs.writeFileSync(
      path.join(installDir, '.amplitude-events.json'),
      JSON.stringify([{ name: 'Hello API Called' }]),
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  function makeSession(): {
    installDir: string;
    checklistDashboardUrl?: string;
  } {
    return { installDir };
  }

  it('reuses an already-written .amplitude-dashboard.json without calling the agent', async () => {
    const dashboard = {
      dashboardUrl:
        'https://app.amplitude.com/analytics/amplitude/dashboard/y3qux0l8',
      dashboardId: 'y3qux0l8',
      charts: [{ id: 'c1', title: 'Top pages', type: 'line' }],
    };
    fs.writeFileSync(
      path.join(installDir, '.amplitude-dashboard.json'),
      JSON.stringify(dashboard),
    );
    const session = makeSession();

    await createDashboardStep({
      session: session as any,
      accessToken: 'token',

      integration: 'nextjs-pages-router' as any,
    });

    expect(mockedCallAmplitudeMcp).not.toHaveBeenCalled();
    expect(session.checklistDashboardUrl).toBe(dashboard.dashboardUrl);
    expect(ui.setDashboardUrl).toHaveBeenCalledWith(dashboard.dashboardUrl);
    expect(ui.spinner).not.toHaveBeenCalled();
    expect(mockedPersistDashboard).toHaveBeenCalledWith(installDir, dashboard);
    expect(mockedWizardCapture).toHaveBeenCalledWith(
      'dashboard created',
      expect.objectContaining({
        source: 'agent',
        'chart count': 1,
      }),
    );
  });

  it('falls through to agent fallback when .amplitude-dashboard.json is malformed', async () => {
    fs.writeFileSync(
      path.join(installDir, '.amplitude-dashboard.json'),
      '{ not json',
    );
    mockedCallAmplitudeMcp.mockResolvedValue(null);
    const session = makeSession();

    await createDashboardStep({
      session: session as any,
      accessToken: 'token',

      integration: 'nextjs-pages-router' as any,
    });

    expect(mockedCallAmplitudeMcp).toHaveBeenCalledTimes(1);
    expect(ui.spinner).toHaveBeenCalled();
  });

  it('falls through to agent fallback when dashboardUrl is missing', async () => {
    fs.writeFileSync(
      path.join(installDir, '.amplitude-dashboard.json'),
      JSON.stringify({ charts: [] }),
    );
    mockedCallAmplitudeMcp.mockResolvedValue(null);
    const session = makeSession();

    await createDashboardStep({
      session: session as any,
      accessToken: 'token',

      integration: 'nextjs-pages-router' as any,
    });

    expect(mockedCallAmplitudeMcp).toHaveBeenCalledTimes(1);
  });
});
