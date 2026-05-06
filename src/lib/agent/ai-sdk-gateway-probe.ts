/**
 * Opt-in Vercel AI SDK probe against the same Anthropic-compatible endpoint
 * the Agent SDK uses ({@code ANTHROPIC_BASE_URL} + OAuth or API key).
 *
 * Turn on with {@code AMPLITUDE_WIZARD_AI_SDK_PROBE=1} after env is configured
 * (e.g. end of {@link initializeAgent}). Proves we can stream from the gateway
 * with `ai` + `@ai-sdk/anthropic` before replacing the main harness.
 *
 * Set {@code AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT=1} to throw on failure
 * (CI / dogfood). Default is log-only so a probe regression never blocks users.
 */
import { streamText } from 'ai';

import { logToFile } from '../../utils/debug.js';
import {
  createWizardAiSdkAnthropic,
  resolveWizardAnthropicAuthFromEnv,
} from './wizard-ai-sdk-anthropic.js';

export type AiSdkGatewayProbeResult =
  | { status: 'skipped'; reason: string }
  | { status: 'ok'; preview: string }
  | { status: 'error'; message: string };

/**
 * Single short completion to validate streaming + gateway auth. Does not use tools.
 */
export async function maybeRunAiSdkGatewayProbe(args: {
  useLocalClaude: boolean;
  /** Same model string passed to the Agent SDK (`selectModel` output). */
  model: string;
}): Promise<AiSdkGatewayProbeResult> {
  if (process.env.AMPLITUDE_WIZARD_AI_SDK_PROBE !== '1') {
    return {
      status: 'skipped',
      reason: 'AMPLITUDE_WIZARD_AI_SDK_PROBE is not 1',
    };
  }
  if (args.useLocalClaude) {
    return {
      status: 'skipped',
      reason: 'local Claude CLI path has no in-process HTTP endpoint to probe',
    };
  }

  const baseURL = process.env.ANTHROPIC_BASE_URL?.trim();
  const auth = resolveWizardAnthropicAuthFromEnv();
  if (!baseURL && !auth.apiKey) {
    return {
      status: 'skipped',
      reason: 'missing ANTHROPIC_BASE_URL (gateway) and ANTHROPIC_API_KEY',
    };
  }
  if (!auth.apiKey && !auth.authToken) {
    return {
      status: 'skipped',
      reason: 'missing ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN',
    };
  }

  try {
    const provider = createWizardAiSdkAnthropic();

    const result = streamText({
      model: provider(args.model),
      maxOutputTokens: 32,
      messages: [
        {
          role: 'user',
          content:
            'Reply with exactly this token and nothing else: wizard_ai_sdk_probe_ok',
        },
      ],
    });

    let text = '';
    for await (const part of result.textStream) {
      text += part;
    }
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    logToFile('AI SDK gateway probe finished:', preview);
    return { status: 'ok', preview };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToFile('AI SDK gateway probe failed:', err);
    return { status: 'error', message };
  }
}

export function enforceAiSdkProbeStrict(result: AiSdkGatewayProbeResult): void {
  if (
    result.status === 'error' &&
    process.env.AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT === '1'
  ) {
    throw new Error(
      `AI SDK gateway probe failed (AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT=1): ${result.message}`,
    );
  }
}
