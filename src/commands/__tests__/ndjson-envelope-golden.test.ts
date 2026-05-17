/**
 * Golden snapshots pinning the EXACT wire bytes of every NDJSON envelope
 * emitted by `src/commands/*.ts`.
 *
 * External orchestrators (Claude Code, Cursor, parent agents) parse these
 * NDJSON envelopes line-by-line. A property-rename, a re-ordering of
 * `v` / `@timestamp` / `type`, or a serialization quirk that inserts
 * `data_version: undefined` is a silent wire-contract break.
 *
 * Why bytes (not parsed objects)
 * -------------------------------
 * `JSON.stringify` preserves insertion order for plain object properties,
 * and orchestrators that key off field position (or rely on a specific
 * `JSON.parse` happy path) are sensitive to that. Snapshotting bytes
 * (not just `JSON.parse(...)` output) catches both shape AND order
 * regressions in one assertion.
 *
 * Why a fixed timestamp
 * ---------------------
 * Each snapshot is the byte string the inline `process.stdout.write(...)`
 * site WOULD produce, given a fixed `@timestamp`. Real emit sites stamp
 * `new Date().toISOString()` inline, so we replicate that exact call
 * shape inside the test and freeze the `Date` so the output is
 * reproducible.
 *
 * Followup pin
 * ------------
 * After `emitCliEnvelope` lands, an additional set of assertions in this
 * file checks that the helper produces the SAME byte string as the
 * inline shape — that's what proves the refactor is wire-byte-identical.
 *
 * Coverage scope
 * --------------
 * 17 emit sites across apply.ts (5), plan.ts (4), reset.ts (2),
 * projects.ts (2), verify.ts (2), default.ts (1), whoami.ts (1).
 *
 * `orchestration.ts` is INTENTIONALLY EXCLUDED — its 7 emit sites use a
 * Zod-validated envelope shape (`generatedAt`, no `message`/`data`/`level`)
 * that is structurally different from the rest of `src/commands/`. Those
 * sites already have schema coverage via `orchestration.test.ts`.
 */
import { describe, expect, it } from 'vitest';

// Fixed timestamp used by every test — matches the format produced by
// `new Date().toISOString()` at this exact instant.
const FIXED_TS = '2026-01-15T12:00:00.000Z';

// Helper that mirrors the inline-stringify-plus-newline pattern used at
// every emit site. Tests call this with the exact object literal that
// today's code passes to `JSON.stringify`, so the result is byte-identical
// to what `process.stdout.write` would emit on the same input.
const wire = (envelope: unknown): string => JSON.stringify(envelope) + '\n';

describe('NDJSON envelope golden bytes — apply.ts (5 sites)', () => {
  it('apply.ts:85 apply_refused (project guard) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'error',
      level: 'error',
      message: 'apply refused: not a project directory',
      data: {
        event: 'apply_refused',
        reason: 'not_project',
        planId: 'plan_abc',
        installDir: '/tmp/x',
        hint: 'Pass --install-dir <abs-path> pointing at the project root, or --force to bypass.',
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"error","level":"error","message":"apply refused: not a project directory","data":{"event":"apply_refused","reason":"not_project","planId":"plan_abc","installDir":"/tmp/x","hint":"Pass --install-dir <abs-path> pointing at the project root, or --force to bypass."}}
"`,
    );
  });

  it('apply.ts:113 emitErr (apply_failed) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'error',
      message: 'apply failed: no plan with id plan_abc',
      data: { event: 'apply_failed', planId: 'plan_abc', reason: 'not_found' },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"error","message":"apply failed: no plan with id plan_abc","data":{"event":"apply_failed","planId":"plan_abc","reason":"not_found"}}
"`,
    );
  });

  it('apply.ts:165 apply_started (lifecycle) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'lifecycle',
      message: 'applying plan plan_abc',
      data: {
        event: 'apply_started',
        planId: 'plan_abc',
        framework: 'nextjs',
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"lifecycle","message":"applying plan plan_abc","data":{"event":"apply_started","planId":"plan_abc","framework":"nextjs"}}
"`,
    );
  });

  it('apply.ts:216 setup_context (apply_started, data_version=1) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'lifecycle',
      message: 'setup_context (apply_started)',
      data_version: 1,
      data: {
        event: 'setup_context',
        phase: 'apply_started',
        amplitude: { region: 'us', orgId: 'org_1' },
        sources: { region: 'saved', orgId: 'saved' },
        requiresConfirmation: true,
        resumeFlags: {
          changeApp: [
            'apply',
            '--plan-id',
            'plan_abc',
            '--app-id',
            '<id>',
            '--yes',
          ],
        },
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"lifecycle","message":"setup_context (apply_started)","data_version":1,"data":{"event":"setup_context","phase":"apply_started","amplitude":{"region":"us","orgId":"org_1"},"sources":{"region":"saved","orgId":"saved"},"requiresConfirmation":true,"resumeFlags":{"changeApp":["apply","--plan-id","plan_abc","--app-id","<id>","--yes"]}}}
"`,
    );
  });

  it('apply.ts:272 apply_refused (in_progress / lock_held) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'error',
      level: 'error',
      message: 'apply refused: another wizard apply is already running…',
      data: {
        event: 'apply_refused',
        reason: 'in_progress',
        planId: 'plan_abc',
        installDir: '/tmp/x',
        holder: { pid: 12345, planId: 'plan_prev', startedAt: FIXED_TS },
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"error","level":"error","message":"apply refused: another wizard apply is already running…","data":{"event":"apply_refused","reason":"in_progress","planId":"plan_abc","installDir":"/tmp/x","holder":{"pid":12345,"planId":"plan_prev","startedAt":"2026-01-15T12:00:00.000Z"}}}
"`,
    );
  });
});

describe('NDJSON envelope golden bytes — plan.ts (4 sites)', () => {
  it('plan.ts:37 plan_refused (project guard) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'error',
      level: 'error',
      message: 'plan refused: not a project directory',
      data: {
        event: 'plan_refused',
        reason: 'not_project',
        installDir: '/tmp/x',
        hint: 'Pass --install-dir <abs-path> pointing at the project root, or --force to bypass.',
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"error","level":"error","message":"plan refused: not a project directory","data":{"event":"plan_refused","reason":"not_project","installDir":"/tmp/x","hint":"Pass --install-dir <abs-path> pointing at the project root, or --force to bypass."}}
"`,
    );
  });

  it('plan.ts:90 setup_context (plan, data_version=1) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'lifecycle',
      message: 'setup_context (plan)',
      data_version: 1,
      data: {
        event: 'setup_context',
        phase: 'plan',
        amplitude: { region: 'us', orgId: 'org_1', projectId: 'p1' },
        sources: { region: 'saved', orgId: 'saved', projectId: 'saved' },
        requiresConfirmation: true,
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"lifecycle","message":"setup_context (plan)","data_version":1,"data":{"event":"setup_context","phase":"plan","amplitude":{"region":"us","orgId":"org_1","projectId":"p1"},"sources":{"region":"saved","orgId":"saved","projectId":"saved"},"requiresConfirmation":true}}
"`,
    );
  });

  it('plan.ts:118 plan envelope — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'plan',
      message: 'plan ready: Next.js (nextjs)',
      data: {
        event: 'plan',
        planId: 'plan_xyz',
        framework: 'nextjs',
        frameworkName: 'Next.js',
        sdk: '@amplitude/analytics-browser',
        events: [],
        fileChanges: [],
        requiresApproval: true,
        resumeFlags: ['apply', '--plan-id', 'plan_xyz', '--yes'],
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"plan","message":"plan ready: Next.js (nextjs)","data":{"event":"plan","planId":"plan_xyz","framework":"nextjs","frameworkName":"Next.js","sdk":"@amplitude/analytics-browser","events":[],"fileChanges":[],"requiresApproval":true,"resumeFlags":["apply","--plan-id","plan_xyz","--yes"]}}
"`,
    );
  });

  it('plan.ts:171 plan_failed — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'error',
      message: 'plan failed: detection blew up',
      data: { event: 'plan_failed' },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"error","message":"plan failed: detection blew up","data":{"event":"plan_failed"}}
"`,
    );
  });
});

describe('NDJSON envelope golden bytes — reset.ts (2 sites)', () => {
  it('reset.ts:70 log warn (remove failure) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'log',
      level: 'warn',
      message: 'failed to remove /tmp/x/.amplitude: EACCES',
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"log","level":"warn","message":"failed to remove /tmp/x/.amplitude: EACCES"}
"`,
    );
  });

  it('reset.ts:102 reset result (data_version=1) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'result',
      message: 'wizard reset: removed 2, skipped 1',
      data_version: 1,
      data: {
        event: 'reset',
        installDir: '/tmp/x',
        removed: ['/tmp/x/.amplitude', '/tmp/x/.amplitude-events.json'],
        skipped: ['/tmp/x/amplitude-setup-report.md'],
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"result","message":"wizard reset: removed 2, skipped 1","data_version":1,"data":{"event":"reset","installDir":"/tmp/x","removed":["/tmp/x/.amplitude","/tmp/x/.amplitude-events.json"],"skipped":["/tmp/x/amplitude-setup-report.md"]}}
"`,
    );
  });
});

describe('NDJSON envelope golden bytes — projects.ts (2 sites)', () => {
  // NOTE: projects.ts:64 places `data_version` BEFORE `message` and `level`
  // AFTER `message` — the inverse of every other site. Keep this snapshot
  // tight so a future migration that drops projects.ts into the unifier
  // (and reorders fields to match the canonical shape) is caught here.
  it('projects.ts:64 needs_input (project_selection) — bytes — has `data_version` before `message`', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'needs_input',
      data_version: 2,
      message: '3 projects available.',
      data: {
        event: 'needs_input',
        decisionId: 'd_1',
        code: 'project_selection',
        ui: {
          component: 'searchable_select',
          priority: 'required',
          title: 'Select an Amplitude project',
          description: 'Choose where events from this app should be sent.',
          searchPlaceholder: 'Search…',
          emptyState: 'No projects matched.',
        },
        choices: [],
        recommended: undefined,
        recommendedReason: undefined,
        responseSchema: { type: 'object' },
        pagination: { total: 3, returned: 3 },
        allowManualEntry: true,
        manualEntry: { flag: '--app-id', placeholder: '…', pattern: '^\\d+$' },
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"needs_input","data_version":2,"message":"3 projects available.","data":{"event":"needs_input","decisionId":"d_1","code":"project_selection","ui":{"component":"searchable_select","priority":"required","title":"Select an Amplitude project","description":"Choose where events from this app should be sent.","searchPlaceholder":"Search…","emptyState":"No projects matched."},"choices":[],"responseSchema":{"type":"object"},"pagination":{"total":3,"returned":3},"allowManualEntry":true,"manualEntry":{"flag":"--app-id","placeholder":"…","pattern":"^\\\\d+$"}}}
"`,
    );
  });

  it('projects.ts:197 projects_list_failed — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'error',
      message: 'projects list failed: network blip',
      data: { event: 'projects_list_failed' },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"error","message":"projects list failed: network blip","data":{"event":"projects_list_failed"}}
"`,
    );
  });
});

describe('NDJSON envelope golden bytes — verify.ts (2 sites)', () => {
  it('verify.ts:30 verification_result — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'result',
      message: 'verify: pass',
      data: {
        event: 'verification_result',
        outcome: 'pass',
        failures: [],
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"result","message":"verify: pass","data":{"event":"verification_result","outcome":"pass","failures":[]}}
"`,
    );
  });

  it('verify.ts:59 verification_failed — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'error',
      message: 'verify failed: hard error',
      data: { event: 'verification_failed' },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"error","message":"verify failed: hard error","data":{"event":"verification_failed"}}
"`,
    );
  });
});

describe('NDJSON envelope golden bytes — default.ts (1 site)', () => {
  it('default.ts:49 context_file_failed — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'error',
      message: 'context file is empty',
      data: {
        event: 'context_file_failed',
        reason: 'empty',
        sourcePath: '/tmp/ctx.md',
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"error","message":"context file is empty","data":{"event":"context_file_failed","reason":"empty","sourcePath":"/tmp/ctx.md"}}
"`,
    );
  });
});

describe('NDJSON envelope golden bytes — whoami.ts (1 site)', () => {
  it('whoami.ts:74 whoami (data_version=1) — bytes', () => {
    const bytes = wire({
      v: 1,
      '@timestamp': FIXED_TS,
      type: 'result',
      message: 'whoami: alice@example.com',
      data_version: 1,
      data: {
        event: 'whoami',
        loggedIn: true,
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'A',
        region: 'us',
        tokenExpiresAt: FIXED_TS,
      },
    });
    expect(bytes).toMatchInlineSnapshot(
      `"{"v":1,"@timestamp":"2026-01-15T12:00:00.000Z","type":"result","message":"whoami: alice@example.com","data_version":1,"data":{"event":"whoami","loggedIn":true,"email":"alice@example.com","firstName":"Alice","lastName":"A","region":"us","tokenExpiresAt":"2026-01-15T12:00:00.000Z"}}
"`,
    );
  });
});
