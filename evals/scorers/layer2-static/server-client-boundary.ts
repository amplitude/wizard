/**
 * Layer 2, criterion 11 — browser SDK never imported into a
 * server-only file. Heavy (10 pts).
 *
 * The single highest-signal Layer 2 check. A `@amplitude/unified` (or
 * `@amplitude/analytics-browser`) import inside a Next.js Server
 * Component, server action, or `app/api/*` route handler is the
 * canonical regression: builds fine, ships, then breaks at runtime
 * on the first request that touches the page or attempts to render
 * the file on the server.
 *
 * Server-only heuristic, in order of certainty:
 *   1. `'use server'` directive on the file.
 *   2. File lives under `app/api/**` (App Router route handlers run
 *      server-only by contract).
 *   3. File lives under `app/**` AND does NOT carry `'use client'`
 *      AND is not the file the scenario nominated as the init file
 *      (some scenarios mark the init wrapper itself as the entry
 *      and rely on `'use client'` upstream of it — we trust the
 *      scenario for that one path).
 *
 * If the file matches any of those AND imports a browser SDK family,
 * we hard fail with the offending file path and import specifier.
 *
 * Same heuristic generalizes weakly to other frameworks; for now this
 * scorer focuses on the Next.js App Router pattern (the highest-
 * volume case per the framework-distribution data). Other frameworks
 * pass through.
 */

import { join } from 'node:path';

import {
  collectImports,
  getDirective,
  isScannable,
  parseFile,
} from './_ast-helpers.js';
import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

const BROWSER_SDK_PREFIXES = [
  '@amplitude/unified',
  '@amplitude/analytics-browser',
];

function importsBrowserSdk(specifiers: string[]): string | undefined {
  for (const spec of specifiers) {
    for (const prefix of BROWSER_SDK_PREFIXES) {
      if (spec === prefix || spec.startsWith(`${prefix}/`)) return spec;
    }
  }
  return undefined;
}

/**
 * Decide whether `path` (relative to install dir) is a server-only
 * file under the Next.js App Router contract. Returns the rationale
 * string if so, undefined otherwise.
 */
function classifyServerOnly(
  path: string,
  directive: 'use client' | 'use server' | undefined,
  scenario: Scenario,
): string | undefined {
  if (directive === 'use server') return "'use server' directive";
  // App Router route handlers under app/api/** run server-only.
  if (/^(?:src\/)?app\/api\//.test(path)) return 'app/api route handler';
  // App Router non-api files: server by default unless 'use client'.
  // The scenario's nominated init file is exempt — wizard agents
  // correctly place the boundary just above it.
  const inAppDir = /^(?:src\/)?app\//.test(path);
  if (
    inAppDir &&
    directive !== 'use client' &&
    path !== scenario.expectedInitFile &&
    !path.endsWith(`/${scenario.expectedInitFile}`)
  ) {
    // App Router files default to Server Components. We only flag
    // the file when it actually imports a browser SDK; the boundary
    // call below makes that decision.
    return 'App Router server component (no use client directive)';
  }
  return undefined;
}

export const scorer: Scorer = {
  id: 'L2-server-client-boundary',
  layer: 2,
  criterion: 11,
  description:
    'Browser-SDK imports must not appear in server-only files (App Router server components, server actions, app/api routes).',
  evaluate(artifact: Artifact, scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      return {
        pass: true,
        weight: 0,
        detail: 'EVALS_WORKING_DIR unset; cannot scan tree for boundary check',
      };
    }
    // App Router framework gating — for non-Next-App-Router scenarios
    // the heuristic is too lossy to apply. integrationHint check is a
    // soft fence; widen as other frameworks gain server-component
    // semantics.
    const looksAppRouter =
      scenario.integrationHint === 'nextjs' ||
      scenario.integrationHint === 'nextjs-app-router';
    if (!looksAppRouter) {
      return {
        pass: true,
        weight: 10,
        detail:
          'scenario is not Next.js App Router; boundary check skipped (heavy weight still scored as pass)',
      };
    }

    const candidates = [
      ...artifact.fsSnapshot.diff.added,
      ...artifact.fsSnapshot.diff.modified,
    ].filter((p) => isScannable(p));

    for (const path of candidates) {
      const sf = parseFile(join(root, path));
      if (!sf) continue;
      const imports = collectImports(sf);
      const offending = importsBrowserSdk(imports.map((i) => i.specifier));
      if (!offending) continue;
      const directive = getDirective(sf);
      const reason = classifyServerOnly(path, directive, scenario);
      if (reason) {
        return {
          pass: false,
          weight: 10,
          detail: `${path} imports browser SDK '${offending}' but is server-only (${reason})`,
          evidencePath: path,
        };
      }
    }
    return { pass: true, weight: 10 };
  },
};
