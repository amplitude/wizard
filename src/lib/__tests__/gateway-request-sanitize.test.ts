import { describe, it, expect } from 'vitest';
import {
  sanitizeWizardRequestInit,
  stripSchemaNoise,
} from '../gateway-request-sanitize.js';

describe('stripSchemaNoise', () => {
  it('removes gateway-rejected keys recursively', () => {
    const input = {
      type: 'object',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      additionalProperties: false,
      exclusiveMinimum: 0,
      exclusiveMaximum: 10,
      properties: {
        n: {
          type: 'number',
          exclusiveMinimum: 0,
        },
      },
    };
    const out = stripSchemaNoise(input) as Record<string, unknown>;
    expect(out['$schema']).toBeUndefined();
    expect(out['additionalProperties']).toBeUndefined();
    expect(out['exclusiveMinimum']).toBeUndefined();
    expect(out['exclusiveMaximum']).toBeUndefined();
    expect(out['type']).toBe('object');
    const props = out['properties'] as Record<string, unknown>;
    const n = props['n'] as Record<string, unknown>;
    expect(n['type']).toBe('number');
    expect(n['exclusiveMinimum']).toBeUndefined();
  });
});

describe('sanitizeWizardRequestInit', () => {
  it('strips anthropic-beta header', () => {
    const init: Parameters<typeof fetch>[1] = {
      method: 'POST',
      headers: { 'anthropic-beta': 'context-1m-2025-08-07' },
      body: '{}',
    };
    const out = sanitizeWizardRequestInit(init)!;
    const h = new Headers(out.headers);
    expect(h.has('anthropic-beta')).toBe(false);
  });

  it('sanitizes tools[].input_schema in JSON body', () => {
    const body = JSON.stringify({
      model: 'anthropic/claude-sonnet-4-6',
      tools: [
        {
          name: 'x',
          input_schema: {
            type: 'object',
            $schema: 'x',
            additionalProperties: false,
            exclusiveMinimum: 1,
            properties: { a: { type: 'string' } },
          },
        },
      ],
    });
    const out = sanitizeWizardRequestInit({
      method: 'POST',
      headers: new Headers(),
      body,
    })!;
    const parsed = JSON.parse(out.body as string) as {
      tools: Array<{ input_schema: Record<string, unknown> }>;
    };
    expect(parsed.tools[0].input_schema['$schema']).toBeUndefined();
    expect(
      parsed.tools[0].input_schema['additionalProperties'],
    ).toBeUndefined();
    expect(parsed.tools[0].input_schema['exclusiveMinimum']).toBeUndefined();
    expect(parsed.tools[0].input_schema['properties']).toBeDefined();
  });

  it('leaves non-JSON body unchanged', () => {
    const init = { body: 'not-json', headers: {} };
    const out = sanitizeWizardRequestInit(init)!;
    expect(out.body).toBe('not-json');
  });
});
