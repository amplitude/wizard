/**
 * Sanitize outbound HTTP requests to Amplitude's wizard LLM gateway
 * (Anthropic-on-Vertex compatibility).
 *
 * Ported from `wizard-rewrite` (`wizard-anthropic-provider.ts`), kept pure so
 * it can back both the Anthropic Agent SDK path (when a custom transport is
 * available) and a future Vercel AI SDK `createAnthropic({ fetch })` client.
 */

const STRIPPED_SCHEMA_KEYS: ReadonlySet<string> = new Set([
  '$schema',
  'additionalProperties',
  'exclusiveMinimum',
  'exclusiveMaximum',
]);

/** Keys stripped before requests hit Vertex-backed gateway routes (tests / guards). */
export const GATEWAY_STRIPPED_SCHEMA_KEYS: ReadonlySet<string> =
  STRIPPED_SCHEMA_KEYS;

/**
 * True if any object in `value` contains a key the gateway rejects on tool
 * schemas. Use in tests (and optionally diagnostics) to assert sanitization
 * coverage — O(n) over the JSON tree.
 */
export function treeContainsForbiddenSchemaKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(treeContainsForbiddenSchemaKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (STRIPPED_SCHEMA_KEYS.has(k)) return true;
      if (treeContainsForbiddenSchemaKeys(v)) return true;
    }
  }
  return false;
}

/**
 * Recursively strip JSON-schema metadata fields the wizard gateway rejects.
 */
export function stripSchemaNoise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchemaNoise);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (STRIPPED_SCHEMA_KEYS.has(k)) continue;
      out[k] = stripSchemaNoise(v);
    }
    return out;
  }
  return value;
}

type FetchInit = Parameters<typeof fetch>[1];

/**
 * Produces a sanitized copy of a `RequestInit`:
 * (a) drops the `anthropic-beta` header when present — Vertex-backed routes
 *     reject unknown beta tokens with a generic 400 wrapper; and
 * (b) strips schema-noise keys from `tools[i].input_schema` in the JSON body.
 */
export function sanitizeWizardRequestInit(init: FetchInit): FetchInit {
  let nextInit = init;
  if (init) {
    const headers = new Headers(init.headers);
    if (headers.has('anthropic-beta')) headers.delete('anthropic-beta');
    nextInit = { ...init, headers };
  }
  if (nextInit?.body && typeof nextInit.body === 'string') {
    try {
      const parsed = JSON.parse(nextInit.body) as Record<string, unknown>;
      if (Array.isArray(parsed['tools'])) {
        parsed['tools'] = (
          parsed['tools'] as Array<Record<string, unknown>>
        ).map((t) => ({
          ...t,
          input_schema: stripSchemaNoise(t['input_schema']),
        }));
        nextInit = { ...nextInit, body: JSON.stringify(parsed) };
      }
    } catch {
      /* not JSON; let it through */
    }
  }
  return nextInit;
}

/** `fetch` wrapper that applies {@link sanitizeWizardRequestInit} to every call. */
export const sanitizingFetch: typeof fetch = (input, init) => {
  return fetch(input, sanitizeWizardRequestInit(init));
};
