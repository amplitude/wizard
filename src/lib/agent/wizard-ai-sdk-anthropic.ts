/**
 * Single factory for Vercel AI SDK `@ai-sdk/anthropic` + {@link sanitizingFetch}
 * on the same Anthropic-compatible surface as the Claude Agent SDK / gateway.
 *
 * Used by the gateway probe, ConsoleView AI SDK path, and future `runAgent`
 * transport wiring so auth, `baseURL`, and fetch stay aligned.
 */
import { createAnthropic } from '@ai-sdk/anthropic';

import { sanitizingFetch } from '../gateway-request-sanitize.js';
import { resolveAnthropicAuth } from './anthropic-auth.js';

export type CreateWizardAiSdkAnthropicOptions = {
  /**
   * Parsed `ANTHROPIC_CUSTOM_HEADERS` lines (e.g. session id + feature flags).
   * Omit on paths that rely on env only (e.g. gateway probe).
   */
  headers?: Record<string, string>;
  /** Defaults to {@code ANTHROPIC_BASE_URL} when set. */
  baseURL?: string;
};

export function createWizardAiSdkAnthropic(
  opts: CreateWizardAiSdkAnthropicOptions = {},
) {
  const baseURL = opts.baseURL ?? process.env.ANTHROPIC_BASE_URL?.trim();
  const auth = resolveAnthropicAuth();
  const headers =
    opts.headers && Object.keys(opts.headers).length > 0
      ? opts.headers
      : undefined;

  return createAnthropic({
    ...(baseURL ? { baseURL } : {}),
    ...auth,
    ...(headers ? { headers } : {}),
    fetch: sanitizingFetch,
  });
}
