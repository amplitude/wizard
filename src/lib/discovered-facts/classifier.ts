/**
 * LLM-powered project classifiers for the wizard's "Discovered facts" feed.
 *
 * The TUI fades a chip-style chip per fact into the empty middle of
 * `RunScreen` while the agent boots (~30-60s). Beyond the literal stack
 * tags (Framework, TypeScript, Version, Package manager, Project,
 * Region) we surface two coarse, non-PII labels — *vertical* and
 * *app type* — inferred by a lightweight Haiku LLM call against the
 * user's `package.json` dependencies plus a couple of directory probes.
 *
 * Design rules:
 * - Return `null` instead of `'Unknown'`. The feed is purely cosmetic
 *   and an empty chip is better than a noisy one.
 * - On any LLM failure (network, auth, timeout) the classifier
 *   degrades silently — both fields return `null`, the feed just
 *   doesn't show the chip.
 * - The LLM call is fire-and-forget from the runner; chips fade in
 *   asynchronously when the response arrives (~1-2s).
 */
import * as fs from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import type { PackageDotJson } from '../../utils/package-json.js';
import { logToFile } from '../../utils/debug.js';

export const projectFactsSchema = z.object({
  vertical: z
    .string()
    .nullable()
    .describe(
      'Coarse "what does this app do" label, e.g. Ecommerce, AI app, B2B SaaS, SaaS, Developer tools, Content/media, Healthcare, Fintech, Education, Gaming, Social. Null when no confident classification is possible.',
    ),
  appType: z
    .string()
    .nullable()
    .describe(
      'Coarse "what shape of app" label, e.g. Full-stack web, Marketing/SPA web, SPA web, API server, Mobile app, Desktop app, CLI tool, Library/SDK. Null when no confident classification is possible.',
    ),
});

export type ProjectFacts = z.infer<typeof projectFactsSchema>;

/**
 * Credentials for making a one-shot LLM call.
 *
 * Gateway mode: `baseURL` + `authToken` (Amplitude proxy, most users).
 * Direct mode: `apiKey` (user supplied `ANTHROPIC_API_KEY`).
 */
export type LlmClassifierConfig =
  | { baseURL: string; authToken: string }
  | { apiKey: string };

/** Deduplicated, sorted list of all dependency names across all buckets. */
export function collectDependencyNames(packageJson: PackageDotJson): string[] {
  const deps = new Set<string>();
  for (const bucket of [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
  ]) {
    if (!bucket) continue;
    for (const name of Object.keys(bucket)) deps.add(name);
  }
  return [...deps].sort();
}

/** Probe a small set of directories that disambiguate app shape. */
export function collectDirectorySignals(
  installDir: string,
): Record<string, boolean> {
  return {
    'app/api': fs.existsSync(join(installDir, 'app', 'api')),
    'pages/api': fs.existsSync(join(installDir, 'pages', 'api')),
    'src/app/api': fs.existsSync(join(installDir, 'src', 'app', 'api')),
    'src/pages/api': fs.existsSync(join(installDir, 'src', 'pages', 'api')),
  };
}

export function buildClassificationPrompt(
  dependencies: string[],
  directorySignals: Record<string, boolean>,
): string {
  const dirLines = Object.entries(directorySignals)
    .map(([dir, exists]) => `  ${dir}: ${exists ? 'present' : 'absent'}`)
    .join('\n');

  return [
    'Classify this software project based on its npm dependencies and directory structure.',
    '',
    'Return two short labels:',
    '1. "vertical" — what the app does. Use one of these when they fit: Ecommerce, AI app, B2B SaaS, SaaS, Developer tools, Content/media, Healthcare, Fintech, Education, Gaming, Social. You may use a different short label if none of these fit well. Return null if you cannot confidently classify.',
    '2. "appType" — the shape/architecture of the app. Use one of these when they fit: Full-stack web, Marketing/SPA web, SPA web, API server, Mobile app, Desktop app, CLI tool, Library/SDK. You may use a different short label if none of these fit well. Return null if you cannot confidently classify.',
    '',
    'Guidelines:',
    '- Keep labels short (1-3 words).',
    '- Prefer null over a wrong guess — only classify when there is strong signal.',
    '- Auth libraries (next-auth, @auth0/*, @clerk/*, @supabase/auth-*) combined with an ORM (prisma, drizzle-orm, mongoose) suggest B2B SaaS. Auth alone suggests SaaS.',
    '- Payment libraries (stripe, @stripe/*) are a strong Ecommerce signal.',
    '- AI SDKs (openai, @anthropic-ai/sdk, ai) indicate an AI app.',
    '- Next.js with API route directories means Full-stack web; without them, Marketing/SPA web.',
    '- Express/Fastify/Hono without a frontend framework likely means API server.',
    '',
    `Dependencies:\n${dependencies.join(', ')}`,
    '',
    `Directory structure signals:\n${dirLines}`,
  ].join('\n');
}

/**
 * Infer the project's vertical and app type via a one-shot Haiku LLM call.
 *
 * Returns `{ vertical: null, appType: null }` on any failure — the feed
 * just doesn't show those chips, which is always safe.
 */
export async function inferProjectFacts(
  packageJson: PackageDotJson | null,
  installDir: string,
  llmConfig: LlmClassifierConfig,
): Promise<ProjectFacts> {
  const empty: ProjectFacts = { vertical: null, appType: null };

  if (!packageJson) return empty;

  const dependencies = collectDependencyNames(packageJson);
  if (dependencies.length === 0) return empty;

  const directorySignals = collectDirectorySignals(installDir);
  const prompt = buildClassificationPrompt(dependencies, directorySignals);

  try {
    const [{ generateObject }, { createAnthropic }] = await Promise.all([
      import('ai'),
      import('@ai-sdk/anthropic'),
    ]);
    const { sanitizingFetch } = await import('../gateway-request-sanitize.js');

    const { ensureV1Suffix } =
      await import('../agent/wizard-ai-sdk-anthropic.js');
    const providerConfig =
      'apiKey' in llmConfig
        ? { apiKey: llmConfig.apiKey }
        : {
            baseURL: ensureV1Suffix(llmConfig.baseURL),
            authToken: llmConfig.authToken,
          };

    const provider = createAnthropic({
      ...providerConfig,
      fetch: sanitizingFetch,
    });

    const { HAIKU_MODEL_DIRECT, HAIKU_MODEL_GATEWAY } =
      await import('../agent/model-config.js');
    const modelId =
      'apiKey' in llmConfig ? HAIKU_MODEL_DIRECT : HAIKU_MODEL_GATEWAY;

    const { object } = await generateObject({
      model: provider(modelId),
      schema: projectFactsSchema,
      prompt,
    });

    return object;
  } catch (err) {
    logToFile(
      `[discovered-facts] LLM classification failed (graceful skip): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return empty;
  }
}
