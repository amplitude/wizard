/**
 * Per-prompt invocation helper for the Haiku-vs-Sonnet harness.
 *
 * Extracted into its own module so the unit test can mock the
 * `streamText` factory and assert that the runner selects the right
 * model alias for each role (`haiku` / `sonnet`) without spinning up
 * the AI SDK for real.
 *
 * The factory pattern matches the production call sites
 * (`ai-sdk-gateway-probe.ts`, `console-query.ts`): both grab
 * `streamText` from `ai` and `createWizardAiSdkAnthropic` from
 * `src/lib/agent/wizard-ai-sdk-anthropic.ts`. The harness reuses
 * `createAnthropic` from `@ai-sdk/anthropic` directly (instead of the
 * wizard's wrapper) so the eval is self-contained — pulling the
 * wrapper would drag in the wizard's gateway-sanitize fetch and
 * coupling with the wizard runtime that we don't need for measurement.
 */
import { performance } from 'node:perf_hooks';

import { resolveModelAlias, gatewayModelString } from './scorers.mjs';

/**
 * @typedef {object} StreamTextDeps
 * @property {(opts: any) => any} streamText  - the `ai` package export
 * @property {(opts: any) => any} createAnthropic - `@ai-sdk/anthropic` export
 */

/**
 * Run a single prompt against a single model role.
 *
 * @param {object} args
 * @param {'haiku'|'sonnet'} args.modelRole
 * @param {string} args.userMessage
 * @param {string|null} [args.system]
 * @param {number} [args.maxOutputTokens]
 * @param {{ baseURL?: string, authToken?: string, apiKey?: string }} args.auth
 * @param {StreamTextDeps} args.deps
 * @returns {Promise<{
 *   modelRole: 'haiku'|'sonnet',
 *   modelAlias: string,
 *   gatewayModel: string,
 *   text: string,
 *   ttftMs: number | null,
 *   totalMs: number,
 *   inputTokens: number | null,
 *   outputTokens: number | null,
 *   error: string | null,
 * }>}
 */
export async function runPrompt(args) {
  const { modelRole, userMessage, system, maxOutputTokens, auth, deps } = args;
  const alias = resolveModelAlias(modelRole);
  const useDirectApiKey = Boolean(auth.apiKey) && !auth.baseURL;
  const gatewayModel = gatewayModelString(alias, useDirectApiKey);

  const provider = deps.createAnthropic({
    ...(auth.baseURL ? { baseURL: auth.baseURL } : {}),
    ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
    ...(auth.authToken ? { authToken: auth.authToken } : {}),
  });

  const messages = [{ role: 'user', content: userMessage }];
  const requestArgs = {
    model: provider(gatewayModel),
    messages,
    ...(system ? { system } : {}),
    ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
  };

  const start = performance.now();
  let ttftMs = null;
  let text = '';
  let inputTokens = null;
  let outputTokens = null;
  let error = null;

  try {
    const result = deps.streamText(requestArgs);
    for await (const part of result.textStream) {
      if (ttftMs === null) {
        ttftMs = performance.now() - start;
      }
      text += part;
    }
    // Usage is exposed via a promise on the streamText result. Pull
    // it lazily so we don't crash the harness on an SDK shape that
    // doesn't expose it.
    if (result.usage && typeof result.usage.then === 'function') {
      try {
        const usage = await result.usage;
        if (usage) {
          if (typeof usage.inputTokens === 'number')
            inputTokens = usage.inputTokens;
          else if (typeof usage.promptTokens === 'number')
            inputTokens = usage.promptTokens;
          if (typeof usage.outputTokens === 'number')
            outputTokens = usage.outputTokens;
          else if (typeof usage.completionTokens === 'number')
            outputTokens = usage.completionTokens;
        }
      } catch (usageErr) {
        // Non-fatal — record the issue but keep the row.
        error = `usage read failed: ${stringifyError(usageErr)}`;
      }
    }
  } catch (err) {
    error = stringifyError(err);
  }

  const totalMs = performance.now() - start;

  return {
    modelRole,
    modelAlias: alias,
    gatewayModel,
    text,
    ttftMs,
    totalMs,
    inputTokens,
    outputTokens,
    error,
  };
}

function stringifyError(err) {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Resolve auth from env. The harness uses the same env-var contract
 * as the wizard CI path (`WIZARD_OAUTH_TOKEN` -> gateway), with a
 * direct API key fallback (`ANTHROPIC_API_KEY`).
 *
 * Returns `null` if neither path is configured.
 */
export function resolveHarnessAuth() {
  const oauthToken = process.env.WIZARD_OAUTH_TOKEN?.trim();
  if (oauthToken) {
    const baseURL =
      process.env.ANTHROPIC_BASE_URL?.trim() ||
      process.env.WIZARD_LLM_PROXY_URL?.trim() ||
      'https://core.amplitude.com/wizard';
    return { kind: 'oauth', baseURL, authToken: oauthToken };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    const baseURL = process.env.ANTHROPIC_BASE_URL?.trim();
    return baseURL
      ? { kind: 'api-key', baseURL, apiKey }
      : { kind: 'api-key', apiKey };
  }
  return null;
}
