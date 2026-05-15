/**
 * commandments — lock the user-visible TodoWrite plan.
 *
 * The wizard renders the agent's TodoWrite list as the progress bar the
 * user stares at for the entire run. Drift in those labels (or the
 * denominator) translates 1:1 to drift in user perception. This test
 * locks down the contract: exactly 4 todos, in this order, with these
 * exact strings — anything else needs an explicit, intentional change
 * to commandments AND this test in the same PR.
 *
 * History: this list was 5 todos until DEFER_DASHBOARD_PLAN PR 4 — chart
 * and dashboard creation moved to the deferred `amplitude-wizard dashboard`
 * command, so the main run's checklist drops the dashboard step.
 *
 * If you find yourself updating the labels here, pause: every
 * additional engineering-internal label (CSP, env-vars, build verify,
 * setup-report) is a step backward. The 4 are deliberate user-visible
 * milestones; engineering phases roll up.
 */

import { describe, it, expect } from 'vitest';
import { getWizardCommandments } from '../commandments';
import { CANONICAL_LABELS } from '../canonical-tasks';

// Single source of truth: the labels the agent must use in TodoWrite
// live in `canonical-tasks.ts` and are consumed both by the store
// (which renders them) and by these tests (which lock the system
// prompt to them).
const REQUIRED_TODOS = CANONICAL_LABELS;

describe('TodoWrite user-journey commandment', () => {
  const text = getWizardCommandments();

  it('lists exactly four user-visible todos in order', () => {
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

  it('mandates the denominator stay 4 from first frame to last', () => {
    // Drift in the denominator (4 → 6 → 9) was the original "the
    // wizard is broken" signal. Lock the 4/4 invariant in. Was 5/5
    // until DEFER_DASHBOARD_PLAN PR 4 — see the file header for context.
    expect(text).toMatch(/X\s*\/\s*4\s*tasks complete/);
    expect(text).toMatch(/denominator MUST stay 4/);
  });

  it('does not re-introduce the open-ended "every high-level area" wording', () => {
    // The bug-source phrase from the prior commandment. Specific
    // negative test so a sloppy re-merge can't bring it back.
    expect(text).not.toContain('every high-level area of work');
  });

  it('does not list the dropped dashboard step or in-loop chart MCP tools', () => {
    // DEFER_DASHBOARD_PLAN PR 4 regression guard. The 5th step
    // ("Build your starter dashboard") and the inline call-list
    // (`record_dashboard`, `create_chart`, `create_dashboard`) MUST
    // NOT be the kind of work the agent thinks it should do during
    // `wizard run` — those moved to the deferred
    // `amplitude-wizard dashboard` command. The commandments may
    // mention these tool names ONLY in negative form ("do not call ...").
    expect(text).not.toContain('Build your starter dashboard');
    expect(text).not.toContain('5. Build your starter dashboard');
    // The denominator must NOT advertise five steps.
    expect(text).not.toMatch(/X\s*\/\s*5\s*tasks complete/);
    // If `record_dashboard` is mentioned at all it MUST be in a
    // negative ("do not") clause. This regex guards against a future
    // copy edit that re-introduces the tool name as something the
    // agent should call.
    const recordDashboardOccurrences = text.match(/record_dashboard/g) ?? [];
    if (recordDashboardOccurrences.length > 0) {
      // Every mention must sit alongside a "do not" / "MUST NOT" /
      // "deferred" cue. Use a coarse window check rather than a
      // literal regex so the wording can evolve.
      const allMentionsAreNegative = text
        .split(/record_dashboard/)
        .slice(0, -1)
        .every((preceding, idx) => {
          const after = text.split(/record_dashboard/)[idx + 1] ?? '';
          const window = `${preceding.slice(-200)}record_dashboard${after.slice(
            0,
            200,
          )}`;
          return /(do not|MUST NOT|deferred|do NOT)/i.test(window);
        });
      expect(
        allMentionsAreNegative,
        'every commandments mention of `record_dashboard` must sit in a "do not call" / "deferred" clause',
      ).toBe(true);
    }
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
    // / setup report guidance. If any of these silently moves into the
    // browser-only block, this test fails and the omission is caught
    // before it ships.
    const universalSentinels = [
      'detect_package_manager',
      'Retry budget for ANY tool failure',
      'Before writing to any file',
      '.amplitude/events.json',
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
 * discover-analytics-patterns — Lendi (Jamie Lim) reported the wizard
 * reimplemented every event on top of the raw SDK even though their
 * codebase already had a `trackEvent()` wrapper. Root cause: the
 * commandments did not require the agent to load the
 * `discover-analytics-patterns` skill before `confirm_event_plan`, so
 * existing wrappers / hooks / typed-Ampli calls went unnoticed. The
 * commandment below pins the requirement, and the skill is now
 * pre-staged via `preStageSkills` so `mcp__wizard-tools__load_skill` can
 * load it by id.
 *
 * If this rule disappears (or moves out of the pre-confirm-event-plan
 * phase) the failure mode the customer hit comes back, so lock both
 * the rule's presence and its ordering relative to confirm_event_plan.
 */
describe('discover-analytics-patterns commandment', () => {
  const text = getWizardCommandments();

  it('mandates loading discover-analytics-patterns before the event plan', () => {
    // Skill name is the durable sentinel — the agent matches on it
    // exactly when calling `mcp__wizard-tools__load_skill`.
    expect(text).toContain('discover-analytics-patterns');
    // The "BEFORE confirm_event_plan" ordering is what makes the rule
    // matter — pattern discovery has to happen before the plan is
    // proposed, otherwise the agent has already committed to a shape.
    // Anchor the comparison against the standalone confirm_event_plan
    // mandate, which begins "you MUST call confirm_event_plan" — that
    // phrase is unique to the dedicated rule and won't false-match the
    // discover-analytics-patterns commandment that simply names
    // confirm_event_plan as a downstream gate.
    const discoverIdx = text.indexOf('discover-analytics-patterns');
    const confirmRuleIdx = text.indexOf('you MUST call confirm_event_plan');
    expect(
      discoverIdx,
      'discover-analytics-patterns rule missing',
    ).toBeGreaterThan(-1);
    expect(
      confirmRuleIdx,
      'confirm_event_plan mandate rule missing',
    ).toBeGreaterThan(-1);
    expect(
      discoverIdx,
      'discover-analytics-patterns must be ordered BEFORE the confirm_event_plan mandate so the agent runs discovery before proposing a plan',
    ).toBeLessThan(confirmRuleIdx);
  });

  it('explicitly tells the agent to reuse existing wrappers rather than reimplement', () => {
    // The customer-facing failure mode: agent ignores `trackEvent()`
    // and writes raw `amplitude.track()` calls. The commandment
    // language must make the reuse-vs-reimplement choice unambiguous.
    expect(text).toMatch(/REUSE/);
    expect(text).toMatch(/wrapper/i);
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

/**
 * Autocapture-no-propose commandment — a live test in the Excalidraw
 * codebase exposed the bug: the agent proposed 14 events, then the
 * Setup Report's "Autocapture coverage" section explained that 8 of
 * them were "covered by autocapture — no track() needed." User
 * feedback verbatim: *"Auto capture takes work from the user to setup
 * those events. We didn't use to skip implementing events that were
 * proposed. If auto capture should do it, we should not be proposing."*
 *
 * The fix is upstream: refuse to propose events that autocapture
 * handles. This test pins the commandment text so the rule can't
 * silently drift — if a future copy edit waters it down, the failure
 * mode (propose-but-don't-implement, with a band-aid in the Setup
 * Report) comes straight back.
 */
describe('autocapture-no-propose commandment', () => {
  // The universal rule applies to every run; the surface catalog with
  // exact SDK identifiers lives in the browser-only block because
  // mobile SDKs autocapture different surfaces (Swift: .sessions /
  // .appLifecycles / .screenViews; backend SDKs: none). Tests are
  // split accordingly.
  const universalText = getWizardCommandments();
  const browserText = getWizardCommandments({ targetsBrowser: true });

  it('forbids proposing events fully covered by autocapture (universal)', () => {
    // The MUST NOT formulation is the durable sentinel — it's what the
    // model anchors on when deciding whether to drop a candidate event.
    // Must be in the UNIVERSAL block so mobile / server runs see it too.
    expect(universalText).toContain(
      'Events fully covered by Amplitude autocapture MUST NOT be proposed in the event plan',
    );
    // Explicitly names the failure mode in the commandment so a future
    // skim-reader (model or human) understands why the rule exists.
    expect(universalText).toMatch(
      /proposing an event the wizard will not implement is a bug/i,
    );
  });

  it('names every browser autocapture surface in the browser-only block', () => {
    // The 10 default autocapture surfaces from @amplitude/unified /
    // @amplitude/analytics-browser. If the SDK adds or renames one,
    // both this list and the commandment copy update together — the
    // wizard's events.json shape is keyed on those names, and the
    // prompt must reference them by their exact API identifier so the
    // model can grep for matches in init code. Verified against
    // generic-wizard-agent.ts initAll example.
    const surfaces = [
      'attribution',
      'pageViews',
      'sessions',
      'formInteractions',
      'fileDownloads',
      'elementInteractions',
      'frustrationInteractions',
      'networkTracking',
      'webVitals',
      'errorMonitoring',
    ];
    for (const surface of surfaces) {
      expect(
        browserText,
        `browser commandments should name autocapture surface "${surface}" so the agent can match it against the SDK init config.`,
      ).toContain(surface);
    }
  });

  it('points the model at the upstream autocapture catalog (both blocks)', () => {
    // The published Amplitude doc is the source of truth — if the
    // commandment ever stops linking to it, future SDK additions
    // (e.g. a new autocapture key) won't get caught by the agent.
    // The link must appear in BOTH the universal block (so non-browser
    // runs can still navigate to it for orientation) AND the browser-
    // only block (where the surface table lives).
    expect(universalText).toContain(
      'https://amplitude.com/docs/data/sdks/browser-2/autocapture',
    );
    expect(browserText).toContain(
      'https://amplitude.com/docs/data/sdks/browser-2/autocapture',
    );
  });

  it('orders the autocapture rule AFTER the confirm_event_plan mandate', () => {
    // The agent reads the system prompt top-to-bottom. We deliberately
    // place the autocapture filter immediately AFTER the
    // confirm_event_plan mandate so the agent has the mandate context
    // (events.json shape, plan ownership) before reading the filter.
    const autocaptureIdx = universalText.indexOf(
      'Events fully covered by Amplitude autocapture MUST NOT be proposed',
    );
    const confirmRuleIdx = universalText.indexOf(
      'you MUST call confirm_event_plan',
    );
    expect(
      autocaptureIdx,
      'autocapture-no-propose rule missing',
    ).toBeGreaterThan(-1);
    expect(
      confirmRuleIdx,
      'confirm_event_plan mandate rule missing',
    ).toBeGreaterThan(-1);
    expect(
      autocaptureIdx,
      'autocapture-no-propose rule should appear immediately after the confirm_event_plan mandate so the agent has the mandate context before reading the filter',
    ).toBeGreaterThan(confirmRuleIdx);
  });

  it('explicitly forbids the "include with a note" loophole (universal)', () => {
    // The most likely failure mode after this commandment ships: the
    // model includes an autocaptured event anyway with a description
    // like "covered by autocapture — for reference." Reject that
    // pattern by name so a future eval can't legitimize it.
    expect(universalText).toMatch(/do NOT include it with a note/);
    expect(universalText).toMatch(/do NOT mention it in the description/i);
  });

  it('pins exact example event-name shapes that must be dropped (universal)', () => {
    // The Excalidraw run had events like "Canvas Exported" (a single
    // button click), "Library Item Added" (drag-drop), "Chart Pasted"
    // (paste handler), "Command Palette Opened" (key combo) — all
    // dispatched by element interactions autocapture catches. The
    // commandment's example list trains the model on the shape of the
    // events that must be dropped, not just the abstract category.
    // These appear in the universal block so mobile runs also see
    // common shape examples (form / session / page surfaces are
    // cross-platform concepts even though the exact SDK options differ).
    expect(universalText).toMatch(/"\[X\] Clicked"/);
    expect(universalText).toMatch(/"Page Viewed"/);
    expect(universalText).toMatch(/"Session Started"/);
    expect(universalText).toMatch(/"Form Submitted"/);
  });
});

/**
 * Pre-flight context — the wizard injects a structured Markdown block at
 * the top of the first user message containing every value the agent used
 * to probe for at cold-start (cwd, framework, package manager, env files,
 * AMPLITUDE_* key presence, org/project/region, project-binding state).
 * The commandment below tells the agent to trust that block on turn 1
 * instead of fanning out `detect_package_manager` / `check_env_keys` /
 * Glob+Read calls that re-derive the same answers — but keeps the
 * discovery tools available for genuine mid-run verification.
 *
 * The rule pairs with the `discovery parallelism` rule above (it is
 * fine for the agent to parallelize when it must probe; this rule says
 * "you usually don't have to probe at all"). It must also stay
 * authoritative: if it ever gets watered down, the cold-start
 * regression — and the hallucination-prone discovery loop — comes
 * straight back.
 */
/**
 * track() property mandate + Setup Report reconciliation.
 *
 * Excalidraw live test exposed two failure modes:
 *   1. 10 of 12 approved events were instrumented as bare `track("name")`
 *      with no properties — analyst can only count occurrences, not slice.
 *   2. 2 events were silently dropped; the Setup Report celebrated "10
 *      instrumented" without explaining what happened to the other 2.
 *
 * These commandments raise the floor: every track() call carries 1-3
 * properties, and the Setup Report reconciles every approved-plan event
 * into Instrumented / Autocaptured / Dropped buckets with totals matching
 * the plan. Tests pin the exact sentinel phrasing so a future copy edit
 * can't quietly soften the rule.
 */
describe('track() property mandate commandment', () => {
  const text = getWizardCommandments();

  it('mandates 1-3 properties on every track() call', () => {
    // Exact sentinel from the rule — keeps the property-count contract
    // pinned across copy edits. The rule wraps `track()` in backticks
    // so the agent renders it as code.
    expect(text).toContain(
      'Every `track()` call you write MUST include 1-3 properties',
    );
  });

  it('shows the GOOD example with prompt_length / model / latency_ms', () => {
    // The shape of the GOOD example is the durable teaching artifact —
    // it shows the agent how to mine context from local variables
    // without inventing values. Pin the exact track call.
    expect(text).toContain('amplitude.track("ai diagram generated"');
    expect(text).toContain('prompt_length: prompt.length');
    expect(text).toContain('model: "claude-sonnet-4-6"');
    expect(text).toContain('latency_ms: Date.now() - startedAt');
  });

  it('shows a BAD bare-event example so the failure mode is named', () => {
    // The Excalidraw failure mode — bare `track("scene saved to backend")`
    // with no properties. Naming it as BAD makes the contrast unmissable.
    expect(text).toContain('// BAD');
    expect(text).toContain('amplitude.track("scene saved to backend")');
  });

  it('carves out a single-property fallback for unavoidable lifecycle events', () => {
    // The rule has to leave room for the rare "no useful context here"
    // callsite. The carve-out tells the agent: prefer 1 property over 0,
    // and document the gap in the Setup Report. Lock the carve-out
    // language so a future edit doesn't accidentally turn the rule
    // absolute (which would lead to invented property values).
    expect(text).toContain('prefer a single property over zero');
    expect(text).toContain('no properties captured — context unavailable');
  });
});

describe('Setup Report reconciliation commandment', () => {
  const text = getWizardCommandments();

  it('mandates reconciling every approved-plan event into three buckets', () => {
    // Exact sentinel: the rule must name the file and the reconcile verb.
    expect(text).toContain(
      'MUST reconcile every event in the approved `.amplitude/events.json` plan',
    );
  });

  it('names all three buckets with the exact labels', () => {
    // The bucket labels are the contract — they appear verbatim in the
    // Setup Report's reconciliation section, so the agent and the
    // downstream renderer both need a single source of truth.
    expect(text).toContain('**Instrumented**');
    expect(text).toContain('**Covered by autocapture**');
    expect(text).toContain('**Dropped**');
  });

  it('forces specific autocapture-surface naming, not the generic claim', () => {
    // The Excalidraw failure mode wasn't just dropped events — even when
    // the agent did report autocapture coverage, it said "autocapture
    // handles it" without naming WHICH surface. The user can't verify
    // that. Lock the specificity requirement and the explicit
    // counter-example phrasing in.
    expect(text).toContain(
      'Generic "autocapture handles it" is insufficient — be specific',
    );
    // Concrete examples that demonstrate the expected specificity.
    expect(text).toContain('autocapture.elementInteractions');
    expect(text).toContain('autocapture.pageViews');
  });

  it('mandates the bucket sum equal the approved plan size', () => {
    // The arithmetic invariant is what catches the silent-drop bug:
    // if the Setup Report's bucket totals don't equal the plan size,
    // the agent has hidden work. Lock the equality requirement in.
    expect(text).toContain(
      'sum of events across all three buckets MUST equal the count',
    );
  });
});

/**
 * Scale / safety guardrails added by perf(agent): commandments tightening.
 *
 * Three rules motivated by production dashboard signals:
 *   1. Strategy retry cap (3-approach ceiling) — closes the
 *      completion→activation gap where agents finish nominally but have
 *      looped on broken approaches.
 *   2. Destructive bash pre-emption — Bash Policy denies peaked ~80/day;
 *      naming the always-blocked commands up front avoids a deny + retry.
 *   3. Monorepo scope clamp — large repos saw cross-package edits the user
 *      never asked for; the rule restricts work to the install-dir subtree
 *      by default and forces a confirmation hop for workspace-root runs.
 *
 * These rules are short, load-bearing, and easy to weaken with an
 * innocent-looking copy edit, so the sentinel phrases are pinned here.
 */
describe('scale + safety guardrails commandments', () => {
  const text = getWizardCommandments();

  it('caps strategy retries at 3 distinct approaches per goal', () => {
    expect(text).toContain('Strategy retry cap');
    expect(text).toMatch(/3 different approaches/);
    expect(text).toMatch(/Known limitations/);
  });

  it('pre-empts destructive bash commands by name', () => {
    // The agent should learn about these from the prompt, not by tripping
    // safety-scanner.ts and burning a retry cycle. Each pattern matches a
    // rule in `src/lib/safety-scanner.ts`.
    const blockedShapes = [
      'rm -rf',
      'git reset --hard',
      'git push --force',
      'curl ... | sh',
      'install -g',
      'publish',
      'sudo',
    ];
    for (const shape of blockedShapes) {
      expect(
        text,
        `commandments should pre-empt "${shape}" so the agent never burns a retry discovering it's blocked.`,
      ).toContain(shape);
    }
  });

  it('clamps default scope to the install directory subtree', () => {
    expect(text).toContain('Monorepo scope');
    expect(text).toMatch(/install directory/i);
    // The escalation hop — `wizard_feedback` is how the agent surfaces
    // ambiguity instead of silently fanning out. Naming the tool by id
    // keeps the rule actionable.
    expect(text).toContain('wizard_feedback');
  });
});

describe('pre-flight context commandment', () => {
  const text = getWizardCommandments();

  it('points the agent at the pre-flight block in the first user message', () => {
    // The exact header rendered by `buildPreflightContext` — anchoring on
    // it keeps the rule and the helper in lockstep across copy edits.
    expect(text).toContain('# Pre-flight context');
    expect(text).toMatch(/first user message/i);
  });

  it('explicitly forbids reflexive cold-start probes', () => {
    // The two MCP discovery tools the agent reflexively burned on every
    // run before this commandment. Both must be named — naming only one
    // lets the model rationalize calling the other.
    expect(text).toMatch(
      /Do NOT call `detect_package_manager`, `check_env_keys`/,
    );
    // And the Glob/Read fanout for `package.json` / lockfiles / `.env*`
    // — second-most-common cold-start probe pattern.
    expect(text).toMatch(/package\.json/);
    expect(text).toMatch(/lockfile/i);
    expect(text).toMatch(/\.env/);
  });

  it('keeps the discovery tools available for mid-run verification', () => {
    // We're not removing the tools — only suppressing the start-of-run
    // probe. If the agent genuinely needs to verify a value the user
    // changed mid-run, it should still be allowed to call them. The
    // "remain registered" / "verify a specific value" carve-out is what
    // keeps the rule from breaking edge-case correctness.
    expect(text).toMatch(/remain registered/i);
    expect(text).toMatch(/verify/i);
  });
});
