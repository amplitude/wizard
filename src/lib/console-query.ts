/**
 * console-query — single-turn Claude call for the ConsoleView.
 *
 * Uses the global agent (getAgent) so all calls share the same initialized
 * SDK config (gateway URL, model, env) rather than making raw fetch calls.
 *
 * Opt-in: {@code AMPLITUDE_WIZARD_AI_SDK_CONSOLE=1} routes slash prompts
 * through Vercel AI SDK (`streamText` + {@link sanitizingFetch}), matching the
 * gateway probe stack. Local CLI runs keep the Agent SDK path.
 */

import type { WizardSession } from './wizard-session.js';
import { getLlmGatewayUrlFromHost } from '../utils/urls.js';
import { RunPhase } from './wizard-session.js';
import {
  buildAgentEnv,
  getAgent,
  type AgentRunConfig,
} from './agent-interface.js';
import { safeParseSDKMessage } from './middleware/schemas.js';
import { resolveWizardAllowedToolNames } from './wizard-tools.js';
import { getConsoleQueryStack } from './agent/console-query-stack.js';
import { selectModel } from './agent/model-config.js';
import { getAgentDriver } from './agent-driver.js';
import { parseAnthropicCustomHeaderBlock } from '../utils/custom-headers.js';
import { getUI } from '../ui/index.js';
import { classifyModelTier, formatModelDisplay } from './agent-events.js';

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

function buildHistoryBlock(history: ConversationTurn[]): string {
  if (history.length === 0) return '';
  return (
    '\n\n--- Conversation history ---\n' +
    history
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n') +
    '\n--- End of history ---'
  );
}

async function queryConsoleWithClaudeAgentSdk(
  userMessage: string,
  systemAndHistory: string,
  agentConfig: AgentRunConfig,
): Promise<string> {
  const query = await getAgentDriver();

  const collectedText: string[] = [];

  const customHeaders = buildAgentEnv(
    agentConfig.wizardMetadata ?? {},
    agentConfig.wizardFlags ?? {},
    agentConfig.agentSessionId,
  );

  const response = query({
    prompt: userMessage,
    options: {
      model: agentConfig.model,
      cwd: agentConfig.workingDirectory,
      permissionMode: 'bypassPermissions',
      mcpServers: agentConfig.mcpServers,
      allowedTools: resolveWizardAllowedToolNames(),
      systemPrompt: systemAndHistory,
      env: {
        ...process.env,
        ANTHROPIC_CUSTOM_HEADERS: customHeaders,
      },
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

/**
 * AI SDK path: same gateway + headers as the probe; no MCP / wizard-tools
 * (slash console is Q&A only in this mode).
 */
async function queryConsoleWithVercelAiSdk(
  userMessage: string,
  systemAndHistory: string,
  agentConfig: AgentRunConfig,
): Promise<string> {
  // Dynamic imports keep `ai` and `@ai-sdk/anthropic` (transitively pulled by
  // `wizard-ai-sdk-anthropic.ts`) out of every wizard run. They only load when
  // AMPLITUDE_WIZARD_AI_SDK_CONSOLE actually routes a console query through
  // this path.
  const [{ streamText }, { createWizardAiSdkAnthropic, ensureV1Suffix }] =
    await Promise.all([
      import('ai'),
      import('./agent/wizard-ai-sdk-anthropic.js'),
    ]);

  const customHeaders = buildAgentEnv(
    agentConfig.wizardMetadata ?? {},
    agentConfig.wizardFlags ?? {},
    agentConfig.agentSessionId,
  );

  // Explicitly normalize the baseURL with `ensureV1Suffix` so the AI SDK's
  // `${baseURL}/messages` resolves to `…/v1/messages` against the wizard
  // gateway. The factory applies this internally too, but passing it at the
  // callsite documents the contract (and would survive a factory refactor
  // that ever stopped normalizing).
  const baseURL = ensureV1Suffix(process.env.ANTHROPIC_BASE_URL?.trim());

  const provider = createWizardAiSdkAnthropic({
    ...(baseURL ? { baseURL } : {}),
    headers: parseAnthropicCustomHeaderBlock(customHeaders),
  });

  // Slash-prompt Q&A is a one-shot, no-tool-loop call. Per
  // `MIGRATION_PLAN.md` strategic posture #10, route this through Haiku
  // instead of inheriting the inner-loop Sonnet alias from
  // `agentConfig.model`. The Agent SDK fallback path (below) keeps Sonnet
  // for now — narrower blast radius if Haiku misbehaves.
  const oneshotModel = selectModel(
    'oneshot',
    agentConfig.useDirectApiKey ?? false,
  );

  // PR B9: announce the classifier-tier model the slash-console call
  // is about to run. Pure observability — emitter dedups on (model,
  // context) so back-to-back slash prompts in the same run are a
  // no-op on the wire. try/catch so a misbehaving emitter never
  // blocks the call.
  try {
    getUI().emitModelUsed?.({
      model: oneshotModel,
      modelDisplay: formatModelDisplay(oneshotModel),
      modelTier: classifyModelTier(oneshotModel),
      context: 'classifier',
    });
  } catch {
    // observational; never block console query.
  }

  const result = streamText({
    model: provider(oneshotModel),
    system: systemAndHistory,
    messages: [{ role: 'user', content: userMessage }],
  });

  let text = '';
  for await (const part of result.textStream) {
    text += part;
  }
  return text.trim() || '(empty response)';
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
  const historyBlock = buildHistoryBlock(history);
  const systemAndHistory = sessionContext + historyBlock;

  // Forward x-amp-wizard-session-id so slash-prompt LLM calls land in the
  // SAME Agent Analytics session as the main agent run, instead of falling
  // through to the proxy's per-token-hash fallback (which would collapse all
  // slash-prompt queries across every wizard run a user has ever done into
  // one synthetic session).
  //
  // buildAgentEnv runs in both stacks — Agent SDK via ANTHROPIC_CUSTOM_HEADERS,
  // Vercel AI SDK via createAnthropic headers.

  if (getConsoleQueryStack(agentConfig) === 'vercel-ai-sdk') {
    return queryConsoleWithVercelAiSdk(
      userMessage,
      systemAndHistory,
      agentConfig,
    );
  }

  return queryConsoleWithClaudeAgentSdk(
    userMessage,
    systemAndHistory,
    agentConfig,
  );
}
