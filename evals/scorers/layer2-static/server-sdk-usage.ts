/**
 * Layer 2, criterion 12 — server SDK is used in API routes / server
 * actions when server-side tracking is present. Heavy (10 pts).
 *
 * Pair with criterion 11 (server-client-boundary): that scorer says
 * "browser SDK must not appear in server-only files." This one says
 * "if the agent put tracking in a server-only file, it must use the
 * server SDK family (`@amplitude/analytics-node`)."
 *
 * Triggers only when:
 *   - The diff includes a server-only file (matches the same
 *     heuristic as criterion 11), AND
 *   - That file calls `track(...)` or `init(...)` against an
 *     Amplitude SDK.
 *
 * Pass if no server-only Amplitude usage exists. Pass if server-only
 * usage exists and uses `@amplitude/analytics-node`. Fail otherwise.
 *
 * Note: criterion 11 hard-fails on the wrong-import case directly,
 * so this scorer mostly handles the "server file, but the wrong
 * server SDK or somehow no SDK at all" angle. They're complementary.
 */

import { join } from 'node:path';
import * as ts from 'typescript';

import {
  collectImports,
  getDirective,
  isScannable,
  parseFile,
} from './_ast-helpers.js';
import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

const SERVER_SDK = '@amplitude/analytics-node';
const ALL_AMPLITUDE_PREFIXES = [
  '@amplitude/unified',
  '@amplitude/analytics-browser',
  '@amplitude/analytics-node',
];

function isServerOnly(
  path: string,
  source: ts.SourceFile,
  scenario: Scenario,
): boolean {
  const directive = getDirective(source);
  if (directive === 'use server') return true;
  if (/^(?:src\/)?app\/api\//.test(path)) return true;
  const inAppDir = /^(?:src\/)?app\//.test(path);
  if (
    inAppDir &&
    directive !== 'use client' &&
    path !== scenario.expectedInitFile &&
    !path.endsWith(`/${scenario.expectedInitFile}`)
  ) {
    return true;
  }
  return false;
}

function importsAnyAmplitude(specifiers: string[]): string | undefined {
  for (const spec of specifiers) {
    for (const prefix of ALL_AMPLITUDE_PREFIXES) {
      if (spec === prefix || spec.startsWith(`${prefix}/`)) return spec;
    }
  }
  return undefined;
}

export const scorer: Scorer = {
  id: 'L2-server-sdk-usage',
  layer: 2,
  criterion: 12,
  description:
    'Server-side Amplitude usage must use @amplitude/analytics-node, not the browser SDK family.',
  evaluate(artifact: Artifact, scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      return {
        pass: true,
        weight: 0,
        detail: 'EVALS_WORKING_DIR unset; cannot scan tree',
      };
    }
    const looksAppRouter =
      scenario.integrationHint === 'nextjs' ||
      scenario.integrationHint === 'nextjs-app-router';
    if (!looksAppRouter) {
      return {
        pass: true,
        weight: 10,
        detail: 'scenario is not Next.js App Router; server-SDK check skipped',
      };
    }

    const candidates = [
      ...artifact.fsSnapshot.diff.added,
      ...artifact.fsSnapshot.diff.modified,
    ].filter((p) => isScannable(p));

    for (const path of candidates) {
      const sf = parseFile(join(root, path));
      if (!sf) continue;
      if (!isServerOnly(path, sf, scenario)) continue;

      const imports = collectImports(sf);
      const amplitudeImport = importsAnyAmplitude(
        imports.map((i) => i.specifier),
      );

      // Gate on an Amplitude import — `track`/`init` are common
      // function names elsewhere (other analytics SDKs, local helpers
      // named `init`). Without this gate, a server file with an
      // unrelated `track('lead_qualified')` call would hard-fail
      // criterion 12 even though the wizard never touched it.
      if (!amplitudeImport) continue;

      const usesServerSdk = imports.some(
        (i) =>
          i.specifier === SERVER_SDK ||
          i.specifier.startsWith(`${SERVER_SDK}/`),
      );

      // Server-only file with Amplitude usage — must be the server
      // SDK family. (Criterion 11 catches the wrong-import case
      // independently; this catches "server-only but missing the
      // node SDK" or odd mixes.)
      if (!usesServerSdk) {
        return {
          pass: false,
          weight: 10,
          detail: `${path} runs server-only but doesn't use ${SERVER_SDK}`,
          evidencePath: path,
        };
      }
    }
    return { pass: true, weight: 10 };
  },
};
