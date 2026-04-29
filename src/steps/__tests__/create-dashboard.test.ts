/**
 * Regression tests for the create-dashboard step.
 *
 * 1. The events-file reader delegates to parseEventPlanContent (the canonical
 *    parser) so it tolerates every field-name variant the agent emits in the
 *    wild — `name`, `event`, `eventName`, `event_name`.
 * 2. The fallback JSON extractor handles nested braces (the dashboard result
 *    embeds a `charts` array of objects).
 */

import { describe, it, expect } from 'vitest';
import { __test__ } from '../create-dashboard';

const { readEventsFromContent, parseAgentOutput, extractJsonContaining } =
  __test__;

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
