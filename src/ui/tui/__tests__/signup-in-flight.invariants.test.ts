/**
 * Singleton-writer invariant for `signupInFlight`.
 *
 * The flag is the back-nav wall's signal that an agentic-signup POST is
 * currently awaiting response. The wall is correct only as long as the
 * flag is mutated exclusively by `WizardStore.runSignupAttempt`'s
 * try/finally and `_resetCeremonyKeys` — both inside `store.ts`. A stray
 * write from anywhere else could leave the wall stuck on (no clear in
 * the response handler) or fire spuriously.
 *
 * Production code can mutate the field two ways:
 *   1. `setKey('signupInFlight', …)` — the direct atom write
 *   2. `store.session = { …, signupInFlight: … }` — full replacement
 *      via the store's session setter (legitimately used at startup
 *      and by IntroScreen / mcp / default commands for state swaps)
 *
 * Both shapes are checked. Test files and `__tests__/` directories are
 * exempt because fixtures construct sessions directly.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'src');
const ALLOWED = path.join('ui', 'tui', 'store.ts');
const SETTER_PATTERNS = [
  /setKey\(\s*['"]signupInFlight['"]/,
  // Catches `signupInFlight: true|false` outside an isWall predicate
  // (the wall callsites in flows.ts read the field, not write it).
  // The pattern matches an object-literal key assignment to a boolean
  // literal — what an attempted backdoor write would look like.
  /signupInFlight\s*:\s*(?:true|false)\b/,
];

// Files outside `store.ts` that legitimately reference signupInFlight
// in non-mutating contexts (read-only predicates, schema declarations,
// the freshSession factory's default value).
const READ_ONLY_ALLOWED = new Set([
  path.join('lib', 'wizard-session.ts'), // type decl + freshSession default (`signupInFlight: false`)
  path.join('ui', 'tui', 'flows.ts'), // signupCommittedWall reads `s.signupInFlight`
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      if (entry.name === '__tests__') continue;
      out.push(...walk(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('signupInFlight singleton-writer invariant', () => {
  it('is mutated only inside src/ui/tui/store.ts', () => {
    const offending: string[] = [];
    for (const file of walk(REPO_SRC)) {
      const content = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(REPO_SRC, file);
      if (rel === ALLOWED) continue;

      for (const pattern of SETTER_PATTERNS) {
        if (!pattern.test(content)) continue;
        // The freshSession factory's `signupInFlight: false` default
        // and the type decl's `: boolean` are legitimate; skip them.
        if (READ_ONLY_ALLOWED.has(rel)) continue;
        offending.push(`${rel} (matched ${pattern.source})`);
        break;
      }
    }
    expect(offending).toEqual([]);
  });
});
