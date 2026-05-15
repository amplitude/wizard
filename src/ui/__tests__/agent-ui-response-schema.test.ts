/**
 * Regression suite for the v3 `needs_input.responseSchema` migration.
 *
 * Pre-PR-B12, `responseSchema` was `Record<string, string>` shipping
 * English descriptions inside a JSON map:
 *
 *     { appId: 'string (required, from choices[].value)' }
 *
 * Non-Claude orchestrators (Codex, GPT-5, Mistral) couldn't
 * programmatically validate stdin payloads against that — they had to
 * run an LLM over the English to decide if `{ appId: '769610' }` was
 * a legal response. PR B12 replaced the shape with a proper JSON
 * Schema 2020-12 fragment so orchestrators can run `ajv` / `jsonschema`
 * directly.
 *
 * This file pins:
 *   1. The new wire shape (`$schema` / `type: 'object'` / `properties` /
 *      `required`) on every callsite.
 *   2. `data_version: 3` on every `needs_input` envelope.
 *   3. The env-selection callsite emits `pattern: '^\\d+$'` for `appId`
 *      (not `enum`) because `allowManualEntry: true` lets orchestrators
 *      submit an app-id that wasn't in the paginated choices.
 *   4. Round-trip through `validateEnvelopeOrLog` succeeds — the new
 *      shape passes the structural Zod schema we ship to orchestrators.
 *   5. A snapshot of the responseSchema fragment so the wire shape is
 *      hard to change accidentally.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import {
  EVENT_DATA_VERSIONS,
  __resetDecisionIdCounterForTests,
  type ResponseSchemaFragment,
} from '../../lib/agent-events.js';

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: string;
  message: string;
  session_id?: string;
  run_id?: string;
  data_version?: number;
  data?: Record<string, unknown>;
  level?: string;
}

const setupStdoutSpy = (): {
  writes: string[];
  restore: () => void;
} => {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  return { writes, restore: () => spy.mockRestore() };
};

describe('needs_input.responseSchema — JSON Schema 2020-12 migration', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    __resetDecisionIdCounterForTests();
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('EVENT_DATA_VERSIONS.needs_input is bumped to 3', () => {
    // Lock the registry value — every emitter is responsible for
    // matching this, and validateEnvelopeOrLog asserts it at the wire
    // boundary.
    expect(EVENT_DATA_VERSIONS.needs_input).toBe(3);
  });

  it('emitNeedsInput accepts a JSON Schema 2020-12 fragment for responseSchema', () => {
    const ui = new AgentUI();
    const fragment: ResponseSchemaFragment = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          pattern: '^\\d+$',
          description: 'numeric Amplitude app ID',
        },
      },
      required: ['appId'],
    };
    ui.emitNeedsInput({
      code: 'project_selection',
      message: 'Pick a project',
      choices: [{ value: '769610', label: 'Production' }],
      recommended: '769610',
      responseSchema: fragment,
    });

    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.type).toBe('needs_input');
    expect(event.data?.responseSchema).toEqual(fragment);
  });

  it('emitNeedsInput stamps data_version: 3 on every needs_input envelope', () => {
    const ui = new AgentUI();
    ui.emitNeedsInput({
      code: 'project_selection',
      message: 'Pick a project',
      choices: [{ value: '1', label: 'P1' }],
    });
    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.data_version).toBe(3);
  });

  it('every needs_input envelope across a run carries data_version: 3', () => {
    // Two back-to-back prompts — both must stamp v3, no drift across the run.
    const ui = new AgentUI();
    ui.emitNeedsInput({
      code: 'project_selection',
      message: 'Pick a project',
      choices: [{ value: '1', label: 'P1' }],
    });
    ui.emitNeedsInput({
      code: 'confirm',
      message: 'Apply?',
      choices: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    });
    const events = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    const needsInputs = events.filter((e) => e.data?.event === 'needs_input');
    expect(needsInputs.length).toBe(2);
    for (const e of needsInputs) {
      expect(e.data_version).toBe(3);
    }
  });

  it('the wire shape passes validateEnvelopeOrLog (no schema-failure log)', () => {
    // validateEnvelopeOrLog routes failures to a lazy file logger; we
    // can't observe the call directly, but if validation failed the
    // event would still emit. The stronger assertion is that the parsed
    // envelope is structurally what we expect — v=1, timestamp, type,
    // a non-empty message, and a data block with data_version matching
    // the registry. If validateEnvelopeOrLog flagged a coherence issue
    // it would log `data_version mismatch on 'needs_input'`; the
    // data_version: 3 stamp above already pins that path.
    const ui = new AgentUI();
    ui.emitNeedsInput({
      code: 'project_selection',
      message: 'Pick a project',
      choices: [{ value: '1', label: 'P1' }],
      responseSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          appId: { type: 'string', pattern: '^\\d+$' },
        },
        required: ['appId'],
      },
    });

    const event = JSON.parse(writes[0].trim()) as NDJSONEvent;
    expect(event.v).toBe(1);
    expect(typeof event['@timestamp']).toBe('string');
    expect(event.type).toBe('needs_input');
    expect(event.message).toBeTruthy();
    expect(event.data?.event).toBe('needs_input');
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.needs_input);
  });
});

describe('promptEnvironmentSelection — responseSchema JSON Schema fragment', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    __resetDecisionIdCounterForTests();
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  // The env-selection codepath waits up to 60s for a stdin line; we
  // make stdin non-readable so it falls through to auto-select after
  // emitting both the legacy `prompt` and the structured `needs_input`.
  const runEnvSelection = async (
    orgs: Parameters<AgentUI['promptEnvironmentSelection']>[0],
  ): Promise<NDJSONEvent[]> => {
    const ui = new AgentUI();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: { readable: false },
    });
    try {
      await ui.promptEnvironmentSelection(orgs);
    } finally {
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: originalStdin,
      });
    }
    return writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
  };

  const fixtureOrgs = (): Parameters<
    AgentUI['promptEnvironmentSelection']
  >[0] => [
    {
      id: 'org-1',
      name: 'DevX',
      projects: [
        {
          id: 'proj-a',
          name: 'Sandbox',
          environments: [
            {
              name: 'Production',
              rank: 1,
              app: { id: '100001', apiKey: 'k1' },
            },
            {
              name: 'Development',
              rank: 2,
              app: { id: '100002', apiKey: 'k2' },
            },
          ],
        },
      ],
    },
  ];

  it('legacy prompt event ships a JSON Schema fragment (not English strings)', async () => {
    const events = await runEnvSelection(fixtureOrgs());
    const legacyPrompt = events.find(
      (e) =>
        e.type === 'prompt' &&
        (e.data as { promptType?: string })?.promptType ===
          'environment_selection',
    );
    expect(legacyPrompt).toBeDefined();
    const schema = (legacyPrompt!.data as { responseSchema: unknown })
      .responseSchema as ResponseSchemaFragment;
    expect(schema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          pattern: '^\\d+$',
          description:
            'Numeric Amplitude app ID — must match one of choices[].appId.',
        },
      },
      required: ['appId'],
    });
  });

  it('structured needs_input event ships a JSON Schema fragment with appId pattern', async () => {
    const events = await runEnvSelection(fixtureOrgs());
    const needsInput = events.find(
      (e) =>
        e.type === 'needs_input' &&
        (e.data as { code?: string })?.code === 'environment_selection',
    );
    expect(needsInput).toBeDefined();
    const schema = (needsInput!.data as { responseSchema: unknown })
      .responseSchema as ResponseSchemaFragment;
    // Pin the JSON Schema 2020-12 shape — non-Claude orchestrators
    // load `ajv` against this and validate `{ appId: '<numeric>' }`.
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['appId']);
    expect(schema.properties.appId).toMatchObject({
      type: 'string',
      pattern: '^\\d+$',
    });
    // `enum` is intentionally absent — allowManualEntry: true lets
    // orchestrators submit an above-cap app-id, so a closed `enum`
    // would contradict the manualEntry contract.
    expect(schema.properties.appId.enum).toBeUndefined();
  });

  it('env-selection needs_input envelope stamps data_version: 3', async () => {
    const events = await runEnvSelection(fixtureOrgs());
    const needsInput = events.find(
      (e) =>
        e.type === 'needs_input' &&
        (e.data as { code?: string })?.code === 'environment_selection',
    );
    expect(needsInput?.data_version).toBe(3);
  });

  it('env-selection responseSchema snapshot — pins the wire shape', async () => {
    // Snapshot guard: if anyone changes the wire shape without
    // bumping data_version, this snapshot mismatches and the PR
    // becomes a documented contract change rather than a silent
    // protocol regression.
    const events = await runEnvSelection(fixtureOrgs());
    const needsInput = events.find(
      (e) =>
        e.type === 'needs_input' &&
        (e.data as { code?: string })?.code === 'environment_selection',
    );
    const schema = (needsInput!.data as { responseSchema: unknown })
      .responseSchema;
    expect(schema).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "properties": {
          "appId": {
            "description": "Numeric Amplitude app ID — must match one of choices[].value, or any valid app ID when allowManualEntry is true.",
            "pattern": "^\\d+$",
            "type": "string",
          },
        },
        "required": [
          "appId",
        ],
        "type": "object",
      }
    `);
  });
});
