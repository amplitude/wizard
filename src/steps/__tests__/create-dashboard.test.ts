/**
 * Regression tests for the two issues Cursor Bugbot surfaced:
 *   1. Schema must tolerate `event_type`/`event`/`eventName` (agents drift
 *      from the canonical key name).
 *   2. The fallback JSON extractor must handle nested braces (the dashboard
 *      result embeds a `charts` array of objects).
 */

import { describe, it, expect } from 'vitest';
import { __test__ } from '../create-dashboard';

const { EventsFileSchema, parseAgentOutput, extractJsonContaining } = __test__;

describe('EventsFileSchema', () => {
  it('accepts canonical `name` key', () => {
    const result = EventsFileSchema.parse({
      events: [
        { name: 'Signup Completed', description: 'User finished signup' },
      ],
    });
    expect(result.events[0].name).toBe('Signup Completed');
  });

  it('accepts legacy `event` key and normalizes to `name`', () => {
    const result = EventsFileSchema.parse({
      events: [{ event: 'Project Created' }],
    });
    expect(result.events[0].name).toBe('Project Created');
  });

  it('accepts `event_type` key (from the old commandment wording)', () => {
    const result = EventsFileSchema.parse({
      events: [{ event_type: 'Invite Sent' }],
    });
    expect(result.events[0].name).toBe('Invite Sent');
  });

  it('accepts `eventName` key', () => {
    const result = EventsFileSchema.parse({
      events: [{ eventName: 'Checkout Started' }],
    });
    expect(result.events[0].name).toBe('Checkout Started');
  });

  it('prefers `name` when multiple keys are present', () => {
    const result = EventsFileSchema.parse({
      events: [{ name: 'Canonical', event: 'Legacy' }],
    });
    expect(result.events[0].name).toBe('Canonical');
  });

  it('rejects entries with no recognizable name key', () => {
    expect(() =>
      EventsFileSchema.parse({ events: [{ description: 'x' }] }),
    ).toThrow();
  });

  it('rejects empty events array', () => {
    expect(() => EventsFileSchema.parse({ events: [] })).toThrow();
  });

  it('accepts `eventDescriptionAndReasoning` as description alias', () => {
    const result = EventsFileSchema.parse({
      events: [
        {
          name: 'Foo',
          eventDescriptionAndReasoning: 'Fires when users foo',
        },
      ],
    });
    expect(result.events[0].description).toBe('Fires when users foo');
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
