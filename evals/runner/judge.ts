/**
 * Layer 6 — LLM judge.
 *
 * Submits the post-wizard diff + setup_complete + event-plan to a
 * Claude Sonnet judge guided by the rubric in
 * `evals/rubrics/judge-prompt.md` (versioned via `rubric-version.txt`).
 * Parses the structured JSON response, validates the verdict shape,
 * and returns a {@link JudgeResult} the L6 scorers can grade.
 *
 * Why we control the judge ourselves rather than relying on a hosted
 * service: rubric versioning. We need to correlate score drift with
 * rubric changes, and we don't want a vendor's silent prompt update to
 * break the scorer comparison.
 *
 * Why structured output: every verdict requires `criterion`,
 * `evidence_path`, `evidence_line_start`. A judge response missing any
 * of these is treated as a flake and dropped — better to skip a
 * verdict than to ship a citation-less verdict that's hard to triage.
 *
 * Auth: the judge calls Anthropic via `@anthropic-ai/sdk`. The runner
 * reads the API key from `ANTHROPIC_API_KEY`; if absent, returns a
 * skip-result with `ok: false` and a clear detail. The Amplitude LLM
 * gateway path is the next step (it's what the wizard itself uses) —
 * out of scope for this PR.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

import type {
  AgentEventEnvelope,
  EventPlanConfirmedData,
  SetupCompleteData,
} from '../../src/lib/agent-events.js';
import type { Artifact, Scenario } from './types.js';

export const VerdictSchema = z.object({
  criterion: z.number().int().min(1).max(19),
  pass: z.boolean(),
  weight: z.number().int().min(0).max(10),
  rationale: z.string().min(1),
  evidence_path: z.string().min(1),
  evidence_line_start: z.number().int().positive(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const JudgeResponseSchema = z.object({
  rubric_version: z.string().min(1),
  verdicts: z.array(VerdictSchema),
  free_form: z.string().default(''),
});
export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

export interface JudgeResult {
  /** Whether the call completed and the response parsed. */
  ok: boolean;
  /** The validated judge response (when `ok=true`). */
  response?: JudgeResponse;
  /** One-line failure message when `ok=false`. */
  detail?: string;
  /** Rubric version the runner injected at call time. */
  rubricVersion: string;
  /** Round-trip wall-clock for the judge call. */
  durationMs: number;
}

const RUBRICS_DIR = resolve(__dirname, '..', 'rubrics');

function loadRubricFiles(): { systemPrompt: string; rubricVersion: string } {
  const systemPrompt = readFileSync(
    join(RUBRICS_DIR, 'judge-prompt.md'),
    'utf8',
  );
  const rubricVersion = readFileSync(
    join(RUBRICS_DIR, 'rubric-version.txt'),
    'utf8',
  ).trim();
  return { systemPrompt, rubricVersion };
}

function extractSetupComplete(
  runLog: AgentEventEnvelope[],
): SetupCompleteData | undefined {
  for (const env of runLog) {
    const data = env.data as SetupCompleteData | undefined;
    if (data?.event === 'setup_complete') return data;
  }
  return undefined;
}

function extractConfirmedEvents(runLog: AgentEventEnvelope[]): string[] {
  const out: string[] = [];
  for (const env of runLog) {
    const data = env.data as EventPlanConfirmedData | undefined;
    if (
      data?.event === 'event_plan_confirmed' &&
      data.decision === 'approved'
    ) {
      // The proposed event names live on `event_plan_proposed`; stitch
      // them in by name from the latest proposal that preceded the
      // confirmation. Most goldens carry a single proposed/confirmed
      // pair so the simple "use the most recent proposal" rule works.
      for (let i = runLog.length - 1; i >= 0; i--) {
        const proposal = runLog[i].data as
          | { event?: string; events?: Array<{ name: string }> }
          | undefined;
        if (proposal?.event === 'event_plan_proposed' && proposal.events) {
          for (const ev of proposal.events) out.push(ev.name);
          break;
        }
      }
    }
  }
  return out;
}

function buildUserMessage(
  scenario: Scenario,
  artifact: Artifact,
  workingDir: string,
  rubricVersion: string,
): string {
  const setupComplete = extractSetupComplete(artifact.runLog);
  const confirmedEvents = extractConfirmedEvents(artifact.runLog);
  const diff = renderDiff(artifact, workingDir);

  return [
    `# Eval input`,
    ``,
    `## Scenario`,
    `- name: ${scenario.name}`,
    `- ring: ${scenario.ring}`,
    `- framework hint: ${scenario.integrationHint}`,
    ``,
    `## Rubric version`,
    rubricVersion,
    ``,
    `## Confirmed events`,
    confirmedEvents.length > 0
      ? confirmedEvents.map((n) => `- ${n}`).join('\n')
      : '(none)',
    ``,
    `## setup_complete event`,
    '```json',
    JSON.stringify(setupComplete ?? null, null, 2),
    '```',
    ``,
    `## Working tree diff (post-wizard)`,
    diff,
    ``,
    `Return your structured JSON verdict now. The runner expects exactly the shape described in the system prompt — no prose wrapping, no code fences.`,
  ].join('\n');
}

function renderDiff(artifact: Artifact, workingDir: string): string {
  const sections: string[] = [];
  const { added, modified, deleted } = artifact.fsSnapshot.diff;

  for (const path of added) {
    let body: string;
    try {
      body = readFileSync(join(workingDir, path), 'utf8');
    } catch {
      body = '(file content unavailable)';
    }
    sections.push(`### added: ${path}\n\`\`\`\n${body}\n\`\`\``);
  }

  // Modified files: include the full post-wizard content. Computing a
  // proper unified diff at this scale is overkill — the judge sees the
  // pristine baseline once at training time anyway, and the post-state
  // is what they're grading.
  for (const path of modified) {
    let body: string;
    try {
      body = readFileSync(join(workingDir, path), 'utf8');
    } catch {
      body = '(file content unavailable)';
    }
    sections.push(`### modified: ${path}\n\`\`\`\n${body}\n\`\`\``);
  }

  for (const path of deleted) {
    sections.push(`### deleted: ${path}`);
  }

  return sections.join('\n\n');
}

/**
 * Strip a Markdown code fence if the model returned one. Otherwise a
 * vanilla ```json ... ``` wrapper trips JSON.parse. Keep this lenient
 * so a small formatting drift doesn't kill the judge result.
 */
function stripCodeFence(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith('```')) {
    const without = trimmed
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```\s*$/i, '');
    return without.trim();
  }
  return trimmed;
}

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
}

interface AnthropicClient {
  messages: {
    create: (req: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) => Promise<AnthropicMessageResponse>;
  };
}

async function loadAnthropic(): Promise<
  ((apiKey: string) => AnthropicClient) | null
> {
  try {
    const mod = (await import('@anthropic-ai/sdk')) as unknown as {
      default: new (opts: { apiKey: string }) => AnthropicClient;
    };
    return (apiKey) => new mod.default({ apiKey });
  } catch {
    return null;
  }
}

export interface RunJudgeOptions {
  scenario: Scenario;
  artifact: Artifact;
  workingDir: string;
  /** Override the default model. Defaults to claude-sonnet-4-7. */
  model?: string;
}

export async function runJudge(options: RunJudgeOptions): Promise<JudgeResult> {
  const start = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const { systemPrompt, rubricVersion } = loadRubricFiles();
  if (!apiKey) {
    return {
      ok: false,
      detail: 'skipped: ANTHROPIC_API_KEY not set',
      rubricVersion,
      durationMs: Date.now() - start,
    };
  }
  const factory = await loadAnthropic();
  if (!factory) {
    return {
      ok: false,
      detail: 'skipped: @anthropic-ai/sdk not installed',
      rubricVersion,
      durationMs: Date.now() - start,
    };
  }

  const client = factory(apiKey);
  const userMessage = buildUserMessage(
    options.scenario,
    options.artifact,
    options.workingDir,
    rubricVersion,
  );

  let raw: string;
  try {
    const completion = await client.messages.create({
      model: options.model ?? 'claude-sonnet-4-7',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const textBlock = completion.content.find((c) => c.type === 'text');
    raw = textBlock?.text ?? '';
  } catch (err) {
    return {
      ok: false,
      detail: `judge call failed: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
      rubricVersion,
      durationMs: Date.now() - start,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    return {
      ok: false,
      detail: `judge response was not valid JSON: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
      rubricVersion,
      durationMs: Date.now() - start,
    };
  }

  const validation = JudgeResponseSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      ok: false,
      detail: `judge response failed schema validation: ${validation.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .slice(0, 3)
        .join('; ')}`,
      rubricVersion,
      durationMs: Date.now() - start,
    };
  }

  return {
    ok: true,
    response: validation.data,
    rubricVersion,
    durationMs: Date.now() - start,
  };
}
