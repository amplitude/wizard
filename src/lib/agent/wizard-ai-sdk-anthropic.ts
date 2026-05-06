/**
 * Single factory for Vercel AI SDK `@ai-sdk/anthropic` + {@link sanitizingFetch}
 * on the same Anthropic-compatible surface as the Claude Agent SDK / gateway.
 *
 * Used by the gateway probe, ConsoleView AI SDK path, and future `runAgent`
 * transport wiring so auth, `baseURL`, and fetch stay aligned.
 */
import { createAnthropic } from '@ai-sdk/anthropic';

import { sanitizingFetch } from '../gateway-request-sanitize.js';

export function resolveWizardAnthropicAuthFromEnv(): {
  apiKey?: string;
  authToken?: string;
} {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) return { apiKey };
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (authToken) return { authToken };
  return {};
}

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
  const baseURL =
    opts.baseURL ?? process.env.ANTHROPIC_BASE_URL?.trim();
  const auth = resolveWizardAnthropicAuthFromEnv();
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
