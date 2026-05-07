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

/**
 * Append `/v1` to a gateway / proxy URL when it isn't already there so
 * `@ai-sdk/anthropic` resolves `${baseURL}/messages` to `…/v1/messages`.
 *
 * The Vercel AI SDK's `@ai-sdk/anthropic` provider posts to
 * `${baseURL}/messages`, while the Claude Agent SDK appends `/v1/messages`.
 * The wizard sets `ANTHROPIC_BASE_URL=https://core.amplitude.com/wizard`
 * (no `/v1`) for the Agent SDK path; passing the same bare URL to
 * `createAnthropic` produces 404s on `…/wizard/messages`.
 *
 * Idempotent — if the URL already ends in `/v1` (or any `/vN`), leave it
 * alone. Trims trailing slashes so we don't end up with `…//v1`.
 *
 * Keep in sync with `evals/model-quality/lib/run-prompt.mjs` (intentionally
 * inlined there because the eval harness is `.mjs` and can't import from
 * compiled `.ts`).
 */
export function ensureV1Suffix(rawBase: string): string;
export function ensureV1Suffix(rawBase: undefined): undefined;
export function ensureV1Suffix(rawBase: string | undefined): string | undefined;
export function ensureV1Suffix(
  rawBase: string | undefined,
): string | undefined {
  if (!rawBase || typeof rawBase !== 'string') return rawBase;
  const trimmed = rawBase.replace(/\/+$/, '');
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

export function createWizardAiSdkAnthropic(
  opts: CreateWizardAiSdkAnthropicOptions = {},
) {
  const rawBaseURL = opts.baseURL ?? process.env.ANTHROPIC_BASE_URL?.trim();
  const baseURL = ensureV1Suffix(rawBaseURL);
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
