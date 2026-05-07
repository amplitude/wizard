/**
 * TUI encapsulation invariant for `performSignupOrAuth`.
 *
 * The TUI has exactly one supported path to the agentic-signup POST:
 * `WizardStore.runSignupAttempt`, which wraps `performSignupOrAuth` in
 * a try/finally that toggles `signupInFlight` so the back-nav wall
 * (`signupCommittedWall` in `flows.ts`) can block Esc while the
 * request is pending.
 *
 * A bare `performSignupOrAuth(...)` call from anywhere else inside
 * `src/ui/tui/` would skip the wall and re-introduce the BA-114 race:
 * the response could land on a session that's been wiped by Esc
 * mid-POST. This test fails if any TUI source file imports
 * `performSignupOrAuth` directly except `src/ui/tui/store.ts` (the
 * wrapper).
 *
 * Non-TUI modes (CI / agent / classic, via
 * `src/commands/helpers.ts` → `runDirectSignupIfRequested`) are
 * intentionally NOT covered by this test — they have no Esc handler
 * and no `WizardStore` instance, so there's no wall to maintain and
 * the bare call is correct.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const TUI_ROOT = path.resolve(__dirname, '..');
const ALLOWED = path.join(TUI_ROOT, 'store.ts');
// Match real references — imports, calls, type queries — but skip
// comment / JSDoc mentions of the symbol. Comments are documentary
// and don't affect runtime; the wall correctness only depends on
// whether the symbol is actually imported or invoked.
const REAL_REFERENCE_PATTERNS = [
  /\bimport\b[^;]*\bperformSignupOrAuth\b/,
  /\bperformSignupOrAuth\s*\(/,
];

function isRealReference(content: string): boolean {
  // Strip line comments and block comments before pattern matching so
  // a doc reference doesn't trigger a false positive.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return REAL_REFERENCE_PATTERNS.some((p) => p.test(stripped));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
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

describe('performSignupOrAuth TUI encapsulation', () => {
  it('is imported or called only by src/ui/tui/store.ts inside the TUI tree', () => {
    const offending: string[] = [];
    for (const file of walk(TUI_ROOT)) {
      if (file === ALLOWED) continue;
      const content = fs.readFileSync(file, 'utf-8');
      if (isRealReference(content)) {
        offending.push(path.relative(TUI_ROOT, file));
      }
    }
    expect(offending).toEqual([]);
  });
});
