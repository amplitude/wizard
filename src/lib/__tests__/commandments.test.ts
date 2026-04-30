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
  'Build your starter dashboard',
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

  // Regression — the Excalidraw run review surfaced two bash denies
  // when the agent went straight to a complex `grep -E "(error TS|...)"
  // | head -30` form to filter typecheck output (parens trip
  // DANGEROUS_OPERATORS, multi-pipe trips the single-pipe-only rule).
  // The setup report claimed "TypeScript type-checking could not be
  // run with pipe operators" — misleading; the simple form would have
  // worked. Lock the simple-form examples in.
  it('shows simple build/typecheck shapes that survive the bash allowlist', () => {
    // Direct invocation — no pipe, no chaining
    expect(text).toContain('yarn test:typecheck');
    expect(text).toContain('npx tsc --noEmit');
    // Single-pipe-to-tail/head allowance
    expect(text).toContain('| tail -50');
    expect(text).toContain('| head -30');
    // Negative examples flagged with ✗
    expect(text).toContain('✗');
    expect(text).toContain('grep -E');
    expect(text).toContain('multiple pipes');
  });
});

/**
 * Browser-only commandment gating.
 *
 * Browser SDK init defaults (autocapture options table, init-code
 * templates) are only valid for `@amplitude/unified` /
 * `@amplitude/analytics-browser`. Shipping that block to mobile, server,
 * or generic runs is pure system-prompt bloat (several KB on every turn)
 * and risks the model copying browser keys onto a non-browser SDK.
 *
 * These tests pin: when `targetsBrowser` is true, the browser block is
 * present; when it's false (or omitted), it's gone — but every universal
 * rule still ships.
 */
describe('browser-only commandment gating', () => {
  const browserText = getWizardCommandments({ targetsBrowser: true });
  const nonBrowserText = getWizardCommandments({ targetsBrowser: false });
  const defaultText = getWizardCommandments();

  it('includes browser SDK init defaults only on browser runs', () => {
    // The marker phrase is the heading of the browser SDK init defaults
    // block. Conservative sentinel — short enough to be stable across
    // future copy edits, distinctive enough not to false-match.
    const browserMarker = 'Browser SDK init defaults';
    expect(browserText).toContain(browserMarker);
    expect(nonBrowserText).not.toContain(browserMarker);
  });

  it('omits browser-only autocapture details from non-browser runs', () => {
    // The full autocapture options table and the unified-SDK initAll
    // example are the bulkiest items in the browser block. Asserting
    // both confirms the omission isn't accidentally partial.
    expect(nonBrowserText).not.toContain('frustrationInteractions');
    expect(nonBrowserText).not.toContain('initAll(API_KEY');
    expect(browserText).toContain('frustrationInteractions');
    expect(browserText).toContain('initAll(API_KEY');
  });

  // Regression — Excalidraw run review surfaced 6 instrumented files
  // importing `track` directly from `@amplitude/analytics-browser`
  // while the agent had also written an `amplitude.ts` re-export
  // wrapper that nothing actually used. Reconciled with context-hub:
  // every browser app under context-hub/basics/* uses init in the
  // framework's natural entry file (instrumentation-client.ts /
  // main.tsx / __root.tsx) plus direct namespace imports everywhere
  // else — there is no project-local re-export wrapper. The browser
  // commandments steer the agent at that pattern instead of mandating
  // a wrapper, so the dead-code failure mode never gets started.
  it('steers browser runs to entry-file init + direct namespace imports', () => {
    // RIGHT pattern: namespace import straight from the SDK package.
    expect(browserText).toContain('// ✓ RIGHT');
    expect(browserText).toContain('import * as amplitude from');
    // WRONG pattern: building a re-export wrapper and routing
    // callsites through it — the Excalidraw failure mode.
    expect(browserText).toContain('// ✗ WRONG');
    expect(browserText).toContain('re-export wrapper');
    // The "dead code" framing is what makes the rule durable across
    // copy edits; if it disappears the rule loses its teeth.
    expect(browserText).toContain('dead code');
  });

  it('default (no options) treats run as non-browser — conservative', () => {
    // If we don't know the platform, ship the lean prompt. Mobile,
    // server, and generic frameworks must never carry browser-only
    // guidance just because someone forgot to pass `targetsBrowser`.
    expect(defaultText).toBe(nonBrowserText);
  });

  it('keeps every universal rule on both paths', () => {
    // Sample a few rules that must appear on every run regardless of
    // platform: the package-manager tool requirement, the retry budget,
    // the Read-before-Write rule, and the post-instrumentation events
    // file write (which the wizard's post-agent dashboard step depends
    // on). If any of these silently moves into the browser-only block,
    // this test fails and the omission is caught before it ships.
    const universalSentinels = [
      'detect_package_manager',
      'Retry budget for ANY tool failure',
      'Before writing to any file',
      '.amplitude-events.json',
      'amplitude-setup-report.md',
    ];
    for (const phrase of universalSentinels) {
      expect(
        browserText,
        `"${phrase}" should be in every run's commandments (browser).`,
      ).toContain(phrase);
      expect(
        nonBrowserText,
        `"${phrase}" should be in every run's commandments (non-browser).`,
      ).toContain(phrase);
    }
  });

  it('non-browser run is meaningfully smaller than browser run', () => {
    // The whole point of the gating is system-prompt size. If the
    // savings ever drop below ~2KB, either the browser block has been
    // gutted (in which case it should be deleted entirely, not gated)
    // or a future merge has accidentally moved its content into the
    // universal section. Either way, we want a test failure on regress.
    const savedBytes = browserText.length - nonBrowserText.length;
    expect(savedBytes).toBeGreaterThan(2000);
  });
});

/**
 * Discovery parallelism — the cold-start tail of every wizard run was
 * dominated by sequential probes (detect_package_manager → check_env_keys
 * → Glob package.json → Read package.json), each costing a full LLM
 * round-trip. The commandment tells the agent to fan out independent
 * tools in ONE assistant message; the SDK runs them in parallel and we
 * collapse 4 round-trips into 1. These tests pin the rule so future
 * commandment edits can't quietly remove it.
 */
describe('discovery parallelism commandment', () => {
  const text = getWizardCommandments();

  it('mandates fanning out independent probes in one assistant message', () => {
    // The verb "fan out" is the durable sentinel — short, distinctive,
    // and unlikely to false-match anywhere else in the prompt.
    expect(text).toContain('fan out');
    expect(text).toMatch(/in[\s-]?ONE assistant message/i);
  });

  it('explicitly names the cold-start probes that must batch together', () => {
    // The 3 probes the agent currently serializes on every run. If a
    // future copy edit drops one of these names, the rule loses its
    // teeth — the model needs concrete tool names to act on.
    expect(text).toContain('mcp__wizard-tools__detect_package_manager');
    expect(text).toContain('mcp__wizard-tools__check_env_keys');
  });

  it('still allows serializing dependent calls', () => {
    // The optimization is parallelism for INDEPENDENT calls; we don't
    // want the agent fanning out Read-after-Glob (where Read needs the
    // glob's matches). The "depends on" carve-out keeps the rule honest.
    expect(text).toMatch(/depend|dependent|depends on/i);
  });

  it('allows multi-file Edit/Write parallelism but forbids same-file fanout', () => {
    // Updated policy (perf): independent-file Edits in one assistant
    // message are the single biggest wall-clock win during the "Wire up
    // event tracking" phase. Same-file fanout is still a correctness
    // footgun (write/write races) and must remain forbidden. Lock both
    // halves of the policy in.
    expect(text).toContain('Write tools (Edit / Write)');
    expect(text).toMatch(/different file/i);
    expect(text).toMatch(/same file/i);
    expect(text).toMatch(/Read-before-Write/);
  });
});
