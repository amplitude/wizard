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
 * This test greps the source tree for `setKey('signupInFlight', …)`
 * and fails if any production source file outside `src/ui/tui/store.ts`
 * matches. Test files are exempt (they construct fixtures directly).
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'src');
const ALLOWED = path.join('ui', 'tui', 'store.ts');
const SETTER_PATTERN = /setKey\(\s*['"]signupInFlight['"]/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx') &&
      !full.includes(`${path.sep}__tests__${path.sep}`)
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
      if (!SETTER_PATTERN.test(content)) continue;
      const rel = path.relative(REPO_SRC, file);
      if (rel === ALLOWED) continue;
      offending.push(rel);
    }
    expect(offending).toEqual([]);
  });
});
