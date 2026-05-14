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
 *   usageError: string | null,
 * }>}
 */
export async function runPrompt(args) {
  const { modelRole, userMessage, system, maxOutputTokens, auth, deps } = args;
  const alias = resolveModelAlias(modelRole);
  const useDirectApiKey = Boolean(auth.apiKey) && !auth.baseURL;
  const gatewayModel = gatewayModelString(alias, useDirectApiKey);

  const messages = [{ role: 'user', content: userMessage }];

  const start = performance.now();
  let ttftMs = null;
  let text = '';
  let inputTokens = null;
  let outputTokens = null;
  let error = null;
  let usageError = null;

  try {
    // `createAnthropic` and `provider(modelString)` MUST be inside the
    // try/catch so a provider-init failure (invalid baseURL, missing
    // env, transient SDK throw) is captured into `error` instead of
    // bubbling out as an unhandled rejection — the documented contract
    // of `runPrompt` is to capture errors, never throw, so the harness
    // can write the in-memory `lines` array before exiting.
    const provider = deps.createAnthropic({
      ...(auth.baseURL ? { baseURL: auth.baseURL } : {}),
      ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
      ...(auth.authToken ? { authToken: auth.authToken } : {}),
    });
    const requestArgs = {
      model: provider(gatewayModel),
      messages,
      ...(system ? { system } : {}),
      ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
    };
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
        // Non-fatal: the text stream completed, but the usage side
        // channel rejected (provider quirk, transient token-counting
        // failure, etc.). The row's `text` is still valid model output
        // and MUST be scored — we lose only the input/output token
        // counts. Record the issue on a separate `usageError` field so
        // downstream scoring (`score-quality.mjs`) can keep the row
        // instead of skipping it the way it must skip rows where the
        // stream itself failed (`error` set, `text === ''`).
        usageError = `usage read failed: ${stringifyError(usageErr)}`;
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
    usageError,
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
 *
 * Gateway baseURL contract: the Amplitude wizard gateway listens on
 * `/wizard/v1/messages` (mirrors Anthropic's `/v1/messages` route).
 * The Claude Agent SDK appends `/v1/messages` to its `ANTHROPIC_BASE_URL`,
 * so the wizard sets that env to `https://core.amplitude.com/wizard`
 * (no `/v1`). The Vercel AI SDK's `@ai-sdk/anthropic` provider is
 * different — it appends only `/messages` to the configured `baseURL`
 * (see `node_modules/@ai-sdk/anthropic/dist/index.mjs` —
 * `${this.config.baseURL}/messages`). So passing the bare gateway URL
 * to `createAnthropic` produces `…/wizard/messages`, which the gateway
 * answers with a 404 nginx page.
 *
 * Fix: append `/v1` here when we're on the gateway path so the AI SDK's
 * `${baseURL}/messages` resolves to `…/wizard/v1/messages`. Idempotent —
 * if the operator already supplied a URL ending in `/v1` via
 * `ANTHROPIC_BASE_URL` or `WIZARD_LLM_PROXY_URL`, leave it alone.
 */
export function resolveHarnessAuth() {
  const oauthToken = process.env.WIZARD_OAUTH_TOKEN?.trim();
  if (oauthToken) {
    const rawBase =
      process.env.ANTHROPIC_BASE_URL?.trim() ||
      process.env.WIZARD_LLM_PROXY_URL?.trim() ||
      'https://core.amplitude.com/wizard';
    return {
      kind: 'oauth',
      baseURL: ensureV1Suffix(rawBase),
      authToken: oauthToken,
    };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    const baseURL = process.env.ANTHROPIC_BASE_URL?.trim();
    return baseURL
      ? { kind: 'api-key', baseURL: ensureV1Suffix(baseURL), apiKey }
      : { kind: 'api-key', apiKey };
  }
  return null;
}

/**
 * Append `/v1` to a gateway / proxy URL when it isn't already there so
 * `@ai-sdk/anthropic` resolves `${baseURL}/messages` to
 * `…/v1/messages`. Idempotent. Trims trailing slashes so we don't end
 * up with `…//v1`.
 */
export function ensureV1Suffix(rawBase) {
  if (!rawBase || typeof rawBase !== 'string') return rawBase;
  const trimmed = rawBase.replace(/\/+$/, '');
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

/**
 * Reshape a `resolveHarnessAuth` result into the loose
 * `{ baseURL?, authToken?, apiKey? }` shape expected by the runner's
 * call-site invokers (the runner doesn't care about the discriminated
 * `kind` tag — it just needs the credentials in flat form).
 *
 * Returns `{}` for null/undefined input or unknown `kind` so callers
 * can spread it unconditionally without a per-call branch.
 */
export function authToRunnerShape(auth) {
  if (!auth) return {};
  if (auth.kind === 'oauth')
    return { baseURL: auth.baseURL, authToken: auth.authToken };
  if (auth.kind === 'api-key')
    return auth.baseURL
      ? { baseURL: auth.baseURL, apiKey: auth.apiKey }
      : { apiKey: auth.apiKey };
  return {};
}
