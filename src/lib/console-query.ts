/**
 * console-query — single-turn Claude call for the ConsoleView.
 *
 * Uses the Amplitude LLM gateway when credentials are available,
 * or falls back to ANTHROPIC_API_KEY for direct API access.
 */

import { z } from 'zod';
import type { WizardSession } from './wizard-session.js';
import { getLlmGatewayUrlFromHost } from '../utils/urls.js';
import { RunPhase } from './wizard-session.js';

const MODEL_DIRECT = 'claude-haiku-4-5-20251001';
const MODEL_GATEWAY = 'anthropic/claude-haiku-4-5-20251001';
const MAX_TOKENS = 512;

export type ConsoleCredentials =
  | { kind: 'gateway'; baseUrl: string; apiKey: string }
  | { kind: 'direct'; apiKey: string }
  | { kind: 'none' };

/** Resolve credentials from session + env, in priority order. */
export function resolveConsoleCredentials(
  session: WizardSession,
): ConsoleCredentials {
  // Gateway: set after initializeAgent runs
  if (process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN) {
    return {
      kind: 'gateway',
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
    };
  }

  // Session credentials: available after auth screen
  if (session.credentials?.projectApiKey && session.credentials?.host) {
    const devToken = process.env.WIZARD_PROXY_DEV_TOKEN;
    return {
      kind: 'gateway',
      baseUrl: getLlmGatewayUrlFromHost(session.credentials.host),
      apiKey: devToken ?? session.credentials.projectApiKey,
    };
  }

  // Direct Anthropic API key
  if (process.env.ANTHROPIC_API_KEY) {
    return { kind: 'direct', apiKey: process.env.ANTHROPIC_API_KEY };
  }

  return { kind: 'none' };
}

/** Build a compact plain-text summary of the current session state for the system prompt. */
export function buildSessionContext(session: WizardSession): string {
  const lines: string[] = [
    'You are a helpful assistant embedded in the Amplitude Wizard CLI.',
    "Answer the user's questions concisely. Focus on the current wizard state below.",
    '',
    '--- Current wizard state ---',
    `Phase: ${session.runPhase ?? RunPhase.Idle}`,
  ];

  if (session.region) lines.push(`Region: ${session.region}`);
  if (session.detectedFrameworkLabel)
    lines.push(`Framework: ${session.detectedFrameworkLabel}`);
  if (session.integration) lines.push(`Integration: ${session.integration}`);
  if (session.selectedOrgName) lines.push(`Org: ${session.selectedOrgName}`);
  if (session.selectedWorkspaceName)
    lines.push(`Workspace: ${session.selectedWorkspaceName}`);
  if (session.credentials?.projectId)
    lines.push(`Project ID: ${session.credentials.projectId}`);

  if (session.runPhase === RunPhase.Completed) {
    lines.push('Status: Wizard run completed successfully.');
  } else if (session.runPhase === RunPhase.Error) {
    lines.push('Status: Wizard run finished with an error.');
  } else if (session.runPhase === RunPhase.Running) {
    lines.push('Status: Wizard agent is currently running.');
  }

  if (session.outroData?.message) {
    lines.push(`Last message: ${session.outroData.message}`);
  }

  return lines.join('\n');
}

/** Send a single-turn message to Claude and return the text response. */
export async function queryConsole(
  userMessage: string,
  sessionContext: string,
  creds: ConsoleCredentials,
): Promise<string> {
  if (creds.kind === 'none') {
    return 'Claude is not available yet — complete authentication first.';
  }

  const { baseUrl, headers } =
    creds.kind === 'gateway'
      ? {
          baseUrl: `${creds.baseUrl}/v1/messages`,
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            Authorization: `Bearer ${creds.apiKey}`,
          },
        }
      : {
          baseUrl: 'https://api.anthropic.com/v1/messages',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': creds.apiKey,
          },
        };

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: creds.kind === 'gateway' ? MODEL_GATEWAY : MODEL_DIRECT,
      max_tokens: MAX_TOKENS,
      system: sessionContext,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API error ${res.status}: ${body.slice(0, 120)}`);
  }

  const ClaudeResponseSchema = z
    .object({
      content: z
        .array(z.object({ text: z.string().optional() }).passthrough())
        .optional(),
    })
    .passthrough();
  const data = ClaudeResponseSchema.parse(await res.json());
  return data.content?.[0]?.text ?? '(empty response)';
}
