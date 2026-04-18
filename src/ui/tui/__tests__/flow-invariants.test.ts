/**
 * Property-based tests for the WizardRouter flow state machine.
 *
 * Uses fast-check's command-based model testing to fuzz random sequences
 * of session mutations and verify that the router never violates its
 * invariants.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { WizardRouter, Screen, Overlay, Flow } from '../router.js';
import { FLOWS } from '../flows.js';
import {
  buildSession,
  RunPhase,
  OutroKind,
  type WizardSession,
} from '../../../lib/wizard-session.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** All valid screen values from the Screen enum */
const ALL_SCREENS = new Set(Object.values(Screen));

/** All valid overlay values from the Overlay enum */
const ALL_OVERLAYS = new Set(Object.values(Overlay));

/** All valid screen names (screens + overlays) */
const ALL_SCREEN_NAMES = new Set([...ALL_SCREENS, ...ALL_OVERLAYS]);

/** Screens in the active Wizard flow */
const WIZARD_FLOW_SCREENS = new Set(
  FLOWS[Flow.Wizard].map((entry) => entry.screen),
);

/** Build a mock credentials object */
function mockCredentials() {
  return {
    accessToken: 'test-access-token',
    idToken: 'test-id-token',
    projectApiKey: 'test-api-key',
    host: 'https://api.amplitude.com',
    projectId: 12345,
  };
}

/**
 * Apply a complete authenticated state to a session: credentials plus org
 * and workspace names (the two required by Auth.isComplete). Env name is
 * set too — it's optional for Auth but realistic for a fully-resolved flow.
 */
function applyAuthComplete(s: WizardSession) {
  s.credentials = mockCredentials();
  s.selectedOrgName = 'Acme';
  s.selectedWorkspaceName = 'Amplitude';
  s.selectedEnvName = 'Production';
}

// ── Model + Real system ──────────────────────────────────────────────

/** The "model" is just a description of what we've done — the real session IS the state. */
interface Model {
  /** Track mutation history for debugging */
  mutations: string[];
}

interface Real {
  session: WizardSession;
  router: WizardRouter;
}

// ── Commands ─────────────────────────────────────────────────────────

class ConcludeIntroCommand implements fc.Command<Model, Real> {
  toString() {
    return 'ConcludeIntro';
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    model.mutations.push('introConcluded=true');
    real.session.introConcluded = true;
  }
}

class SetRegionCommand implements fc.Command<Model, Real> {
  constructor(readonly region: 'us' | 'eu') {}
  toString() {
    return `SetRegion(${this.region})`;
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    model.mutations.push(`region=${this.region}, regionForced=false`);
    real.session.region = this.region;
    real.session.regionForced = false;
  }
}

class SetCredentialsCommand implements fc.Command<Model, Real> {
  toString() {
    return 'SetCredentials';
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    model.mutations.push('credentials=mock');
    applyAuthComplete(real.session);
  }
}

class SetProjectHasDataCommand implements fc.Command<Model, Real> {
  constructor(
    readonly hasData: boolean,
    readonly activationLevel: 'none' | 'partial' | 'full',
  ) {}
  toString() {
    return `SetProjectHasData(${this.hasData}, ${this.activationLevel})`;
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    model.mutations.push(
      `projectHasData=${this.hasData}, activationLevel=${this.activationLevel}`,
    );
    real.session.projectHasData = this.hasData;
    real.session.activationLevel = this.activationLevel;
  }
}

class SetRunPhaseCommand implements fc.Command<Model, Real> {
  constructor(readonly phase: RunPhase) {}
  toString() {
    return `SetRunPhase(${this.phase})`;
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    model.mutations.push(`runPhase=${this.phase}`);
    real.session.runPhase = this.phase;
  }
}

class SetMcpCompleteCommand implements fc.Command<Model, Real> {
  toString() {
    return 'SetMcpComplete';
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    model.mutations.push('mcpComplete=true');
    real.session.mcpComplete = true;
  }
}

class SetDataIngestionConfirmedCommand implements fc.Command<Model, Real> {
  toString() {
    return 'SetDataIngestionConfirmed';
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    model.mutations.push('dataIngestionConfirmed=true');
    real.session.dataIngestionConfirmed = true;
  }
}

class SetSlackCompleteCommand implements fc.Command<Model, Real> {
  toString() {
    return 'SetSlackComplete';
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    model.mutations.push('slackComplete=true');
    real.session.slackComplete = true;
  }
}

class CancelCommand implements fc.Command<Model, Real> {
  toString() {
    return 'Cancel';
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    model.mutations.push('outroData=Cancel');
    real.session.outroData = { kind: OutroKind.Cancel, message: 'test' };
  }
}

class AssertInvariantsCommand implements fc.Command<Model, Real> {
  toString() {
    return 'AssertInvariants';
  }
  check() {
    return true;
  }
  run(model: Model, real: Real) {
    const { session, router } = real;

    // 1. resolve() never throws
    let resolved: ReturnType<typeof router.resolve>;
    expect(() => {
      resolved = router.resolve(session);
    }).not.toThrow();
    resolved = router.resolve(session);

    // 2. resolve() always returns a valid Screen or Overlay value
    expect(ALL_SCREEN_NAMES.has(resolved as Screen | Overlay)).toBe(true);

    // 3. If runPhase === Error, never resolve to Mcp, DataIngestionCheck, or Slack
    if (session.runPhase === RunPhase.Error) {
      const errorForbidden = new Set([
        Screen.Mcp,
        Screen.DataIngestionCheck,
        Screen.Slack,
      ]);
      expect(
        errorForbidden.has(resolved as Screen),
        `RunPhase.Error should not resolve to ${resolved}, mutations: [${model.mutations.join(
          ', ',
        )}]`,
      ).toBe(false);
    }

    // 4. If credentials === null, introConcluded === true, region !== null,
    //    and runPhase !== Error, the resolved screen should be Auth
    if (
      session.credentials === null &&
      session.introConcluded === true &&
      session.region !== null &&
      !session.regionForced &&
      session.runPhase !== RunPhase.Error &&
      session.outroData?.kind !== OutroKind.Cancel
    ) {
      expect(
        resolved,
        `Expected Auth when no credentials, intro done, region set. Mutations: [${model.mutations.join(
          ', ',
        )}]`,
      ).toBe(Screen.Auth);
    }

    // 5. If outroData.kind === Cancel, resolved screen is always Outro
    if (session.outroData?.kind === OutroKind.Cancel) {
      expect(
        resolved,
        `Cancel should always resolve to Outro. Mutations: [${model.mutations.join(
          ', ',
        )}]`,
      ).toBe(Screen.Outro);
    }

    // 6. The resolved screen is always one of the screens in the active flow
    //    (unless an overlay is active)
    if (!router.hasOverlay && session.outroData?.kind !== OutroKind.Cancel) {
      expect(
        WIZARD_FLOW_SCREENS.has(resolved as Screen),
        `Resolved screen ${resolved} is not in the Wizard flow. Mutations: [${model.mutations.join(
          ', ',
        )}]`,
      ).toBe(true);
    }
  }
}

// ── Command arbitraries ──────────────────────────────────────────────

const allCommands = [
  fc.constant(new ConcludeIntroCommand()),
  fc
    .constantFrom('us' as const, 'eu' as const)
    .map((r) => new SetRegionCommand(r)),
  fc.constant(new SetCredentialsCommand()),
  fc
    .record({
      hasData: fc.boolean(),
      level: fc.constantFrom(
        'none' as const,
        'partial' as const,
        'full' as const,
      ),
    })
    .map((r) => new SetProjectHasDataCommand(r.hasData, r.level)),
  fc
    .constantFrom(
      RunPhase.Idle,
      RunPhase.Running,
      RunPhase.Completed,
      RunPhase.Error,
    )
    .map((p) => new SetRunPhaseCommand(p)),
  fc.constant(new SetMcpCompleteCommand()),
  fc.constant(new SetDataIngestionConfirmedCommand()),
  fc.constant(new SetSlackCompleteCommand()),
  fc.constant(new CancelCommand()),
  fc.constant(new AssertInvariantsCommand()),
];

// ── Property-based tests ─────────────────────────────────────────────

describe('WizardRouter flow invariants (property-based)', () => {
  it('holds invariants under random state mutations', () => {
    fc.assert(
      fc.property(fc.commands(allCommands, { size: '+1' }), (cmds) => {
        const setup = () => ({
          model: { mutations: [] as string[] },
          real: {
            session: buildSession({}),
            router: new WizardRouter(Flow.Wizard),
          },
        });
        fc.modelRun(setup, cmds);
      }),
      { numRuns: 500 },
    );
  });
});

// ── Parameterized happy path ─────────────────────────────────────────

describe('WizardRouter happy path transitions', () => {
  function freshSession(): WizardSession {
    return buildSession({});
  }

  it.each([
    {
      state: 'fresh session',
      mutate: (_s: WizardSession) => {},
      expected: Screen.Intro,
    },
    {
      state: 'after intro concluded',
      mutate: (s: WizardSession) => {
        s.introConcluded = true;
      },
      expected: Screen.RegionSelect,
    },
    {
      state: 'after region set',
      mutate: (s: WizardSession) => {
        s.introConcluded = true;
        s.region = 'us';
      },
      expected: Screen.Auth,
    },
    {
      state: 'after auth complete',
      mutate: (s: WizardSession) => {
        s.introConcluded = true;
        s.region = 'us';
        applyAuthComplete(s);
      },
      expected: Screen.DataSetup,
    },
    {
      state: 'after data setup (no data)',
      mutate: (s: WizardSession) => {
        s.introConcluded = true;
        s.region = 'us';
        applyAuthComplete(s);
        s.projectHasData = false;
        s.activationLevel = 'none';
      },
      expected: Screen.Run,
    },
    {
      state: 'after run completed',
      mutate: (s: WizardSession) => {
        s.introConcluded = true;
        s.region = 'us';
        applyAuthComplete(s);
        s.projectHasData = false;
        s.activationLevel = 'none';
        s.runPhase = RunPhase.Completed;
      },
      expected: Screen.Mcp,
    },
    {
      state: 'after MCP complete',
      mutate: (s: WizardSession) => {
        s.introConcluded = true;
        s.region = 'us';
        applyAuthComplete(s);
        s.projectHasData = false;
        s.activationLevel = 'none';
        s.runPhase = RunPhase.Completed;
        s.mcpComplete = true;
      },
      expected: Screen.DataIngestionCheck,
    },
    {
      state: 'after data ingestion confirmed',
      mutate: (s: WizardSession) => {
        s.introConcluded = true;
        s.region = 'us';
        applyAuthComplete(s);
        s.projectHasData = false;
        s.activationLevel = 'none';
        s.runPhase = RunPhase.Completed;
        s.mcpComplete = true;
        s.dataIngestionConfirmed = true;
      },
      expected: Screen.Slack,
    },
    {
      state: 'after slack complete',
      mutate: (s: WizardSession) => {
        s.introConcluded = true;
        s.region = 'us';
        applyAuthComplete(s);
        s.projectHasData = false;
        s.activationLevel = 'none';
        s.runPhase = RunPhase.Completed;
        s.mcpComplete = true;
        s.dataIngestionConfirmed = true;
        s.slackComplete = true;
      },
      expected: Screen.Outro,
    },
  ])('resolves to $expected when $state', ({ mutate, expected }) => {
    const session = freshSession();
    const router = new WizardRouter(Flow.Wizard);
    mutate(session);
    expect(router.resolve(session)).toBe(expected);
  });
});

// ── Complete happy path ──────────────────────────────────────────────

describe('WizardRouter complete happy path', () => {
  it('reaches Outro after all steps complete', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.projectHasData = false;
    session.activationLevel = 'none';
    session.runPhase = RunPhase.Completed;
    session.mcpComplete = true;
    session.dataIngestionConfirmed = true;
    session.checklistComplete = true;
    session.slackComplete = true;

    expect(router.resolve(session)).toBe(Screen.Outro);
  });

  it('reaches Outro on error path (skips post-run screens)', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.projectHasData = false;
    session.activationLevel = 'none';
    session.runPhase = RunPhase.Error;
    // MCP, DataIngestionCheck, Slack are all skipped on error

    expect(router.resolve(session)).toBe(Screen.Outro);
  });

  it('full activation skips Run, DataIngestionCheck but shows Mcp', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.projectHasData = true;
    session.activationLevel = 'full';
    // Run is skipped for full activation
    // runPhase stays Idle (no agent run needed)

    expect(router.resolve(session)).toBe(Screen.Mcp);
  });
});

// ── Overlay tests ────────────────────────────────────────────────────

describe('WizardRouter overlay behavior', () => {
  it('overlay takes priority over flow screen', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    // Without overlay, should show Intro
    expect(router.resolve(session)).toBe(Screen.Intro);

    // Push an overlay — it should take priority
    router.pushOverlay(Overlay.Outage);
    expect(router.resolve(session)).toBe(Overlay.Outage);
  });

  it('resumes flow after overlay pop', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    // Advance past intro
    session.introConcluded = true;
    expect(router.resolve(session)).toBe(Screen.RegionSelect);

    // Push and pop overlay
    router.pushOverlay(Overlay.SettingsOverride);
    expect(router.resolve(session)).toBe(Overlay.SettingsOverride);

    router.popOverlay();
    expect(router.resolve(session)).toBe(Screen.RegionSelect);
  });

  it('stacks overlays — last pushed is active', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    router.pushOverlay(Overlay.Outage);
    router.pushOverlay(Overlay.Snake);

    expect(router.resolve(session)).toBe(Overlay.Snake);

    router.popOverlay();
    expect(router.resolve(session)).toBe(Overlay.Outage);

    router.popOverlay();
    expect(router.resolve(session)).toBe(Screen.Intro);
  });

  it('cancel still resolves to Outro even with overlay popped', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    session.outroData = { kind: OutroKind.Cancel, message: 'user cancelled' };

    // Without overlay, cancel goes to Outro
    expect(router.resolve(session)).toBe(Screen.Outro);
  });

  it('overlay overrides cancel route while active', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    session.outroData = { kind: OutroKind.Cancel, message: 'user cancelled' };
    router.pushOverlay(Overlay.Logout);

    // Overlay wins over cancel
    expect(router.resolve(session)).toBe(Overlay.Logout);

    // After pop, cancel kicks in
    router.popOverlay();
    expect(router.resolve(session)).toBe(Screen.Outro);
  });
});

// ── Error phase invariants ───────────────────────────────────────────

describe('WizardRouter error phase routing', () => {
  it('error phase skips Auth and goes directly to Outro', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    session.introConcluded = true;
    session.region = 'us';
    // credentials null + runPhase Error means Auth is skipped (show returns false)
    session.runPhase = RunPhase.Error;

    // Auth is hidden on error, DataSetup is next
    // projectHasData null means DataSetup shows but isn't complete
    // Let's complete everything up to the error-skipped screens
    applyAuthComplete(session);
    session.projectHasData = false;
    session.activationLevel = 'none';

    // Run shows (activationLevel !== full) and is complete (phase === Error)
    // Mcp is hidden (runPhase === Error)
    // DataIngestionCheck is hidden (runPhase === Error)
    // Slack is hidden (runPhase === Error)
    // So we land on Outro
    expect(router.resolve(session)).toBe(Screen.Outro);
  });

  it.each([Screen.Mcp, Screen.DataIngestionCheck, Screen.Slack])(
    'never resolves to %s when runPhase is Error',
    (forbiddenScreen) => {
      const session = buildSession({});
      const router = new WizardRouter(Flow.Wizard);

      // Try many combinations — none should yield the forbidden screen
      const phases = [RunPhase.Error];
      const booleans = [true, false];
      const activations = ['none', 'partial', 'full'] as const;

      for (const phase of phases) {
        for (const introConcluded of booleans) {
          for (const hasRegion of booleans) {
            for (const hasCreds of booleans) {
              for (const hasData of [true, false, null]) {
                for (const activation of activations) {
                  for (const mcpDone of booleans) {
                    session.runPhase = phase;
                    session.introConcluded = introConcluded;
                    session.region = hasRegion ? 'us' : null;
                    session.regionForced = false;
                    session.credentials = hasCreds ? mockCredentials() : null;
                    session.projectHasData = hasData;
                    session.activationLevel =
                      hasData === null ? null : activation;
                    session.mcpComplete = mcpDone;
                    session.dataIngestionConfirmed = false;
                    session.slackComplete = false;
                    session.outroData = null;

                    const result = router.resolve(session);
                    expect(
                      result,
                      `Error phase resolved to ${forbiddenScreen} with introConcluded=${introConcluded}, region=${hasRegion}, creds=${hasCreds}, data=${hasData}, activation=${activation}, mcp=${mcpDone}`,
                    ).not.toBe(forbiddenScreen);
                  }
                }
              }
            }
          }
        }
      }
    },
  );
});
