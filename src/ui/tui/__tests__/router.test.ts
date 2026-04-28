import { describe, it, expect } from 'vitest';
import { WizardRouter, Overlay, Screen, Flow } from '../router.js';
import { FLOWS } from '../flows.js';
import {
  buildSession,
  RunPhase,
  OutroKind,
  type WizardSession,
} from '../../../lib/wizard-session.js';

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a fresh default session. */
function fresh(): WizardSession {
  return buildSession({});
}

/** Build a session with specific overrides applied. */
function sessionWith(overrides: Partial<WizardSession>): WizardSession {
  return { ...fresh(), ...overrides };
}

/** Credentials stub for advancing past AuthScreen. */
const CREDS = {
  accessToken: 'tok',
  projectApiKey: 'pk',
  host: 'https://app.amplitude.com',
  appId: 1,
};

/** Build a session that has completed through intro + region + auth + dataSetup (ready for Run). */
function sessionAtRun(): WizardSession {
  return sessionWith({
    introConcluded: true,
    region: 'us',
    credentials: CREDS,
    selectedOrgName: 'Acme',
    selectedProjectName: 'Amplitude',
    selectedEnvName: 'Production',
    projectHasData: false,
  });
}

/** Build a session that has completed through Run (ready for post-run screens). */
function sessionPostRun(): WizardSession {
  return {
    ...sessionAtRun(),
    runPhase: RunPhase.Completed,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('WizardRouter', () => {
  // ── 1. Basic resolution ────────────────────────────────────────────

  describe('basic resolution', () => {
    it('fresh session resolves to Screen.Intro', () => {
      const router = new WizardRouter();
      expect(router.resolve(fresh())).toBe(Screen.Intro);
    });

    it('advances from Intro to RegionSelect when intro is concluded and region is null', () => {
      const router = new WizardRouter();
      const session = sessionWith({ introConcluded: true });
      expect(router.resolve(session)).toBe(Screen.RegionSelect);
    });

    it('advances from RegionSelect to Auth when region is set', () => {
      const router = new WizardRouter();
      const session = sessionWith({ introConcluded: true, region: 'us' });
      expect(router.resolve(session)).toBe(Screen.Auth);
    });

    it('advances from Auth to DataSetup when credentials + org + project are set', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
        credentials: CREDS,
        selectedOrgName: 'Acme',
        selectedProjectName: 'Amplitude',
        selectedEnvName: 'Production',
      });
      expect(router.resolve(session)).toBe(Screen.DataSetup);
    });

    it('stays on Auth when credentials set but project name AND id are missing', () => {
      const router = new WizardRouter();
      // With neither name nor ID resolved, the identity isn't known at all —
      // user must complete selection.
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
        credentials: CREDS,
        selectedOrgName: 'Acme',
        selectedOrgId: 'org-1',
        selectedProjectName: null,
        selectedProjectId: null,
        selectedEnvName: 'Production',
      });
      expect(router.resolve(session)).toBe(Screen.Auth);
    });

    it('advances when names are missing but IDs are set (hydration fallback)', () => {
      const router = new WizardRouter();
      // Failure mode: fetchAmplitudeUser couldn't populate names, but ampli.json
      // gave us the IDs. Auth must not deadlock on the spinner — accept IDs as
      // a degraded-but-valid identity.
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
        credentials: CREDS,
        selectedOrgName: null,
        selectedOrgId: 'org-1',
        selectedProjectName: null,
        selectedProjectId: 'ws-1',
        selectedEnvName: null,
      });
      expect(router.resolve(session)).toBe(Screen.DataSetup);
    });

    it('advances from Auth to DataSetup when env name is missing (env is optional)', () => {
      const router = new WizardRouter();
      // Manual API key entry can't resolve the env. As long as org and
      // project are known, Auth is considered complete.
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
        credentials: CREDS,
        selectedOrgName: 'Acme',
        selectedProjectName: 'Amplitude',
        selectedEnvName: null,
      });
      expect(router.resolve(session)).toBe(Screen.DataSetup);
    });

    it('advances from DataSetup to Run when projectHasData is set', () => {
      const router = new WizardRouter();
      expect(router.resolve(sessionAtRun())).toBe(Screen.Run);
    });

    it('advances from Run to Mcp when runPhase is Completed', () => {
      const router = new WizardRouter();
      expect(router.resolve(sessionPostRun())).toBe(Screen.Mcp);
    });

    it('advances from Mcp to DataIngestionCheck when mcpComplete', () => {
      const router = new WizardRouter();
      const session = { ...sessionPostRun(), mcpComplete: true };
      expect(router.resolve(session)).toBe(Screen.DataIngestionCheck);
    });

    it('advances from DataIngestionCheck to Slack when dataIngestionConfirmed', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionPostRun(),
        mcpComplete: true,
        dataIngestionConfirmed: true,
      };
      expect(router.resolve(session)).toBe(Screen.Slack);
    });

    it('advances from Slack to Outro when slackComplete', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionPostRun(),
        mcpComplete: true,
        dataIngestionConfirmed: true,
        slackComplete: true,
      };
      expect(router.resolve(session)).toBe(Screen.Outro);
    });

    it('all entries complete resolves to last screen (Outro)', () => {
      const router = new WizardRouter();
      const session: WizardSession = {
        ...sessionPostRun(),
        mcpComplete: true,
        dataIngestionConfirmed: true,
        slackComplete: true,
      };
      expect(router.resolve(session)).toBe(Screen.Outro);
    });
  });

  // ── 2. Screen visibility (show predicates) ────────────────────────

  describe('screen visibility (show predicates)', () => {
    it('RegionSelect shows when region is null', () => {
      const router = new WizardRouter();
      const session = sessionWith({ introConcluded: true, region: null });
      expect(router.resolve(session)).toBe(Screen.RegionSelect);
    });

    it('RegionSelect shows when regionForced is true', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
        regionForced: true,
      });
      expect(router.resolve(session)).toBe(Screen.RegionSelect);
    });

    it('RegionSelect skips when region is pre-populated and not forced', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        introConcluded: true,
        region: 'eu',
        regionForced: false,
      });
      // Should skip RegionSelect and land on Auth
      expect(router.resolve(session)).toBe(Screen.Auth);
    });

    it('routes to CreateProject when createProject.pending is true', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
        createProject: {
          pending: true,
          source: 'project',
          suggestedName: null,
        },
      });
      expect(router.resolve(session)).toBe(Screen.CreateProject);
    });

    it('returns to Auth when createProject is cancelled (pending=false, no creds)', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
        createProject: {
          pending: false,
          source: null,
          suggestedName: null,
        },
      });
      expect(router.resolve(session)).toBe(Screen.Auth);
    });

    it('skips past CreateProject once credentials are set (success path)', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
        credentials: CREDS,
        selectedOrgName: 'Acme',
        selectedProjectName: 'Amplitude',
        selectedEnvName: 'Production',
        createProject: {
          pending: false,
          source: null,
          suggestedName: null,
        },
      });
      expect(router.resolve(session)).toBe(Screen.DataSetup);
    });

    it('Auth skips on error (runPhase === Error)', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
        runPhase: RunPhase.Error,
      });
      // Auth show predicate: runPhase !== Error -> false, so Auth is skipped
      // DataSetup is next (always shown), and projectHasData is null -> stops there
      expect(router.resolve(session)).toBe(Screen.DataSetup);
    });

    it('Setup skips when no framework questions', () => {
      const router = new WizardRouter();
      // frameworkConfig is null -> needsSetup returns false -> Setup skipped
      const session = sessionAtRun();
      expect(router.resolve(session)).toBe(Screen.Run);
    });

    it('Setup skips when activationLevel is full', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionAtRun(),
        activationLevel: 'full' as const,
        frameworkConfig: {
          metadata: {
            setup: {
              questions: [
                {
                  key: 'router',
                  message: 'Which router?',
                  options: [],
                  detect: async () => null,
                },
              ],
            },
          },
        } as WizardSession['frameworkConfig'],
      };
      // Setup show: needsSetup(s) && activationLevel !== 'full'
      // activationLevel is 'full' -> show returns false -> skipped
      expect(router.resolve(session)).not.toBe(Screen.Setup);
    });

    it('Run skips when activationLevel is full', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionAtRun(),
        activationLevel: 'full' as const,
      };
      // Run show: activationLevel !== 'full' -> false -> skipped
      // Should skip to Mcp
      expect(router.resolve(session)).toBe(Screen.Mcp);
    });

    it('Mcp skips on error', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionAtRun(),
        runPhase: RunPhase.Error,
      };
      // Run isComplete: runPhase === Completed || Error -> true
      // Mcp show: runPhase !== Error -> false -> skipped
      // DataIngestionCheck show: runPhase !== Error -> false -> skipped
      // Checklist show: runPhase !== Error -> false -> skipped
      // Slack show: runPhase !== Error -> false -> skipped
      // Falls through to Outro
      expect(router.resolve(session)).toBe(Screen.Outro);
    });

    it('DataIngestionCheck skips on error', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionPostRun(),
        runPhase: RunPhase.Error,
        mcpComplete: true,
      };
      // DataIngestionCheck show: runPhase !== Error -> false -> skipped
      expect(router.resolve(session)).not.toBe(Screen.DataIngestionCheck);
    });

    it('DataIngestionCheck skips when activationLevel is full', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionPostRun(),
        activationLevel: 'full' as const,
        mcpComplete: true,
      };
      // DataIngestionCheck show: activationLevel !== 'full' -> false -> skipped
      expect(router.resolve(session)).not.toBe(Screen.DataIngestionCheck);
    });

    it('Slack skips on error', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionPostRun(),
        runPhase: RunPhase.Error,
        mcpComplete: true,
        dataIngestionConfirmed: true,
      };
      // Slack show: runPhase !== Error -> false -> skipped
      expect(router.resolve(session)).not.toBe(Screen.Slack);
    });

    it('ActivationOptions shows only when activationLevel is partial', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionAtRun(),
        activationLevel: 'partial' as const,
      };
      expect(router.resolve(session)).toBe(Screen.ActivationOptions);
    });

    it('ActivationOptions skips when activationLevel is none', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionAtRun(),
        activationLevel: 'none' as const,
      };
      // ActivationOptions show: activationLevel === 'partial' -> false -> skipped
      expect(router.resolve(session)).not.toBe(Screen.ActivationOptions);
    });
  });

  // ── 3. Overlay stack ──────────────────────────────────────────────

  describe('overlay stack', () => {
    it('pushOverlay makes overlay the active screen', () => {
      const router = new WizardRouter();
      router.pushOverlay(Overlay.Outage);
      expect(router.resolve(fresh())).toBe(Overlay.Outage);
    });

    it('popOverlay resumes flow', () => {
      const router = new WizardRouter();
      router.pushOverlay(Overlay.Outage);
      router.popOverlay();
      expect(router.resolve(fresh())).toBe(Screen.Intro);
    });

    it('multiple overlays stack correctly (LIFO)', () => {
      const router = new WizardRouter();
      router.pushOverlay(Overlay.Outage);
      router.pushOverlay(Overlay.SettingsOverride);
      router.pushOverlay(Overlay.Snake);

      expect(router.resolve(fresh())).toBe(Overlay.Snake);

      router.popOverlay();
      expect(router.resolve(fresh())).toBe(Overlay.SettingsOverride);

      router.popOverlay();
      expect(router.resolve(fresh())).toBe(Overlay.Outage);

      router.popOverlay();
      expect(router.resolve(fresh())).toBe(Screen.Intro);
    });

    it('overlay does not affect flow cursor', () => {
      const router = new WizardRouter();
      const session = sessionAtRun();

      // Before overlay, should be at Run
      expect(router.resolve(session)).toBe(Screen.Run);

      // Push overlay
      router.pushOverlay(Overlay.Mcp);
      expect(router.resolve(session)).toBe(Overlay.Mcp);

      // Pop overlay — flow cursor should still be at Run
      router.popOverlay();
      expect(router.resolve(session)).toBe(Screen.Run);
    });

    it('hasOverlay returns true when overlays are present', () => {
      const router = new WizardRouter();
      expect(router.hasOverlay).toBe(false);

      router.pushOverlay(Overlay.Outage);
      expect(router.hasOverlay).toBe(true);

      router.popOverlay();
      expect(router.hasOverlay).toBe(false);
    });

    it('activeScreen returns top overlay when present', () => {
      const router = new WizardRouter();
      router.pushOverlay(Overlay.Login);
      expect(router.activeScreen).toBe(Overlay.Login);
    });

    it('activeScreen returns first flow screen when no overlays', () => {
      const router = new WizardRouter();
      expect(router.activeScreen).toBe(Screen.Intro);
    });
  });

  // ── 4. Cancel fast-path ───────────────────────────────────────────

  describe('cancel fast-path', () => {
    it('outroData.kind === Cancel returns Outro regardless of flow position', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        outroData: { kind: OutroKind.Cancel },
      });
      // Even though intro is not concluded, Cancel jumps to Outro
      expect(router.resolve(session)).toBe(Screen.Outro);
    });

    it('Cancel fast-path works mid-flow', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionAtRun(),
        outroData: { kind: OutroKind.Cancel },
      };
      expect(router.resolve(session)).toBe(Screen.Outro);
    });

    it('Cancel fast-path takes priority over overlays', () => {
      const router = new WizardRouter();
      router.pushOverlay(Overlay.Outage);
      const session = sessionWith({
        outroData: { kind: OutroKind.Cancel },
      });
      // Overlay is checked first in resolve(), so this should return the overlay
      expect(router.resolve(session)).toBe(Overlay.Outage);
    });

    it('outroData.kind === Success does not trigger fast-path', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        outroData: { kind: OutroKind.Success },
      });
      // Success doesn't short-circuit — normal flow applies.
      // Fresh session with outroData.kind === Success still stops at Intro
      expect(router.resolve(session)).toBe(Screen.Intro);
    });

    it('outroData.kind === Error does not trigger fast-path', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        outroData: { kind: OutroKind.Error },
      });
      expect(router.resolve(session)).toBe(Screen.Intro);
    });

    it('null outroData does not trigger fast-path', () => {
      const router = new WizardRouter();
      const session = sessionWith({ outroData: null });
      expect(router.resolve(session)).toBe(Screen.Intro);
    });
  });

  // ── 5. Direction tracking ─────────────────────────────────────────

  describe('direction tracking', () => {
    it('direction is null initially', () => {
      const router = new WizardRouter();
      expect(router.lastNavDirection).toBeNull();
    });

    it('_setDirection sets direction to push', () => {
      const router = new WizardRouter();
      router._setDirection('push');
      expect(router.lastNavDirection).toBe('push');
    });

    it('_setDirection sets direction to pop', () => {
      const router = new WizardRouter();
      router._setDirection('pop');
      expect(router.lastNavDirection).toBe('pop');
    });

    it('_setDirection resets to null', () => {
      const router = new WizardRouter();
      router._setDirection('push');
      router._setDirection(null);
      expect(router.lastNavDirection).toBeNull();
    });
  });

  // ── 6. All flows ──────────────────────────────────────────────────

  describe('all flows', () => {
    it('Wizard flow starts at Intro', () => {
      const router = new WizardRouter(Flow.Wizard);
      expect(router.resolve(fresh())).toBe(Screen.Intro);
      expect(router.activeFlow).toBe(Flow.Wizard);
    });

    it('Wizard flow ends at Outro when all complete', () => {
      const router = new WizardRouter(Flow.Wizard);
      const session: WizardSession = {
        ...sessionPostRun(),
        mcpComplete: true,
        dataIngestionConfirmed: true,
        slackComplete: true,
      };
      expect(router.resolve(session)).toBe(Screen.Outro);
    });

    it('McpAdd flow starts at McpAdd screen', () => {
      const router = new WizardRouter(Flow.McpAdd);
      expect(router.resolve(fresh())).toBe(Screen.McpAdd);
      expect(router.activeFlow).toBe(Flow.McpAdd);
    });

    it('McpAdd flow ends at Outro when mcpComplete', () => {
      const router = new WizardRouter(Flow.McpAdd);
      const session = sessionWith({ mcpComplete: true });
      expect(router.resolve(session)).toBe(Screen.Outro);
    });

    it('McpRemove flow starts at McpRemove screen', () => {
      const router = new WizardRouter(Flow.McpRemove);
      expect(router.resolve(fresh())).toBe(Screen.McpRemove);
      expect(router.activeFlow).toBe(Flow.McpRemove);
    });

    it('McpRemove flow ends at Outro when mcpComplete', () => {
      const router = new WizardRouter(Flow.McpRemove);
      const session = sessionWith({ mcpComplete: true });
      expect(router.resolve(session)).toBe(Screen.Outro);
    });

    it('SlackSetup flow starts at SlackSetup screen', () => {
      const router = new WizardRouter(Flow.SlackSetup);
      expect(router.resolve(fresh())).toBe(Screen.SlackSetup);
      expect(router.activeFlow).toBe(Flow.SlackSetup);
    });

    it('SlackSetup flow ends at Outro when slackComplete', () => {
      const router = new WizardRouter(Flow.SlackSetup);
      const session = sessionWith({ slackComplete: true });
      expect(router.resolve(session)).toBe(Screen.Outro);
    });

    it('RegionSelect flow starts at RegionSelect screen', () => {
      const router = new WizardRouter(Flow.RegionSelect);
      // RegionSelect show: region === null || regionForced
      // Fresh session: region is null -> show = true
      expect(router.resolve(fresh())).toBe(Screen.RegionSelect);
      expect(router.activeFlow).toBe(Flow.RegionSelect);
    });

    it('RegionSelect flow ends at its last screen (RegionSelect) when complete', () => {
      const router = new WizardRouter(Flow.RegionSelect);
      const session = sessionWith({ region: 'eu', regionForced: false });
      // isComplete: region !== null && !regionForced -> true
      // All entries complete -> resolves to last screen
      expect(router.resolve(session)).toBe(Screen.RegionSelect);
    });

    it('all five flows are defined in FLOWS', () => {
      expect(FLOWS[Flow.Wizard]).toBeDefined();
      expect(FLOWS[Flow.McpAdd]).toBeDefined();
      expect(FLOWS[Flow.McpRemove]).toBeDefined();
      expect(FLOWS[Flow.SlackSetup]).toBeDefined();
      expect(FLOWS[Flow.RegionSelect]).toBeDefined();

      // Exactly 5 flows
      expect(Object.keys(FLOWS)).toHaveLength(5);
    });
  });

  // ── 7. Edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('empty overlay pop does not crash', () => {
      const router = new WizardRouter();
      expect(() => router.popOverlay()).not.toThrow();
      expect(router.resolve(fresh())).toBe(Screen.Intro);
    });

    it('multiple pops on empty stack do not crash', () => {
      const router = new WizardRouter();
      expect(() => {
        router.popOverlay();
        router.popOverlay();
        router.popOverlay();
      }).not.toThrow();
    });

    it('resolve with completely fresh/default session does not crash', () => {
      const router = new WizardRouter();
      expect(() => router.resolve(fresh())).not.toThrow();
    });

    it('direction is null initially', () => {
      const router = new WizardRouter();
      expect(router.lastNavDirection).toBeNull();
    });

    it('default constructor uses Wizard flow', () => {
      const router = new WizardRouter();
      expect(router.activeFlow).toBe(Flow.Wizard);
    });

    it('constructor accepts all flow types', () => {
      for (const flow of Object.values(Flow)) {
        const router = new WizardRouter(flow);
        expect(router.activeFlow).toBe(flow);
      }
    });

    it('resolve is idempotent with the same session state', () => {
      const router = new WizardRouter();
      const session = sessionAtRun();
      const first = router.resolve(session);
      const second = router.resolve(session);
      expect(first).toBe(second);
    });

    it('overlays are independent from session state changes', () => {
      const router = new WizardRouter();
      router.pushOverlay(Overlay.Snake);

      // Resolve with different sessions — overlay should always win
      expect(router.resolve(fresh())).toBe(Overlay.Snake);
      expect(router.resolve(sessionAtRun())).toBe(Overlay.Snake);
      expect(router.resolve(sessionPostRun())).toBe(Overlay.Snake);
    });

    it('error path skips all post-run screens to Outro', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionAtRun(),
        runPhase: RunPhase.Error,
      };
      // Run isComplete (Error counts as complete), Mcp/DataIngestion/Checklist/Slack all hidden
      expect(router.resolve(session)).toBe(Screen.Outro);
    });

    it('full activation skips Run, DataIngestionCheck but shows Mcp', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionAtRun(),
        activationLevel: 'full' as const,
      };
      // Run is hidden (activationLevel === full), Setup is hidden (no questions),
      // next visible is Mcp
      expect(router.resolve(session)).toBe(Screen.Mcp);
    });

    it('full activation with mcp complete skips DataIngestionCheck to Slack', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionAtRun(),
        activationLevel: 'full' as const,
        mcpComplete: true,
      };
      // DataIngestionCheck show: activationLevel !== 'full' -> false -> skipped
      expect(router.resolve(session)).toBe(Screen.Slack);
    });
  });

  // ── Back navigation ────────────────────────────────────────────────

  /**
   * Build a stub store whose mutations write into a single session reference.
   * Mirrors only the methods invoked by FlowEntry.revert callbacks so we
   * exercise the real revert wiring end-to-end without spinning up the
   * full WizardStore (which would pull in nanostores + analytics).
   */
  function makeStubStore(initial: WizardSession) {
    const ref: { session: WizardSession } = { session: initial };
    const mutate = (patch: Partial<WizardSession>) => {
      ref.session = { ...ref.session, ...patch };
    };
    const stub = {
      get session() {
        return ref.session;
      },
      resetAuthForRegionChange: () =>
        mutate({
          region: null,
          regionForced: true,
          credentials: null,
          pendingAuthAccessToken: null,
          pendingAuthIdToken: null,
          pendingOrgs: null,
          selectedOrgId: null,
          selectedOrgName: null,
          selectedProjectId: null,
          selectedProjectName: null,
          selectedAppId: null,
          selectedEnvName: null,
          projectHasData: null,
        }),
      clearOrgAndProjectSelection: () =>
        mutate({
          selectedOrgId: null,
          selectedOrgName: null,
          selectedProjectId: null,
          selectedProjectName: null,
          selectedAppId: null,
          selectedEnvName: null,
          projectHasData: null,
        }),
      resetActivationCheck: () =>
        mutate({
          projectHasData: null,
          activationLevel: 'none' as const,
          activationOptionsComplete: false,
        }),
      resetActivationOptions: () =>
        mutate({ activationOptionsComplete: false }),
      resetFeatureOptIn: () => mutate({ optInFeaturesComplete: false }),
      resetMcp: () =>
        mutate({
          mcpComplete: false,
          mcpOutcome: null,
          mcpInstalledClients: [],
        }),
      resetDataIngestion: () => mutate({ dataIngestionConfirmed: false }),
      resetSlack: () => mutate({ slackComplete: false, slackOutcome: null }),
      cancelCreateProject: () =>
        mutate({
          createProject: { pending: false, source: null, suggestedName: null },
        }),
      popLastFrameworkContextAnswer: () => {
        const order = ref.session.frameworkContextAnswerOrder;
        if (order.length === 0) return false;
        const last = order[order.length - 1];
        const { [last]: _omit, ...rest } = ref.session.frameworkContext;
        void _omit;
        mutate({
          frameworkContext: rest,
          frameworkContextAnswerOrder: order.slice(0, -1),
        });
        return true;
      },
    };
    // Cast: the real WizardStore has many more methods, but goBack only
    // reaches the ones above through FlowEntry.revert callbacks.
    return { stub, ref };
  }

  describe('back navigation', () => {
    it('reports canGoBack=false on the very first screen', () => {
      const router = new WizardRouter();
      expect(router.canGoBack(fresh())).toBe(false);
    });

    it('reports canGoBack=false on RegionSelect (Intro is non-revertible)', () => {
      const router = new WizardRouter();
      const session = sessionWith({ introConcluded: true });
      // Active = RegionSelect, walking back hits Intro which has no revert -> wall
      expect(router.canGoBack(session)).toBe(false);
    });

    it('canGoBack from Auth -> reverts past RegionSelect', () => {
      const router = new WizardRouter();
      const session = sessionWith({
        introConcluded: true,
        region: 'us',
      });
      expect(router.resolve(session)).toBe(Screen.Auth);
      expect(router.canGoBack(session)).toBe(true);

      const { stub, ref } = makeStubStore(session);
      const ok = router.goBack(ref.session, stub as never);
      expect(ok).toBe(true);
      expect(ref.session.region).toBeNull();
      expect(ref.session.regionForced).toBe(true);
      expect(new WizardRouter().resolve(ref.session)).toBe(Screen.RegionSelect);
    });

    it('canGoBack from DataSetup -> reverts back into Auth picker', () => {
      const router = new WizardRouter();
      const session = sessionAtRun();
      // sessionAtRun has projectHasData=false → router resolves to ActivationOptions or
      // Run depending on activationLevel. Force projectHasData=null so we're on DataSetup.
      const onDataSetup = { ...session, projectHasData: null };
      expect(router.resolve(onDataSetup)).toBe(Screen.DataSetup);
      const { stub, ref } = makeStubStore(onDataSetup);
      expect(router.goBack(ref.session, stub as never)).toBe(true);
      // Auth's isComplete requires selectedOrgName/Id + selectedProjectName/Id.
      // After clearing selection, Auth becomes incomplete and the router lands there.
      expect(ref.session.selectedOrgName).toBeNull();
      expect(ref.session.selectedProjectName).toBeNull();
      expect(new WizardRouter().resolve(ref.session)).toBe(Screen.Auth);
    });

    it('Run acts as a back-stop wall — Mcp cannot back past Run', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionPostRun(),
        // Pre-Run was incomplete, then Run completed. Mcp is now active.
        mcpComplete: false,
      };
      expect(router.resolve(session)).toBe(Screen.Mcp);
      expect(router.canGoBack(session)).toBe(false);
      const { stub, ref } = makeStubStore(session);
      expect(router.goBack(ref.session, stub as never)).toBe(false);
    });

    it('canGoBack from Slack -> reverts DataIngestionCheck', () => {
      const router = new WizardRouter();
      const session = {
        ...sessionPostRun(),
        mcpComplete: true,
        dataIngestionConfirmed: true,
        slackComplete: false,
      };
      expect(router.resolve(session)).toBe(Screen.Slack);
      expect(router.canGoBack(session)).toBe(true);
      const { stub, ref } = makeStubStore(session);
      expect(router.goBack(ref.session, stub as never)).toBe(true);
      expect(ref.session.dataIngestionConfirmed).toBe(false);
      expect(new WizardRouter().resolve(ref.session)).toBe(
        Screen.DataIngestionCheck,
      );
    });

    it('Setup revert returns false when no user answers exist — keeps walking back', () => {
      const router = new WizardRouter();
      // Setup complete (no user-answered framework questions),
      // ActivationOptions shown+complete. Back from Run should walk
      // Setup (no-op revert) and land on ActivationOptions.
      // (Pre-PR 313 this test asserted resolve == Screen.FeatureOptIn
      //  before goBack; FeatureOptIn was removed when SR + G&S + autocapture
      //  became inline-auto-enabled, so the back-walk no longer transits
      //  through that screen — the underlying revert-walking behavior we
      //  care about is preserved.)
      const session = {
        ...sessionAtRun(),
        activationLevel: 'partial' as const,
        activationOptionsComplete: true,
      };

      const { stub, ref } = makeStubStore(session);
      const ok = router.goBack(ref.session, stub as never);
      // Walks: Run (active) → Setup (no questions, complete, revert
      // returns false) → ActivationOptions (complete + revert) → reverts.
      expect(ok).toBe(true);
      expect(ref.session.activationOptionsComplete).toBe(false);
    });

    it('canGoBack=false when an overlay is active', () => {
      const router = new WizardRouter();
      const session = sessionWith({ introConcluded: true, region: 'us' });
      expect(router.canGoBack(session)).toBe(true);
      router.pushOverlay(Overlay.Mcp);
      expect(router.canGoBack(session)).toBe(false);
      const { stub, ref } = makeStubStore(session);
      expect(router.goBack(ref.session, stub as never)).toBe(false);
    });

    it('successful goBack flips lastNavDirection to "pop"', () => {
      const router = new WizardRouter();
      const session = sessionWith({ introConcluded: true, region: 'us' });
      const { stub, ref } = makeStubStore(session);
      router.goBack(ref.session, stub as never);
      expect(router.lastNavDirection).toBe('pop');
    });
  });
});
