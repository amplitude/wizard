/**
 * commandments — lock the user-visible TodoWrite plan.
 *
 * The wizard renders the agent's TodoWrite list as the progress bar the
 * user stares at for the entire run. Drift in those labels (or the
 * denominator) translates 1:1 to drift in user perception. This test
 * locks down the contract: exactly 5 todos, in this order, with these
 * exact strings — anything else needs an explicit, intentional change
 * to commandments AND this test in the same PR.
 *
 * If you find yourself updating the labels here, pause: every
 * additional engineering-internal label (CSP, env-vars, build verify,
 * setup-report) is a step backward. The 5 are deliberate user-visible
 * milestones; engineering phases roll up.
 */

import { describe, it, expect } from 'vitest';
import { getWizardCommandments } from '../commandments';

const REQUIRED_TODOS = [
  'Detect your project setup',
  'Install Amplitude',
  'Plan and approve events to track',
  'Wire up event tracking',
  'Open your dashboard',
] as const;

describe('TodoWrite user-journey commandment', () => {
  const text = getWizardCommandments();

  it('lists exactly five user-visible todos in order', () => {
    let cursor = 0;
    for (const label of REQUIRED_TODOS) {
      const idx = text.indexOf(label, cursor);
      expect(
        idx,
        `Expected "${label}" to appear after position ${cursor} in commandments — order matters because the agent reproduces the list verbatim and the user reads it top-to-bottom.`,
      ).toBeGreaterThan(-1);
      cursor = idx + label.length;
    }
  });

  it('explicitly forbids the engineering-internal labels that used to leak', () => {
    // The pre-fix list dumped 11 todos, including these four that read
    // like internal plumbing. Each must be called out as forbidden so a
    // future model rewrite doesn't quietly resurrect them.
    const forbidden = [
      'setup report',
      'build verification',
      'Content Security Policy',
      'doc fetches',
    ];
    for (const phrase of forbidden) {
      expect(
        text,
        `commandments should explicitly forbid "${phrase}" as a top-level todo so the progress bar stays clean.`,
      ).toContain(phrase);
    }
  });

  it('mandates the denominator stay 5 from first frame to last', () => {
    // Drift in the denominator (5 → 8 → 12) was the original "the
    // wizard is broken" signal. Lock the 5/5 invariant in.
    expect(text).toMatch(/X\s*\/\s*5\s*tasks complete/);
    expect(text).toMatch(/denominator MUST stay 5/);
  });

  it('does not re-introduce the open-ended "every high-level area" wording', () => {
    // The bug-source phrase from the prior commandment. Specific
    // negative test so a sloppy re-merge can't bring it back.
    expect(text).not.toContain('every high-level area of work');
  });
});
