/**
 * Preload for the Claude Code subprocess (`NODE_OPTIONS=--require …`).
 *
 * Patches `globalThis.fetch` so POSTs to `…/v1/messages` run through
 * {@link sanitizeWizardRequestInit} (strip `anthropic-beta`, scrub tool
 * `input_schema` keys Vertex rejects).
 *
 * Opt out: `AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH=0` in the child environment.
 */

import { sanitizeWizardRequestInit } from './gateway-request-sanitize.js';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export function requestUrlIncludesMessagesApi(input: FetchInput): boolean {
  try {
    if (typeof input === 'string') return input.includes('/v1/messages');
    if (input instanceof URL) return input.pathname.includes('/v1/messages');
    if (typeof input === 'object' && input !== null && 'url' in input) {
      const u = (input as { url: unknown }).url;
      if (typeof u === 'string') return u.includes('/v1/messages');
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function installGatewayFetchSanitizer(): void {
  const prior: typeof fetch = globalThis.fetch.bind(globalThis) as typeof fetch;
  globalThis.fetch = (
    input: FetchInput,
    init?: FetchInit,
  ): ReturnType<typeof fetch> => {
    if (
      process.env.AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH === '0' ||
      !requestUrlIncludesMessagesApi(input)
    ) {
      return prior(input, init);
    }
    return prior(input, sanitizeWizardRequestInit(init));
  };
}
