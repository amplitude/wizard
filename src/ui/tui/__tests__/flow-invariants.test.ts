/**
 * Property-based tests for the WizardRouter flow state machine.
 *
 * Uses fast-check's command-based model testing to fuzz random sequences
 * of session mutations and verify that the router never violates its
 * invariants.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Stub disk-backed zone signals so property tests don't pick up the
// developer's real auth / ampli config. The Wizard flow's RegionSelect gate
// uses `tryResolveZone`, which reads ampli config + stored user as Tier
// 2/3 — without these mocks, sessions with `region: null` would still
// resolve to a non-null zone via disk and skip RegionSelect.
vi.mock('../../../utils/ampli-settings.js', () => ({
  getStoredUser: vi.fn(() => undefined),
}));
vi.mock('../../../lib/ampli-config.js', () => ({
  readAmpliConfig: vi.fn(() => ({ ok: false, error: 'not_found' })),
}));

import { WizardRouter, Screen, Overlay, Flow } from '../router.js';
import { FLOWS, requiresSignupField, type SignupField } from '../flows.js';
import {
  buildSession,
  RunPhase,
  OutroKind,
  type WizardSession,
} from '../../../lib/wizard-session.js';
import { KNOWN_REQUIRED_KEYS } from '../../../utils/direct-signup.js';

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
    appId: 12345,
  };
}

/**
 * Apply a complete authenticated state to a session: credentials plus org
 * and project names (the two required by Auth.isComplete). Env name is
 * set too — it's optional for Auth but realistic for a fully-resolved flow.
 */
function applyAuthComplete(s: WizardSession) {
  s.credentials = mockCredentials();
  s.selectedOrgName = 'Acme';
  s.selectedProjectName = 'Amplitude';
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

  it('locally-fully-wired re-runs skip Run but STILL show DataIngestionCheck', () => {
    // Activation Check pre-flight: when all four local signals are present
    // (SDK dep, source import, ampli.json scope, event plan on disk), the
    // wizard short-circuits past Setup + Run by setting `activationLevel:
    // 'full'` AND `localInstrumentationComplete: true`. The SECOND flag is
    // what keeps DataIngestionCheck running — without it, a user who
    // re-runs pre-deploy (no remote events yet) would silently skip the
    // ingestion verification UX. With both set, they land on
    // DataIngestionCheck after Mcp, which is the correct UX.
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.projectHasData = true;
    session.activationLevel = 'full';
    session.localInstrumentationComplete = true;
    session.mcpComplete = true; // walk past Mcp to land on the next entry

    expect(router.resolve(session)).toBe(Screen.DataIngestionCheck);
  });

  it('remote-confirmed full activation still skips DataIngestionCheck (no localInstrumentationComplete)', () => {
    // Counter-case: when activation reaches 'full' via the API check
    // (50+ events in the project) and NOT via the local pre-flight,
    // localInstrumentationComplete stays false. DataIngestionCheck must
    // still be skipped — events are already flowing, no need to poll.
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.projectHasData = true;
    session.activationLevel = 'full';
    session.localInstrumentationComplete = false;
    session.mcpComplete = true;

    expect(router.resolve(session)).toBe(Screen.Slack);
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
    router.pushOverlay(Overlay.Outage);
    expect(router.resolve(session)).toBe(Overlay.Outage);

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

// ── Additional invariants beyond the original 22 ─────────────────────
//
// These cover scenarios that have actually broken in production reviews
// of the router pipeline.

describe('WizardRouter additional invariants', () => {
  function freshSession(): WizardSession {
    return buildSession({});
  }

  it('Intro is the only screen reachable from a totally fresh session', () => {
    // Strong invariant: regardless of what flow we instantiate, a
    // freshly-built session that has not concluded intro must land on
    // either Intro (Wizard flow) or the flow's own first screen — never
    // some random downstream screen due to a misconfigured isComplete.
    const session = freshSession();
    expect(session.introConcluded).toBe(false);
    expect(session.credentials).toBeNull();

    const wizardRouter = new WizardRouter(Flow.Wizard);
    expect(wizardRouter.resolve(session)).toBe(Screen.Intro);

    // Sub-flows skip Intro because their show predicates don't gate on it.
    const mcpAdd = new WizardRouter(Flow.McpAdd);
    expect(mcpAdd.resolve(session)).toBe(Screen.McpAdd);
  });

  it('cancel resolves to Outro from any flow position before introConcluded', () => {
    // The router has a cancel fast-path. Verify it works even when the
    // user cancels at the very first screen — common for users who launch
    // the wizard accidentally.
    const session = freshSession();
    session.outroData = { kind: OutroKind.Cancel, message: 'Setup cancelled.' };
    const router = new WizardRouter(Flow.Wizard);
    expect(router.resolve(session)).toBe(Screen.Outro);
  });

  it('createProject.pending=true takes precedence over a fully-authenticated session', () => {
    // Edge case: user finishes auth, then triggers /create-project. The
    // router should switch to CreateProject even though Auth.isComplete
    // is satisfied.
    const session = freshSession();
    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.createProject = {
      pending: true,
      source: 'slash',
      suggestedName: null,
    };
    const router = new WizardRouter(Flow.Wizard);
    expect(router.resolve(session)).toBe(Screen.CreateProject);
  });

  it('a force-region request re-shows RegionSelect even when region is already set', () => {
    const session = freshSession();
    session.introConcluded = true;
    session.region = 'eu';
    session.regionForced = true;
    const router = new WizardRouter(Flow.Wizard);
    expect(router.resolve(session)).toBe(Screen.RegionSelect);
  });

  it('returning users skip RegionSelect when zone is resolvable from disk', async () => {
    // Regression: after `wizard login`, ~/.ampli.json has the stored
    // user's zone but session.region stays null (it represents *this
    // run's* user intent). tryResolveZone reads disk Tier 2/3, so the
    // gate must use it — not session.region — to skip RegionSelect.
    const { getStoredUser } = await import('../../../utils/ampli-settings.js');
    vi.mocked(getStoredUser).mockReturnValueOnce({
      id: 'user-123',
      email: 'returning@example.com',
      firstName: 'R',
      lastName: 'U',
      zone: 'eu',
    });
    const session = freshSession();
    session.introConcluded = true;
    // session.region stays null — disk zone alone is enough.
    const router = new WizardRouter(Flow.Wizard);
    expect(router.resolve(session)).not.toBe(Screen.RegionSelect);
  });

  it('full activation always lands on Mcp before Outro (no skipping post-run setup)', () => {
    // Regression target: a previous version of the flow accidentally let
    // full-activation users skip MCP entirely, depriving them of Claude
    // Code integration.
    const session = freshSession();
    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.projectHasData = true;
    session.activationLevel = 'full';
    const router = new WizardRouter(Flow.Wizard);
    expect(router.resolve(session)).toBe(Screen.Mcp);
  });

  it('partial activation routes to ActivationOptions before Run', () => {
    // ActivationOptions is the only screen that exists for partial
    // activation. Ensure it sits between DataSetup and Setup/Run.
    const session = freshSession();
    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.projectHasData = false;
    session.activationLevel = 'partial';
    const router = new WizardRouter(Flow.Wizard);
    expect(router.resolve(session)).toBe(Screen.ActivationOptions);
  });

  it('Slack always follows DataIngestionCheck on the success path', () => {
    // Ordering invariant: post-run is always Mcp → DataIngestionCheck →
    // Slack → Outro. If any new screen ever sneaks between
    // DataIngestionCheck and Slack we want the test suite to catch it.
    const session = freshSession();
    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.projectHasData = false;
    session.activationLevel = 'none';
    session.runPhase = RunPhase.Completed;
    session.mcpComplete = true;
    session.dataIngestionConfirmed = true;
    const router = new WizardRouter(Flow.Wizard);
    expect(router.resolve(session)).toBe(Screen.Slack);
  });

  it('isComplete is monotonically advancing on the canonical happy path', () => {
    // Build the canonical happy path one mutation at a time and verify
    // that the resolved screen index never decreases.
    const session = freshSession();
    const router = new WizardRouter(Flow.Wizard);
    const flowOrder = FLOWS[Flow.Wizard].map((entry) => entry.screen);
    const indexOf = (s: Screen): number => flowOrder.indexOf(s);

    let lastIndex = -1;
    const checkpoint = (): void => {
      const screen = router.resolve(session) as Screen;
      const idx = indexOf(screen);
      // Every screen the resolver returns must exist in the flow.
      expect(idx).toBeGreaterThanOrEqual(0);
      // And the index must never go backward.
      expect(idx).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = idx;
    };

    checkpoint(); // Intro
    session.introConcluded = true;
    checkpoint(); // RegionSelect
    session.region = 'us';
    checkpoint(); // Auth
    applyAuthComplete(session);
    checkpoint(); // DataSetup
    session.projectHasData = false;
    session.activationLevel = 'none';
    checkpoint(); // Run
    session.runPhase = RunPhase.Completed;
    checkpoint(); // Mcp
    session.mcpComplete = true;
    checkpoint(); // DataIngestionCheck
    session.dataIngestionConfirmed = true;
    checkpoint(); // Slack
    session.slackComplete = true;
    checkpoint(); // Outro
  });

  it('property: any sequence of overlay push/pop ends in a deterministic top screen', () => {
    // Push and pop a random sequence of overlays — the resolved screen
    // should always equal either the topmost overlay or the underlying
    // flow screen, with no ghosts left over.
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('push' as const, 'pop' as const),
            fc.constantFrom(
              Overlay.Outage,
              Overlay.Snake,
              Overlay.Mcp,
              Overlay.Slack,
              Overlay.Logout,
              Overlay.Login,
            ),
          ),
          { minLength: 0, maxLength: 30 },
        ),
        (ops) => {
          const router = new WizardRouter(Flow.Wizard);
          const stack: Overlay[] = [];

          for (const [op, overlay] of ops) {
            if (op === 'push') {
              router.pushOverlay(overlay);
              stack.push(overlay);
            } else {
              router.popOverlay();
              stack.pop();
            }
          }

          const resolved = router.resolve(buildSession({}));
          if (stack.length > 0) {
            expect(resolved).toBe(stack[stack.length - 1]);
          } else {
            // Empty stack — should land on the base flow's first screen.
            expect(resolved).toBe(Screen.Intro);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('property: setRegion always satisfies the RegionSelect.isComplete predicate', () => {
    // The RegionSelect entry's isComplete predicate is the canonical
    // gate. Calling setRegion must make it pass for every region value.
    fc.assert(
      fc.property(fc.constantFrom('us' as const, 'eu' as const), (region) => {
        const session = buildSession({});
        session.introConcluded = true;
        session.region = region;
        session.regionForced = false;
        const router = new WizardRouter(Flow.Wizard);
        expect(router.resolve(session)).not.toBe(Screen.RegionSelect);
      }),
      { numRuns: 50 },
    );
  });

  it('Outro is always reachable — the wizard never wedges on a non-terminal screen', () => {
    // Take 100 random sessions and check that adding outroData=Cancel
    // always resolves to Outro, no matter what other state is set.
    fc.assert(
      fc.property(
        fc.record({
          introConcluded: fc.boolean(),
          regionSet: fc.boolean(),
          credsSet: fc.boolean(),
          mcpComplete: fc.boolean(),
          activation: fc.constantFrom(
            'none' as const,
            'partial' as const,
            'full' as const,
          ),
        }),
        (s) => {
          const session = buildSession({});
          session.introConcluded = s.introConcluded;
          session.region = s.regionSet ? 'us' : null;
          if (s.credsSet) applyAuthComplete(session);
          session.mcpComplete = s.mcpComplete;
          session.activationLevel = s.activation;
          session.outroData = { kind: OutroKind.Cancel };
          const router = new WizardRouter(Flow.Wizard);
          expect(router.resolve(session)).toBe(Screen.Outro);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── pendingEnvSelection — env-picker race regression ─────────────────
//
// The bug: a first-run user with 2+ environments lands on a rehydrated
// session that has `credentials`, `selectedOrgName`, `selectedProjectName`
// all populated (from a checkpoint or stored API key). The stepper renders
// frame 1 with `✓ Auth ─ ● Setup ←` because Auth.isComplete is true. Async
// `resolveCredentials` then returns `needs_user_choice/environment_selection`;
// `applyEnvSelectionDeferral` clears credentials AND sets
// `pendingEnvSelection: true`. The router walks forward only, so without
// the flag the user stays parked on Setup with no env-picker surface.
// The flag gates Auth.isComplete AND every post-Auth `show:` predicate so
// the router collapses back to Auth on the next resolve.

describe('WizardRouter pendingEnvSelection rewinds the flow to Auth', () => {
  it('routes a fully-authenticated rehydrated session back to Auth when the flag is set', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    // Simulate the rehydrated rerun state that triggered the bug — all
    // the conditions that normally pass Auth.isComplete are met.
    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    // The flag is the lone reason Auth must win here.
    session.pendingEnvSelection = true;

    expect(router.resolve(session)).toBe(Screen.Auth);
  });

  it('does NOT route to Setup, Run, Mcp, or Outro while pendingEnvSelection is true', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    // Walk session forward as if every downstream gate had already passed.
    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.projectHasData = false;
    session.activationLevel = 'none';
    session.runPhase = RunPhase.Completed;
    session.mcpComplete = true;
    session.dataIngestionConfirmed = true;
    session.slackComplete = true;
    // Even in this fully-walked state, flipping the flag must rewind to Auth.
    session.pendingEnvSelection = true;

    const resolved = router.resolve(session);
    expect(resolved).toBe(Screen.Auth);
    expect(resolved).not.toBe(Screen.Setup);
    expect(resolved).not.toBe(Screen.Run);
    expect(resolved).not.toBe(Screen.Mcp);
    expect(resolved).not.toBe(Screen.DataIngestionCheck);
    expect(resolved).not.toBe(Screen.Slack);
    expect(resolved).not.toBe(Screen.Outro);
  });

  it('clearing the flag lets the flow advance normally', () => {
    const session = buildSession({});
    const router = new WizardRouter(Flow.Wizard);

    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);
    session.pendingEnvSelection = true;

    // Flag set: parked on Auth.
    expect(router.resolve(session)).toBe(Screen.Auth);

    // Flag cleared (simulates AuthScreen finishing setCredentials for the
    // chosen env): the flow advances to DataSetup as it normally would.
    session.pendingEnvSelection = false;

    expect(router.resolve(session)).toBe(Screen.DataSetup);
  });

  it('blocks Auth.isComplete even when credentials + org + project are all set', () => {
    // Direct unit assertion on the gate predicate — the regression bug was
    // that Auth.isComplete returned true on the rehydrated session, which
    // is exactly what this test pins.
    const session = buildSession({});
    session.introConcluded = true;
    session.region = 'us';
    applyAuthComplete(session);

    const authEntry = FLOWS[Flow.Wizard].find((e) => e.screen === Screen.Auth);
    if (!authEntry?.isComplete) {
      throw new Error('Auth entry missing isComplete — test setup error');
    }

    // Baseline: without the flag, Auth.isComplete is true.
    session.pendingEnvSelection = false;
    expect(authEntry.isComplete(session)).toBe(true);

    // With the flag, Auth.isComplete must be false.
    session.pendingEnvSelection = true;
    expect(authEntry.isComplete(session)).toBe(false);
  });
});

// ── Env-picker race: bin.ts ↔ WizardStore session ref divergence ─────
//
// PR #760 added the `pendingEnvSelection` flag and gated every post-Auth
// `show:` predicate on it. The router tests above verify the gate logic.
// But the live bug *still reproduced* after #760 landed: bin.ts mutates
// its `session` object in-place during checkpoint hydration,
// `resolveCredentials`, and `applyEnvSelectionDeferral`, then calls
// `tui.store.session = session` to re-emit. The store internally uses
// nanostores' `map.setKey`, which allocates a fresh
// `{ ...prev, [key]: value }` object on every key change. The first
// in-store setter (typically `concludeIntro` fired when the user
// presses Continue on the checkpoint Resume prompt while
// `resolveCredentials` is still awaiting) detaches `$session.value`
// from the bin.ts `session` reference. After that point, bin.ts's
// later mutations on `session` — including the deferral that sets
// `pendingEnvSelection = true` — never reach the store. The final
// `tui.store.session = session` then OVERWRITES the store's
// accumulated state with the stale bin.ts ref, wiping the user's
// `introConcluded = true` progress.
//
// The fix patches `$session.setKey` to mutate the underlying object
// in-place (preserving the shared reference with bin.ts) while still
// firing `notify()` per key. This test pins both halves of the
// regression: ref stability across in-store setters AND propagation
// of external mutations after a setter has fired.
describe('WizardStore session ref stability (env-picker race regression)', () => {
  it('preserves the bin.ts session reference after an in-store setKey', async () => {
    // Lazy import to avoid pulling the full store module graph into the
    // property-test bootstrap above when this file is loaded.
    const { WizardStore } = await import('../store.js');
    const store = new WizardStore(Flow.Wizard);
    const session = buildSession({});

    // bin.ts: `startTUI(version, undefined, session)` → store.session = session
    store.session = session;
    expect(store.session).toBe(session);

    // bin.ts: user clicks Continue on Intro → concludeIntro() fires.
    // Prior to the fix, this allocated a fresh `{ ...prev, introConcluded: true }`
    // object and detached `$session.value` from `session`.
    store.concludeIntro();

    // The bin.ts ref must still match $session.value, otherwise bin.ts's
    // later in-place mutations (deferral) will be invisible to the store.
    expect(store.session).toBe(session);
    expect(store.session.introConcluded).toBe(true);
    expect(session.introConcluded).toBe(true);
  });

  // Regression: env-picker hang after `git reset --hard` followed by
  // re-running the wizard. PR #778 invalidates the stale checkpoint, so
  // the session starts WITHOUT prior org/project IDs hydrated. Self-heal
  // clears the API key. `resolveCredentials` lands at
  // `needs_user_choice/environment_selection`. `applyEnvSelectionDeferral`
  // mutates the session in place. The router must park on Auth so the
  // env picker renders — NOT walk past Auth into the Setup-bucket
  // screens, which is the user-reported "Stepper shows ✓ Welcome ✓ Auth
  // ● Setup with no env-picker rendered" symptom.
  //
  // Notably, in this scenario `selectedOrgId === null` AND
  // `selectedProjectId === null`. PR #775's structural fallback gate
  // (`needsEnvPickStillRequired`) previously short-circuited to `false`
  // when the IDs were null — leaving only `pendingEnvSelection` as the
  // gate. Any silent clear of that flag (still unidentified — 4 PRs of
  // history) landed the user on Setup. This commit extends the
  // structural gate to use the same first-org/first-project fallback
  // `resolveCredentials` used when it issued the deferral, so the
  // structural gate covers the no-pre-selection path too.
  //
  // This pins the post-#778 path (no checkpoint hydration) — distinct
  // from the test below which simulates the path where the user
  // explicitly Resumed a checkpoint. Both must land on Auth.
  it('parks on Auth after checkpoint invalidation + multi-env defer (restart-after-reset)', async () => {
    const { WizardStore } = await import('../store.js');
    const store = new WizardStore(Flow.Wizard);

    // (1) bin.ts: buildSessionFromOptions — fresh session, no checkpoint
    // hydration because loadCheckpoint() returned null (PR #778 invalidated).
    const session = buildSession({});
    // `tryResolveZone` (mocked in this test file) returns null, so without
    // an explicit region the router would park on RegionSelect, not Auth.
    // In the real wizard, the stored user's zone surfaces through
    // `getStoredUser`; pin it here so the test focuses on the env-picker
    // gate, not region resolution.
    session.region = 'us';

    // (2) startTUI(session) — initialSession assignment.
    store.session = session;
    expect(store.currentScreen).toBe(Screen.Intro);

    // (3) bin.ts: self-heal cleared the orphan API key (already on disk —
    //     just a side effect we don't model here). `resolveCredentials`
    //     then fetches the user, hits the multi-env defer branch, and
    //     mutates the session in place. NOTE: this path does NOT set
    //     `selectedOrgId/Name/ProjectId/Name` — only `pendingOrgs` +
    //     pending tokens. That's the key difference from the
    //     checkpoint-resumed path below.
    session.pendingOrgs = [
      {
        id: 'org-1',
        name: 'Acme',
        projects: [
          {
            id: 'proj-1',
            name: 'Demo',
            environments: [
              {
                name: 'Development',
                rank: 1,
                app: { id: 'app-1', apiKey: 'k1' },
              },
              {
                name: 'Production',
                rank: 2,
                app: { id: 'app-2', apiKey: 'k2' },
              },
            ],
          },
        ],
      },
    ];
    session.pendingAuthIdToken = 'id';
    session.pendingAuthAccessToken = 'at';

    // (4) bin.ts: applyEnvSelectionDeferral
    session.selectedEnvName = null;
    session.selectedAppId = null;
    session.credentials = null;
    session.pendingEnvSelection = true;

    // (5) tui.store.session = session
    store.session = session;

    // The user dismisses the welcome screen.
    store.concludeIntro();

    // EXPECTATION: router parks on Auth so AuthScreen renders the env
    // picker. Pre-fix, the bug surfaces here: if any path silently
    // advanced past Auth (e.g. by clearing pendingEnvSelection without
    // setting credentials, or by Auth.isComplete returning true), the
    // router would jump straight to Setup or Run, producing the
    // user-visible "✓ Welcome ✓ Auth ● Setup" stepper with no picker.
    expect(store.currentScreen).toBe(Screen.Auth);
    expect(store.session.pendingEnvSelection).toBe(true);
    expect(store.session.credentials).toBeNull();
    expect(store.session.pendingOrgs).not.toBeNull();
  });

  // Smoking-gun: structural gate alone (pendingEnvSelection=false)
  // must still hold the user on Auth in the restart-after-reset
  // scenario. This pins the gap PR #775 left behind — when no
  // selectedOrgId/ProjectId have been picked yet, the structural gate
  // previously short-circuited and any path that clobbered the flag
  // dropped the user onto Setup. With the fallback in place, the
  // gate uses `pendingOrgs[0].projects[0]` (the same heuristic
  // `resolveCredentials` uses) and stays load-bearing.
  it('structural gate alone holds Auth in restart-after-reset (pendingEnvSelection clobbered)', () => {
    const session = buildSession({});
    session.introConcluded = true;
    session.region = 'us';
    // applyEnvSelectionDeferral has fired AND something later clobbered
    // the flag back to false (the recurring bug class).
    session.pendingEnvSelection = false;
    // Simulate the worst case for isolating the structural gate: every
    // OTHER Auth.isComplete clause has been satisfied somehow (some
    // silent path landed credentials + names without the user picking
    // an env — the symptom 4 prior PRs chased). The structural gate is
    // the ONLY thing keeping the user on Auth here.
    session.credentials = {
      accessToken: 'tok',
      idToken: 'id',
      projectApiKey: 'k1',
      host: 'https://api2.amplitude.com',
      appId: 0,
    };
    session.selectedOrgName = 'Acme';
    session.selectedProjectName = 'Demo';
    // CRITICAL: post-#778 restart-after-reset path leaves IDs null even
    // when names land — `resolveCredentials` multi-env defer branch
    // doesn't populate selectedOrgId/ProjectId. PR #775's structural
    // gate short-circuited to false in this case (because guard 2
    // required IDs). Without the IDs-null fallback in this commit,
    // Auth.isComplete returns true and the user lands on Setup with no
    // env picker — the user-reported hang.
    session.selectedOrgId = null;
    session.selectedProjectId = null;
    session.selectedEnvName = null;
    session.pendingOrgs = [
      {
        id: 'org-1',
        name: 'Acme',
        projects: [
          {
            id: 'proj-1',
            name: 'Demo',
            environments: [
              { name: 'Production', rank: 1, app: { id: 'a1', apiKey: 'k1' } },
              { name: 'Development', rank: 2, app: { id: 'a2', apiKey: 'k2' } },
            ],
          },
        ],
      },
    ];

    const authEntry = FLOWS[Flow.Wizard].find((e) => e.screen === Screen.Auth);
    if (!authEntry?.isComplete) {
      throw new Error('Auth entry missing isComplete — test setup error');
    }

    // Without the IDs-null fallback in this commit,
    // `needsEnvPickStillRequired` returns false (because
    // selectedOrgId/ProjectId are null) and Auth.isComplete returns
    // true. With the fallback, the gate consults pendingOrgs[0]
    // .projects[0] and returns true → isComplete=false.
    expect(authEntry.isComplete(session)).toBe(false);

    // Sanity: the router actually parks on Auth.
    const router = new WizardRouter(Flow.Wizard);
    expect(router.resolve(session)).toBe(Screen.Auth);
  });

  // Counter-test: structural gate must NOT fire on the manual-API-key
  // path (pendingOrgs is null when resolveCredentials lands at
  // 'api_key_notice'), even with selectedEnvName null. The first guard
  // (`pendingOrgs === null`) keeps that path passing through unchanged.
  it('structural gate does not block manual-API-key path (pendingOrgs null)', () => {
    const session = buildSession({});
    session.introConcluded = true;
    session.region = 'us';
    session.pendingEnvSelection = false;
    session.pendingOrgs = null;
    session.selectedOrgId = 'org-1';
    session.selectedOrgName = 'Acme';
    session.selectedProjectId = 'proj-1';
    session.selectedProjectName = 'Demo';
    session.selectedEnvName = null;
    session.credentials = {
      accessToken: 'tok',
      idToken: 'id',
      projectApiKey: 'manual-key',
      host: 'https://api2.amplitude.com',
      appId: 0,
    };

    const authEntry = FLOWS[Flow.Wizard].find((e) => e.screen === Screen.Auth);
    if (!authEntry?.isComplete) {
      throw new Error('Auth entry missing isComplete — test setup error');
    }
    expect(authEntry.isComplete(session)).toBe(true);
  });

  it('propagates in-place external mutations after an in-store setKey, including pendingEnvSelection', async () => {
    const { WizardStore } = await import('../store.js');
    const store = new WizardStore(Flow.Wizard);

    // Simulate the exact bin.ts sequence for the env-picker bug:
    //   1) buildSessionFromOptions + Object.assign(session, checkpoint)
    //   2) startTUI(session)
    //   3) user clicks Resume on the checkpoint prompt
    //      → store.concludeIntro() fires
    //   4) resolveCredentials populates pendingOrgs + returns
    //      needs_user_choice/environment_selection
    //   5) applyEnvSelectionDeferral mutates session in-place
    //   6) bin.ts: tui.store.session = session (line 598)
    const session = buildSession({});
    Object.assign(session, {
      region: 'us',
      selectedOrgId: 'org-1',
      selectedOrgName: 'Acme',
      selectedProjectId: 'proj-1',
      selectedProjectName: 'Demo',
      selectedEnvName: 'Production',
    });
    session.introConcluded = false; // bin.ts forces this on rehydration
    session._restoredFromCheckpoint = true;

    // (2) startTUI
    store.session = session;
    expect(store.currentScreen).toBe(Screen.Intro);

    // (3) user picks Resume
    store.concludeIntro();
    // With the fix, the ref is preserved; without it, this would be a new object.
    expect(store.session).toBe(session);

    // (4) + (5) — bin.ts mutates `session` in-place
    session.pendingOrgs = [
      {
        id: 'org-1',
        name: 'Acme',
        projects: [
          {
            id: 'proj-1',
            name: 'Demo',
            environments: [
              {
                name: 'Production',
                rank: 1,
                app: { id: 'app-1', apiKey: 'k1' },
              },
              { name: 'Staging', rank: 2, app: { id: 'app-2', apiKey: 'k2' } },
              { name: 'Dev', rank: 3, app: { id: 'app-3', apiKey: 'k3' } },
              { name: 'Test', rank: 4, app: { id: 'app-4', apiKey: 'k4' } },
            ],
          },
        ],
      },
    ];
    session.pendingAuthIdToken = 'id';
    session.pendingAuthAccessToken = 'at';
    // applyEnvSelectionDeferral
    session.selectedEnvName = null;
    session.selectedAppId = null;
    session.credentials = null;
    session.pendingEnvSelection = true;

    // The store must see these external mutations because $session.value
    // and `session` are the same object. Pre-fix, store.session.pendingEnvSelection
    // would be `false` here (deferral's mutation never reached the store).
    expect(store.session.pendingEnvSelection).toBe(true);
    expect(store.session.credentials).toBeNull();
    expect(store.session.selectedEnvName).toBeNull();

    // (6) The final re-emit must NOT clobber the user's introConcluded=true.
    // Pre-fix, line 598 replaced $session.value with the stale bin.ts ref
    // whose introConcluded=false bumped the user back to Intro.
    store.session = session;
    expect(store.session.introConcluded).toBe(true);
    expect(store.session.pendingEnvSelection).toBe(true);

    // Router rewinds to Auth (env picker surface) — not Intro, not Setup.
    expect(store.currentScreen).toBe(Screen.Auth);
  });
});

// ── Overlay stack invalidation under hard-reset (audit #5) ──────────
//
// Property: for any interleaving of overlay push/pop with the three
// hard-reset handlers (`setRegionForced`, `resetForFreshStart`,
// `cancelWizard`), the post-reset state must satisfy
//
//   1. `router.overlays.length === 0`
//   2. `router.resolve(session)` returns a screen value that is part of
//      the active flow (i.e. not an orphaned `Overlay.*` value)
//
// This pins the regression caught by audit #5: before the fix, an
// overlay pushed by /mcp or /slack would keep rendering against a
// session whose credentials had just been wiped, silently driving
// `installer.detectClients()` against the wrong zone.
//
// The test models the three resets as the union of "wipe a bunch of
// session keys" + `router.clearOverlays()` — the exact contract the
// store handlers now implement. We mutate the session and call
// `clearOverlays()` here rather than constructing a full `WizardStore`
// (which would require fs + analytics + api-key-store mocks not present
// in this test file) — the store-level integration is pinned separately
// in `store.test.ts`.
describe('overlay stack invalidation on hard reset (audit #5)', () => {
  type ResetKind = 'setRegionForced' | 'resetForFreshStart' | 'cancelWizard';

  /**
   * Apply the same session-key mutations the matching store handler
   * does, plus the `router.clearOverlays()` call that's now wired in.
   * Each branch deliberately mirrors only the slice of state the
   * router cares about for re-resolution — the full handler in
   * `store.ts` touches more fields (mcpComplete / slackOutcome / etc.)
   * but none of them change which screen `resolve()` picks.
   */
  function applyReset(
    kind: ResetKind,
    session: WizardSession,
    router: WizardRouter,
  ) {
    router.clearOverlays();
    if (kind === 'setRegionForced') {
      session.regionForced = true;
      session.credentials = null;
      session.selectedOrgId = null;
      session.selectedOrgName = null;
      session.selectedProjectId = null;
      session.selectedProjectName = null;
      session.selectedEnvName = null;
      session.outroData = null;
      session.runPhase = RunPhase.Idle;
    } else if (kind === 'resetForFreshStart') {
      session.introConcluded = false;
      session.region = null;
      session.selectedOrgId = null;
      session.selectedOrgName = null;
      session.selectedProjectId = null;
      session.selectedProjectName = null;
      session.selectedEnvName = null;
    } else {
      session.outroData = { kind: OutroKind.Cancel, message: 'cancel' };
    }
  }

  it('after any reset, overlays are empty and resolve() never returns an Overlay value', () => {
    const overlayArb = fc.constantFrom(
      Overlay.Outage,
      Overlay.Mcp,
      Overlay.Slack,
      Overlay.Snake,
      Overlay.Login,
      Overlay.Logout,
    );

    // An action stream: either push an overlay, pop one, or no-op.
    const actionArb = fc.oneof(
      overlayArb.map((o) => ({ kind: 'push' as const, overlay: o })),
      fc.constant({ kind: 'pop' as const }),
    );

    const resetArb = fc.constantFrom(
      'setRegionForced' as const,
      'resetForFreshStart' as const,
      'cancelWizard' as const,
    );

    // Random session-state preludes so the reset has something
    // non-trivial to wipe. None of these prevent the property: the
    // reset's job is to land on a sensible screen regardless of where
    // the user was before.
    const preludeArb = fc.record({
      introConcluded: fc.boolean(),
      regionSet: fc.boolean(),
      credsSet: fc.boolean(),
      mcpDone: fc.boolean(),
      phase: fc.constantFrom(
        RunPhase.Idle,
        RunPhase.Running,
        RunPhase.Completed,
        RunPhase.Error,
      ),
    });

    fc.assert(
      fc.property(
        fc.array(actionArb, { minLength: 0, maxLength: 8 }),
        resetArb,
        preludeArb,
        (actions, reset, prelude) => {
          const session = buildSession({});
          const router = new WizardRouter(Flow.Wizard);

          // Apply prelude — landing somewhere plausible mid-flow.
          session.introConcluded = prelude.introConcluded;
          session.region = prelude.regionSet ? 'us' : null;
          if (prelude.credsSet) applyAuthComplete(session);
          session.mcpComplete = prelude.mcpDone;
          session.runPhase = prelude.phase;

          // Interleave overlay actions to seed the stack.
          for (const action of actions) {
            if (action.kind === 'push') {
              router.pushOverlay(action.overlay);
            } else {
              router.popOverlay();
            }
          }

          // Trigger the reset.
          applyReset(reset, session, router);

          // Invariant 1: overlays gone.
          expect(
            router.hasOverlay,
            `hasOverlay after ${reset} with actions ${JSON.stringify(actions)}`,
          ).toBe(false);

          // Invariant 2: resolved screen is a real Screen value, not
          // an orphaned Overlay value. (resolve() returns `ScreenName`
          // — either a Screen or an Overlay — so we check membership
          // explicitly rather than relying on the type.)
          const resolved = router.resolve(session);
          expect(
            ALL_OVERLAYS.has(resolved as Overlay),
            `resolve() returned overlay ${resolved} after ${reset} with actions ${JSON.stringify(
              actions,
            )}`,
          ).toBe(false);
          expect(
            ALL_SCREENS.has(resolved as Screen),
            `resolve() returned non-Screen ${resolved} after ${reset} with actions ${JSON.stringify(
              actions,
            )}`,
          ).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ── requiresSignupField helper regression ───────────────────────────
//
// Locks in the semantics of `flows.ts#requiresSignupField`, which
// replaced five duplicated `signupRequiredFields !== null &&
// signupRequiredFields.includes(<field>)` predicates across the
// signup-ceremony entries. The helper is load-bearing for back-nav
// `isWall` evaluation order (the wall fires BEFORE `revert`, and the
// `revert` guards now route through this helper) — so a regression
// here would silently re-introduce the bug PR #809's report flagged.

describe('requiresSignupField helper (predicate dedup)', () => {
  it('returns false when signupRequiredFields is null', () => {
    const session = buildSession({});
    session.signupRequiredFields = null;
    expect(requiresSignupField('full_name')(session)).toBe(false);
    expect(requiresSignupField('terms_acceptance')(session)).toBe(false);
  });

  it('returns false when the array does not include the field', () => {
    const session = buildSession({});
    session.signupRequiredFields = ['full_name'];
    expect(requiresSignupField('terms_acceptance')(session)).toBe(false);

    session.signupRequiredFields = ['terms_acceptance'];
    expect(requiresSignupField('full_name')(session)).toBe(false);

    session.signupRequiredFields = [];
    expect(requiresSignupField('full_name')(session)).toBe(false);
    expect(requiresSignupField('terms_acceptance')(session)).toBe(false);
  });

  it('returns true when the array includes the field', () => {
    const session = buildSession({});
    session.signupRequiredFields = ['full_name'];
    expect(requiresSignupField('full_name')(session)).toBe(true);

    session.signupRequiredFields = ['terms_acceptance'];
    expect(requiresSignupField('terms_acceptance')(session)).toBe(true);

    session.signupRequiredFields = ['full_name', 'terms_acceptance'];
    expect(requiresSignupField('full_name')(session)).toBe(true);
    expect(requiresSignupField('terms_acceptance')(session)).toBe(true);
  });

  it('matches the original `s.signupRequiredFields !== null && s.signupRequiredFields.includes(field)` shape across all RequiredKey values', () => {
    // For every known required key, verify the helper agrees with the
    // pre-refactor expression for the four signup-array states the flow
    // can ever observe (null, empty, includes, excludes).
    for (const field of KNOWN_REQUIRED_KEYS) {
      const states: ReadonlyArray<
        readonly [
          'null' | 'empty' | 'includes' | 'excludes',
          (typeof KNOWN_REQUIRED_KEYS)[number][] | null,
        ]
      > = [
        ['null', null],
        ['empty', []],
        ['includes', [field]],
        [
          'excludes',
          KNOWN_REQUIRED_KEYS.filter((k) => k !== field) as (
            | 'full_name'
            | 'terms_acceptance'
          )[],
        ],
      ];
      for (const [label, value] of states) {
        const session = buildSession({});
        session.signupRequiredFields = value as
          | (typeof KNOWN_REQUIRED_KEYS)[number][]
          | null;
        const expected =
          value !== null && (value as readonly string[]).includes(field);
        expect(
          requiresSignupField(field)(session),
          `field=${field} state=${label}`,
        ).toBe(expected);
      }
    }
  });

  it('SignupField type union matches the canonical RequiredKey field names used by direct-signup', () => {
    // Compile-time + runtime check: every key in KNOWN_REQUIRED_KEYS is
    // a valid SignupField, and the union covers the full set. If
    // KNOWN_REQUIRED_KEYS gains a new entry, this assignment forces an
    // update here AND at every requiresSignupField call site (so the
    // 5-way dedup stays exhaustive across signup ceremony entries).
    const allFields: readonly SignupField[] = KNOWN_REQUIRED_KEYS;
    expect(allFields.length).toBe(KNOWN_REQUIRED_KEYS.length);
    expect(new Set(allFields)).toEqual(new Set(KNOWN_REQUIRED_KEYS));
    // Sanity: the two known field names today.
    expect(new Set(allFields)).toEqual(
      new Set(['full_name', 'terms_acceptance']),
    );
  });
});
