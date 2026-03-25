/**
 * Plan generator — creates an instrumentation plan before the agent runs.
 *
 * Makes a lightweight direct API call to the LLM gateway using the user's
 * credentials to analyze the project and propose a plan.
 * The user can approve, skip, or give feedback to refine the plan.
 */

import fs from 'fs';
import path from 'path';
import type { WizardSession } from './wizard-session.js';
import type { FrameworkConfig } from './framework-config.js';
import { getLlmGatewayUrlFromHost } from '../utils/urls.js';
import { WIZARD_USER_AGENT } from './constants.js';
import { logToFile } from '../utils/debug.js';

const PLAN_MODEL_GATEWAY = 'anthropic/claude-haiku-4-5';
const PLAN_MODEL_DIRECT = 'claude-haiku-4-5-20251001';
const MAX_FILE_SIZE = 6_000; // chars per file
const MAX_SOURCE_FILES = 4;

function readFileSafe(filePath: string, maxLen = MAX_FILE_SIZE): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.length > maxLen
      ? content.slice(0, maxLen) + '\n...(truncated)'
      : content;
  } catch {
    return null;
  }
}

function gatherProjectContext(installDir: string): string {
  const parts: string[] = [];

  const pkgJson = readFileSafe(path.join(installDir, 'package.json'));
  if (pkgJson) {
    parts.push(`## package.json\n\`\`\`json\n${pkgJson}\n\`\`\``);
  }

  // Common entry points to scan for user-facing interactions
  const candidates = [
    'src/App.tsx',
    'src/App.ts',
    'src/App.js',
    'app/layout.tsx',
    'app/layout.js',
    'pages/_app.tsx',
    'pages/_app.js',
    'src/main.ts',
    'src/main.tsx',
    'src/main.js',
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'app.ts',
    'app.js',
    'server.ts',
    'server.js',
  ];

  let added = 0;
  for (const candidate of candidates) {
    if (added >= MAX_SOURCE_FILES) break;
    const content = readFileSafe(path.join(installDir, candidate));
    if (content) {
      parts.push(`## ${candidate}\n\`\`\`\n${content}\n\`\`\``);
      added++;
    }
  }

  return parts.join('\n\n');
}

interface PlanRequest {
  config: FrameworkConfig;
  session: WizardSession;
  priorFeedback?: string[];
}

/**
 * Generate an instrumentation plan by calling the LLM gateway directly.
 * Uses a lightweight single-turn call (no agent loop, no tools).
 */
export async function generateInstrumentationPlan({
  config,
  session,
  priorFeedback,
}: PlanRequest): Promise<string> {
  const credentials = session.credentials;
  if (!credentials) {
    throw new Error('No credentials available for plan generation');
  }

  const projectContext = gatherProjectContext(session.installDir);

  // Prefer a real OAuth access token from ~/.ampli.json if available
  let accessToken = credentials.accessToken;
  try {
    const { getStoredUser, getStoredToken } = await import(
      '../utils/ampli-settings.js'
    );
    const user = getStoredUser();
    const stored = getStoredToken(user?.id, user?.zone);
    if (stored?.accessToken) {
      accessToken = stored.accessToken;
    }
  } catch {
    // Fall back to session credentials
  }

  const useDirectApiKey = !!process.env.ANTHROPIC_API_KEY;

  const messagesUrl = useDirectApiKey
    ? 'https://api.anthropic.com/v1/messages'
    : `${getLlmGatewayUrlFromHost(credentials.host)}/v1/messages`;

  const model = useDirectApiKey ? PLAN_MODEL_DIRECT : PLAN_MODEL_GATEWAY;

  const systemPrompt = `You are a developer assistant helping plan an Amplitude analytics integration.
Analyze the project files and produce a clear, concise instrumentation plan.

The plan should include:
1. The SDK package(s) to be installed
2. 4–8 meaningful events to track, grounded in what the app actually does
3. Key files that will likely be modified

Format the plan with clear sections using markdown headers.
Keep it under 300 words — be specific and actionable, not generic.`;

  const feedbackSection =
    priorFeedback && priorFeedback.length > 0
      ? `\n\nThe user gave feedback on a previous plan draft:\n${priorFeedback
          .map((f, i) => `${i + 1}. "${f}"`)
          .join('\n')}\n\nRevise the plan to address this feedback.`
      : '';

  const userMessage = `I'm integrating Amplitude analytics into a ${
    config.metadata.name
  } project.${feedbackSection}

Project files:

${
  projectContext ||
  '(No source files found — produce a general plan for a new project)'
}

Produce the instrumentation plan.`;

  logToFile('[plan-generator] Generating plan via', messagesUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'User-Agent': WIZARD_USER_AGENT,
  };

  if (useDirectApiKey) {
    headers['x-api-key'] = process.env.ANTHROPIC_API_KEY!;
  } else {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(messagesUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    logToFile('[plan-generator] API error:', response.status, errorText);
    throw new Error(
      `Plan generation failed (${response.status}): ${errorText}`,
    );
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = data.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text)
    .filter(Boolean)
    .join('\n');

  if (!text) {
    throw new Error('Plan generation returned no text');
  }

  logToFile('[plan-generator] Plan generated successfully');
  return text;
}
