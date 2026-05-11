/**
 * Tests for the wired-event classifier — the helper the outro uses to
 * split the plan into "instrumented via track()" vs "covered by
 * autocapture" by reading the file-change ledger's `afterContent`.
 *
 * Why these specific cases:
 *   - The bug that motivated the helper was a Title-Case plan disagreeing
 *     with lowercase wired code. The casing-disagreement test pins that.
 *   - Autocapture coverage is a real product behavior (web SDKs), so we
 *     pin the "no track() call → autocaptured" split.
 *   - Multiple SDK shapes (`amplitude.track`, bare `track`, single
 *     quotes) need to work — the regex is intentionally permissive.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyPlanAgainstWiredCode,
  collectWiredEventNames,
  extractTrackCallNames,
} from '../wired-event-instrumentation.js';

describe('extractTrackCallNames', () => {
  it('extracts the inner string from a basic track() call', () => {
    expect(extractTrackCallNames('amplitude.track("User Signed Up")')).toEqual([
      'User Signed Up',
    ]);
  });

  it('handles single quotes', () => {
    expect(extractTrackCallNames("amplitude.track('app loaded')")).toEqual([
      'app loaded',
    ]);
  });

  it('handles bare track() without a method prefix', () => {
    expect(
      extractTrackCallNames('track("collaboration session joined", props)'),
    ).toEqual(['collaboration session joined']);
  });

  it('deduplicates repeated calls to the same event', () => {
    const src = `
      amplitude.track("Login Clicked");
      // later in the same file:
      amplitude.track("Login Clicked", { source: "header" });
    `;
    expect(extractTrackCallNames(src)).toEqual(['Login Clicked']);
  });

  it('extracts multiple events from one file in source order', () => {
    const src = `
      function onMount() { amplitude.track("App Loaded"); }
      function onSignIn() { amplitude.track("User Signed In"); }
      function onPurchase() { amplitude.track("Purchase Completed"); }
    `;
    expect(extractTrackCallNames(src)).toEqual([
      'App Loaded',
      'User Signed In',
      'Purchase Completed',
    ]);
  });

  it('unwraps backslash escapes in the literal', () => {
    // Pathological but possible: a JS source with escaped quotes
    // inside the literal (e.g. the agent quoted a name that itself
    // contained an apostrophe).
    expect(extractTrackCallNames('track("It\\\'s Live")')).toEqual([
      // After regex extraction the captured text is `It\'s Live`; the
      // unescape strips the backslash before the apostrophe.
      "It's Live",
    ]);
  });

  it('ignores template literals (documented limitation)', () => {
    // The agent is instructed to use literal strings; if it ever
    // produces a template literal we under-count rather than mis-extract.
    expect(extractTrackCallNames('amplitude.track(`User ${verb}ed`)')).toEqual(
      [],
    );
  });
});

describe('collectWiredEventNames', () => {
  it('returns a map keyed by lowercase-collapsed name → first-seen casing', () => {
    const entries = [
      { afterContent: 'amplitude.track("app loaded")' },
      { afterContent: 'amplitude.track("Collaboration Session Joined")' },
    ];
    const wired = collectWiredEventNames(entries);
    expect(wired.get('app loaded')).toBe('app loaded');
    expect(wired.get('collaboration session joined')).toBe(
      'Collaboration Session Joined',
    );
    expect(wired.size).toBe(2);
  });

  it('skips entries with null afterContent', () => {
    const wired = collectWiredEventNames([
      { afterContent: null },
      { afterContent: 'amplitude.track("App Loaded")' },
    ]);
    expect(wired.size).toBe(1);
    expect(wired.get('app loaded')).toBe('App Loaded');
  });

  it('returns an empty map when no track() calls are found anywhere', () => {
    const wired = collectWiredEventNames([
      { afterContent: 'console.log("hello world")' },
      { afterContent: 'export default { name: "track" }' },
    ]);
    expect(wired.size).toBe(0);
  });
});

describe('classifyPlanAgainstWiredCode', () => {
  it('marks plan events whose name appears in any wired file as instrumented', () => {
    const plan = [
      { name: 'App Loaded', description: 'fires on first paint' },
      { name: 'User Signed Up', description: 'after the signup form' },
    ];
    const wired = new Map<string, string>([
      ['app loaded', 'app loaded'],
      ['user signed up', 'user signed up'],
    ]);
    const result = classifyPlanAgainstWiredCode(plan, wired);
    expect(result.instrumented).toHaveLength(2);
    expect(result.autocaptured).toHaveLength(0);
  });

  it('renders the wired-code casing for instrumented events, not the plan casing', () => {
    // This is the regression case from the live test session: the plan
    // had `App Loaded` (Title Case via normalizeEventName), the wired
    // code had `app loaded` (lowercase, agent honored user feedback).
    // The outro must show what's in the code, not what's in the plan.
    const plan = [
      { name: 'App Loaded', description: 'fires on first paint' },
      {
        name: 'Collaboration Session Joined',
        description: 'user opens a board',
      },
    ];
    const wired = new Map<string, string>([
      ['app loaded', 'app loaded'],
      ['collaboration session joined', 'collaboration session joined'],
    ]);
    const result = classifyPlanAgainstWiredCode(plan, wired);
    expect(result.instrumented.map((e) => e.name)).toEqual([
      'app loaded',
      'collaboration session joined',
    ]);
  });

  it('marks plan events with no matching wired track() call as autocaptured', () => {
    // Mixed: one event was wired up, three rely on autocapture.
    const plan = [
      { name: 'Purchase Completed', description: 'checkout success' },
      { name: 'Page Viewed', description: 'autocaptured on every nav' },
      { name: 'Element Clicked', description: 'autocaptured clicks' },
      { name: 'Session Start', description: 'autocaptured by SDK' },
    ];
    const wired = new Map<string, string>([
      ['purchase completed', 'Purchase Completed'],
    ]);
    const result = classifyPlanAgainstWiredCode(plan, wired);
    expect(result.instrumented.map((e) => e.name)).toEqual([
      'Purchase Completed',
    ]);
    expect(result.autocaptured.map((e) => e.name)).toEqual([
      'Page Viewed',
      'Element Clicked',
      'Session Start',
    ]);
  });

  it('puts everything in autocaptured when wired names are empty', () => {
    // No track() calls anywhere — the agent decided autocapture covered
    // the whole plan.
    const plan = [
      { name: 'Page Viewed', description: 'autocaptured' },
      { name: 'Element Clicked', description: 'autocaptured' },
    ];
    const result = classifyPlanAgainstWiredCode(plan, new Map());
    expect(result.instrumented).toHaveLength(0);
    expect(result.autocaptured).toHaveLength(2);
  });

  it('returns empty for an empty plan', () => {
    expect(classifyPlanAgainstWiredCode([], new Map([['x', 'x']]))).toEqual({
      instrumented: [],
      autocaptured: [],
    });
  });

  it('skips plan entries with empty names defensively', () => {
    const plan = [
      { name: '', description: 'malformed' },
      { name: '  ', description: 'whitespace' },
      { name: 'App Loaded', description: 'real one' },
    ];
    const result = classifyPlanAgainstWiredCode(
      plan,
      new Map([['app loaded', 'app loaded']]),
    );
    expect(result.instrumented).toHaveLength(1);
    expect(result.autocaptured).toHaveLength(0);
  });

  it('matches case-insensitively while preserving wired casing', () => {
    const plan = [{ name: 'USER LOGGED IN', description: '' }];
    const wired = new Map([['user logged in', 'User Logged In']]);
    const result = classifyPlanAgainstWiredCode(plan, wired);
    expect(result.instrumented[0].name).toBe('User Logged In');
  });
});
