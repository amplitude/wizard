/**
 * Project signal classifiers for the wizard's "Discovered facts" feed.
 *
 * The TUI fades a chip-style chip per fact into the empty middle of
 * `RunScreen` while the agent boots (~30-60s). Beyond the literal stack
 * tags (Framework, TypeScript, Version, Package manager, Project,
 * Region) we surface two coarse, non-PII labels — *vertical* and
 * *app type* — derived from the user's `package.json` plus a couple of
 * directory probes. The goal is conversational warmth ("we noticed you
 * have Stripe — looks like an ecommerce app") without claiming
 * accuracy we can't deliver from a 50ms read.
 *
 * Design rules:
 * - First match wins per classifier; the priority order is documented
 *   in the PR body so adding a new bucket later is a one-liner.
 * - Return `null` instead of `'Unknown'`. The feed is purely cosmetic
 *   and an empty chip is better than a noisy one.
 * - Pure-data lookups go through `package.json`; the only filesystem
 *   probe is `app/api/` vs `pages/api/` for Next.js, which we inline
 *   with `fs.existsSync` rather than introducing a new abstraction.
 *
 * To add a new bucket:
 *   1. Add a check above the `return null` in `inferVertical` /
 *      `inferAppType` (order matters — first match wins).
 *   2. Add a happy-path test in `__tests__/classifier.test.ts`.
 *   3. Update the heuristic priority list in the PR description.
 */
import * as fs from 'node:fs';
import { join } from 'node:path';

import type { PackageDotJson } from '../../utils/package-json.js';
import { hasPackageInstalled } from '../../utils/package-json.js';

export interface InferredFact {
  value: string;
}

const AUTH_LIB_PREFIXES = ['@auth0/', '@clerk/', '@supabase/auth-'];
const AUTH_LIB_EXACT = ['next-auth'];

/**
 * Returns true if any dep / devDep / optionalDep matches `prefix`.
 * Exact matches (no slash on the wildcard) use `hasPackageInstalled`.
 */
function hasDepWithPrefix(
  packageJson: PackageDotJson,
  prefix: string,
): boolean {
  const buckets = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
  ];
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const name of Object.keys(bucket)) {
      if (name.startsWith(prefix)) return true;
    }
  }
  return false;
}

function hasAuthLib(packageJson: PackageDotJson): boolean {
  for (const exact of AUTH_LIB_EXACT) {
    if (hasPackageInstalled(exact, packageJson)) return true;
  }
  for (const prefix of AUTH_LIB_PREFIXES) {
    if (hasDepWithPrefix(packageJson, prefix)) return true;
  }
  return false;
}

function hasOrm(packageJson: PackageDotJson): boolean {
  return (
    hasPackageInstalled('prisma', packageJson) ||
    hasPackageInstalled('drizzle-orm', packageJson) ||
    hasPackageInstalled('mongoose', packageJson)
  );
}

/**
 * Coarse "what does this app do" label. Priority order (first match wins):
 *   1. Stripe → Ecommerce
 *   2. OpenAI / Anthropic / Vercel AI SDK → AI app
 *   3. ORM + auth lib → B2B SaaS
 *   4. Auth lib alone → SaaS
 *   5. null (don't pollute the feed)
 *
 * `installDir` is accepted for symmetry with `inferAppType`; the current
 * vertical heuristics are package.json-only.
 */
export function inferVertical(
  packageJson: PackageDotJson | null,
  _installDir: string,
): InferredFact | null {
  if (!packageJson) return null;

  // 1. Ecommerce — Stripe is the dominant signal and is rarely a
  //    transitive-only dep, so a top-level match is high-confidence.
  if (
    hasPackageInstalled('stripe', packageJson) ||
    hasDepWithPrefix(packageJson, '@stripe/')
  ) {
    return { value: 'Ecommerce' };
  }

  // 2. AI app — first-party AI SDKs. `ai` is the Vercel AI SDK package
  //    name; OpenAI and Anthropic are the obvious ones.
  if (
    hasPackageInstalled('openai', packageJson) ||
    hasPackageInstalled('@anthropic-ai/sdk', packageJson) ||
    hasPackageInstalled('ai', packageJson)
  ) {
    return { value: 'AI app' };
  }

  // 3 + 4. SaaS family — auth lib presence is the gate. Adding an ORM
  //    on top promotes "SaaS" to "B2B SaaS" since persisted user data
  //    plus auth is a strong B2B signal.
  if (hasAuthLib(packageJson)) {
    return { value: hasOrm(packageJson) ? 'B2B SaaS' : 'SaaS' };
  }

  return null;
}

/**
 * Coarse "what shape of app" label. Priority order (first match wins):
 *   1. Next.js + (`app/api/` || `pages/api/`) → Full-stack web
 *   2. Next.js without api/ → Marketing/SPA web
 *   3. Vite + react-router (no api/) → SPA web
 *   4. Express / Fastify / Hono with no FE framework → API server
 *   5. null
 *
 * The `app/api` / `pages/api` directory check is the only filesystem
 * probe; we inline `fs.existsSync` rather than introducing a helper
 * since this is the sole consumer.
 */
export function inferAppType(
  packageJson: PackageDotJson | null,
  installDir: string,
): InferredFact | null {
  if (!packageJson) return null;

  const hasNextJs = hasPackageInstalled('next', packageJson);
  const hasReact = hasPackageInstalled('react', packageJson);
  const hasVue = hasPackageInstalled('vue', packageJson);
  const hasAngular = hasPackageInstalled('@angular/core', packageJson);
  const hasReactRouter =
    hasPackageInstalled('react-router', packageJson) ||
    hasPackageInstalled('react-router-dom', packageJson);
  const hasVite = hasPackageInstalled('vite', packageJson);
  const hasExpress = hasPackageInstalled('express', packageJson);
  const hasFastify = hasPackageInstalled('fastify', packageJson);
  const hasHono = hasPackageInstalled('hono', packageJson);

  const hasApiRoutes =
    fs.existsSync(join(installDir, 'app', 'api')) ||
    fs.existsSync(join(installDir, 'pages', 'api'));

  if (hasNextJs) {
    return hasApiRoutes
      ? { value: 'Full-stack web' }
      : { value: 'Marketing/SPA web' };
  }

  if (hasVite && hasReactRouter && !hasApiRoutes) {
    return { value: 'SPA web' };
  }

  const hasBackendFramework = hasExpress || hasFastify || hasHono;
  const hasFrontendFramework = hasReact || hasVue || hasAngular;
  if (hasBackendFramework && !hasFrontendFramework) {
    return { value: 'API server' };
  }

  return null;
}
