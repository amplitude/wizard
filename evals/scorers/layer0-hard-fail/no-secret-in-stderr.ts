/**
 * Layer 0 — no secret-shaped content survives in captured stderr.
 *
 * The runner already pipes stderr through `redactString` from
 * `src/lib/observability/redact.ts` at capture time. This scorer is
 * the post-condition check: if anything that LOOKS like a secret
 * (JWT, Bearer header, ≥32-char hex, or the literal eval API key)
 * appears in the redacted stderr, the redactor failed and we have a
 * potential leak. Hard fail.
 *
 * The patterns mirror the live ones in
 * `src/lib/observability/redact.ts` STRING_PATTERNS. If those change,
 * update here too — there's a comment over there pointing back. The
 * intentional duplication keeps the scorer independent of the redactor's
 * own bugs (a redactor regression that drops a pattern shouldn't make
 * this scorer silently lenient).
 */

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

const TOKEN_SHAPES: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'JWT',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    name: 'Bearer header',
    // Match an unredacted Bearer; the redactor replaces with
    // `Bearer [REDACTED]`, so anything else is a leak.
    pattern: /Bearer\s+(?!\[REDACTED\])[^\s"']+/i,
  },
  {
    name: 'API-key-shaped hex',
    pattern: /\b[a-f0-9]{32,}\b/i,
  },
];

function resolveApiKey(): string | undefined {
  return (
    process.env.AMPLITUDE_EVAL_API_KEY ?? process.env.AMPLITUDE_WIZARD_API_KEY
  );
}

export const scorer: Scorer = {
  id: 'L0-no-secret-in-stderr',
  layer: 0,
  // Spec criterion 5 (parse-stream contract: no raw secrets in
  // stdout/stderr). Tracked as a hard-fail in the layered stack.
  criterion: 5,
  description:
    'Redacted stderr must not contain any token-shaped string or the eval API key literal.',
  evaluate(artifact: Artifact, _scenario: Scenario) {
    const stderr = artifact.stderr;
    if (!stderr) return { pass: true, weight: 0 };

    // 1. Token-shape check — if the redactor missed any of these
    // shapes, we have a leak.
    for (const { name, pattern } of TOKEN_SHAPES) {
      const m = pattern.exec(stderr);
      if (m) {
        const window = stderr
          .slice(Math.max(0, m.index - 20), m.index + m[0].length + 20)
          .replace(/\s+/g, ' ');
        return {
          pass: false,
          hardFail: true,
          weight: 0,
          detail: `${name}-shaped string survived stderr redaction near "${window}"`,
        };
      }
    }

    // 2. Specific eval API key — if the runner's key (or its first 16
    // chars) appears in stderr, the redactor wasn't covering it. The
    // hex-string pattern above catches most key shapes; this is the
    // belt-and-braces check for keys that fall outside that pattern.
    const apiKey = resolveApiKey();
    if (apiKey) {
      const fragment = apiKey.slice(0, 16);
      if (stderr.includes(apiKey) || stderr.includes(fragment)) {
        return {
          pass: false,
          hardFail: true,
          weight: 0,
          detail: 'eval API key literal survived stderr redaction',
        };
      }
    }

    return { pass: true, weight: 0 };
  },
};
