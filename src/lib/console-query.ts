/**
 * console-query — single-turn Claude call for the ConsoleView.
 *
 * Uses the global agent (getAgent) so all calls share the same initialized
 * SDK config (gateway URL, model, env) rather than making raw fetch calls.
 */

import type { WizardSession } from './wizard-session.js';
import { getLlmGatewayUrlFromHost } from '../utils/urls.js';
import { RunPhase } from './wizard-session.js';
import { getAgent } from './agent-interface.js';
import { safeParseSDKMessage } from './middleware/schemas.js';
import { WIZARD_TOOL_NAMES } from './wizard-tools.js';

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
    return {
      kind: 'gateway',
      baseUrl: getLlmGatewayUrlFromHost(session.credentials.host),
      apiKey: session.credentials.projectApiKey,
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
  if (session.selectedProjectName)
    lines.push(`Project: ${session.selectedProjectName}`);
  // Amplitude's UI labels this "Project ID" — keep user-facing label familiar
  // even though the canonical code term is `appId`.
  if (session.credentials?.appId)
    lines.push(`Project ID: ${session.credentials.appId}`);

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

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Send a message to Claude with optional conversation history and return the text response. */
export async function queryConsole(
  userMessage: string,
  sessionContext: string,
  creds: ConsoleCredentials,
  history: ConversationTurn[] = [],
): Promise<string> {
  if (creds.kind === 'none') {
    return 'Claude is not available yet — complete authentication first.';
  }

  const agentConfig = await getAgent();
  const { query } = (await import('@anthropic-ai/claude-agent-sdk')) as {
    query: (params: {
      prompt: string;
      options?: Record<string, unknown>;
    }) => AsyncIterable<unknown>;
  };

  const historyBlock =
    history.length > 0
      ? '\n\n--- Conversation history ---\n' +
        history
          .map(
            (t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`,
          )
          .join('\n') +
        '\n--- End of history ---'
      : '';

  const collectedText: string[] = [];

  const response = query({
    prompt: userMessage,
    options: {
      model: agentConfig.model,
      cwd: agentConfig.workingDirectory,
      permissionMode: 'bypassPermissions',
      mcpServers: agentConfig.mcpServers,
      allowedTools: WIZARD_TOOL_NAMES,
      systemPrompt: sessionContext + historyBlock,
      env: process.env,
    },
  });

  for await (const rawMessage of response) {
    const parsed = safeParseSDKMessage(rawMessage);
    if (!parsed.ok) continue;
    const message = parsed.message;
    if (message.type === 'assistant') {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            collectedText.push(block.text);
          }
        }
      }
    }
  }

  return collectedText.join('') || '(empty response)';
}
