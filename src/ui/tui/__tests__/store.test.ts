import {
  WizardStore,
  TaskStatus,
  Flow,
  Screen,
  Overlay,
  RunPhase,
  McpOutcome,
} from '../store.js';
import {
  vi,
  describe,
  it,
  expect,
  type Mock,
  beforeEach,
  afterAll,
} from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AuthOnboardingPath,
  OutroKind,
  AdditionalFeature,
  SlackOutcome,
} from '../../../lib/wizard-session.js';
import { buildSession } from '../../../lib/wizard-session.js';
import { Integration } from '../../../lib/constants.js';
import { analytics } from '../../../utils/analytics.js';
import {
  readAmpliConfig,
  writeAmpliConfig,
} from '../../../lib/ampli-config.js';

vi.mock('../../../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    captureException: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    setSessionProperty: vi.fn(),
    setDistinctId: vi.fn(),
    identifyUser: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isFeatureFlagEnabled: vi.fn().mockReturnValue(true),
  },
  sessionProperties: vi.fn(() => ({})),
  sessionPropertiesCompact: vi.fn(() => ({})),
}));

// `store.changeInstallDir` calls `setProjectLogFile` so the structured
// logger follows the active project's run dir. The unit tests below
// don't exercise the logger contract; mock the function so the test
// suite doesn't ensureDir/touch real paths under `/tmp/...` while
// asserting state-reset semantics. The dedicated logger test
// (logger.test.ts) covers the path-routing contract end-to-end.
//
// `vi.hoisted` is required because `vi.mock` is hoisted to the top of
// the file, so the mock factory cannot close over a `const` declared
// in the test module's normal evaluation order.
const { setProjectLogFileMock } = vi.hoisted(() => ({
  setProjectLogFileMock: vi.fn(),
}));
vi.mock('../../../lib/observability/index.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../lib/observability/index.js')
  >('../../../lib/observability/index.js');
  return {
    ...actual,
    setProjectLogFile: setProjectLogFileMock,
  };
});

vi.mock('../../../utils/api-key-store.js', () => ({
  clearApiKey: vi.fn(),
  persistApiKey: vi.fn(),
  readApiKeyWithSource: vi.fn(),
}));

// Mocked at the import boundary so `runSignupAttempt` tests below can
// drive the wrapped POST's resolution without hitting the network.
vi.mock('../../../utils/signup-or-auth.js', () => ({
  performSignupOrAuth: vi.fn(),
}));
// Stub `getStoredUser` so the Wizard flow's RegionSelect gate (which calls
// `tryResolveZone`) doesn't pick up the developer's real ~/.ampli.json.
// `readAmpliConfig` is left un-mocked because store.test.ts already
// exercises real reads/writes against per-test tmpdirs.
vi.mock('../../../utils/ampli-settings.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../utils/ampli-settings.js')
  >();
  return {
    ...actual,
    getStoredUser: vi.fn(() => undefined),
  };
});

// Redirect fs-touching setters (setRegion, setOrgAndWorkspace) away from
// the repo root so tests don't pollute the wizard's own ampli.json. Every
// store gets a fresh isolated tmpdir; individual tests can override by
// reassigning store.session.installDir.
const createdDirs: string[] = [];
function createStore(flow?: Flow): WizardStore {
  const store = new WizardStore(flow);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-store-test-'));
  createdDirs.push(dir);
  store.session.installDir = dir;
  return store;
}

const wizardCaptureMock = analytics.wizardCapture as Mock;

describe('WizardStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterAll(() => {
    // Clean up the per-store tmpdirs accumulated by createStore() so the
    // suite doesn't leak directories into $TMPDIR across runs.
    for (const dir of createdDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    createdDirs.length = 0;
  });
  // ── Construction ─────────────────────────────────────────────────

  describe('constructor', () => {
    it('initialises with default state', () => {
      const store = createStore();
      expect(store.version).toBe('');
      expect(store.statusMessages).toEqual([]);
      expect(store.tasks).toEqual([]);
      // installDir is overridden by the test helper, and agentSessionId is a
      // freshly-generated UUID per call to buildSession — compare the rest.
      const {
        installDir: storeInstallDir,
        agentSessionId: storeAgentSessionId,
        ...rest
      } = store.session;
      const {
        installDir: defaultInstallDir,
        agentSessionId: defaultAgentSessionId,
        ...defaults
      } = buildSession({});
      expect(rest).toEqual(defaults);
      expect(storeInstallDir).toMatch(/wizard-store-test-/);
      expect(defaultInstallDir).toBeDefined();
      // Both should be valid UUIDs but won't match (generated independently).
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(storeAgentSessionId).toMatch(UUID_RE);
      expect(defaultAgentSessionId).toMatch(UUID_RE);
    });

    it('defaults to Wizard flow', () => {
      const store = createStore();
      expect(store.router.activeFlow).toBe(Flow.Wizard);
    });

    it('accepts a custom flow', () => {
      const store = createStore(Flow.McpAdd);
      expect(store.router.activeFlow).toBe(Flow.McpAdd);
    });

    it('starts with version 0', () => {
      const store = createStore();
      expect(store.getVersion()).toBe(0);
      expect(store.getSnapshot()).toBe(0);
    });
  });

  // ── Change notification ──────────────────────────────────────────

  describe('change notification', () => {
    it('emitChange increments version and notifies subscribers', () => {
      const store = createStore();
      const listener = vi.fn();
      store.subscribe(listener);

      store.emitChange();

      expect(store.getVersion()).toBe(1);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('version increments on each emitChange', () => {
      const store = createStore();
      store.emitChange();
      store.emitChange();
      store.emitChange();
      expect(store.getVersion()).toBe(3);
    });
  });

  // ── React integration (subscribe / getSnapshot) ──────────────────

  describe('subscribe / getSnapshot', () => {
    it('subscribe registers a listener that fires on change', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.emitChange();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('subscribe returns an unsubscribe function', () => {
      const store = createStore();
      const cb = vi.fn();
      const unsub = store.subscribe(cb);

      unsub();
      store.emitChange();
      expect(cb).not.toHaveBeenCalled();
    });

    it('getSnapshot returns the current version', () => {
      const store = createStore();
      expect(store.getSnapshot()).toBe(0);
      store.emitChange();
      expect(store.getSnapshot()).toBe(1);
    });

    it('is compatible with useSyncExternalStore contract', () => {
      const store = createStore();
      const cb = vi.fn();
      const unsub = store.subscribe(cb);

      const v1 = store.getSnapshot();
      store.completeSetup();
      const v2 = store.getSnapshot();

      expect(v2).toBeGreaterThan(v1);
      expect(cb).toHaveBeenCalled();
      unsub();
    });
  });

  // ── Session setters ──────────────────────────────────────────────

  describe('session setters', () => {
    it('completeSetup sets setupConfirmed and resolves setupComplete promise', async () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.completeSetup();

      expect(store.session.setupConfirmed).toBe(true);
      await store.setupComplete;
      expect(cb).toHaveBeenCalled();
    });

    it('setRunPhase updates session.runPhase', () => {
      const store = createStore();
      store.setRunPhase(RunPhase.Running);
      expect(store.session.runPhase).toBe(RunPhase.Running);
    });

    it('setRunPhase(Running) stamps runStartedAt on first entry', () => {
      const store = createStore();
      expect(store.session.runStartedAt).toBeNull();
      const before = Date.now();
      store.setRunPhase(RunPhase.Running);
      const after = Date.now();
      expect(store.session.runStartedAt).not.toBeNull();
      expect(store.session.runStartedAt!).toBeGreaterThanOrEqual(before);
      expect(store.session.runStartedAt!).toBeLessThanOrEqual(after);
    });

    it('setRunPhase(Running) does not overwrite runStartedAt on re-entry', async () => {
      const store = createStore();
      store.setRunPhase(RunPhase.Running);
      const stamped = store.session.runStartedAt;
      // Advance wall clock enough that a reset would differ.
      await new Promise((r) => setTimeout(r, 5));
      store.setRunPhase(RunPhase.Running);
      expect(store.session.runStartedAt).toBe(stamped);
    });

    it('setRunPhase to Completed preserves runStartedAt', () => {
      const store = createStore();
      store.setRunPhase(RunPhase.Running);
      const stamped = store.session.runStartedAt;
      store.setRunPhase(RunPhase.Completed);
      expect(store.session.runStartedAt).toBe(stamped);
    });

    it('setRunPhase(Running) pre-populates the canonical 4 tasks', () => {
      // Empty list while the agent cold-starts is a known abandonment
      // moment. Pre-populate at the Running transition so the user sees
      // "0 done · 4 to go" from frame 1. Was 5 tasks pre-DEFER_DASHBOARD_PLAN
      // PR 4; dashboard moved to the deferred `wizard dashboard` command.
      const store = createStore();
      expect(store.tasks).toHaveLength(0);
      store.setRunPhase(RunPhase.Running);
      expect(store.tasks).toHaveLength(4);
      expect(store.tasks.map((t) => t.label)).toEqual([
        'Detect your project setup',
        'Install Amplitude',
        'Plan and approve events to track',
        'Wire up event tracking',
      ]);
      expect(store.tasks.every((t) => t.status === TaskStatus.Pending)).toBe(
        true,
      );
    });

    it('setRunPhase(Running) does not clobber existing task progress on re-entry', () => {
      const store = createStore();
      store.setRunPhase(RunPhase.Running);
      store.applyJourneyTransition('install', 'completed');
      expect(store.tasks[1].status).toBe(TaskStatus.Completed);
      store.setRunPhase(RunPhase.Idle);
      store.setRunPhase(RunPhase.Running);
      expect(store.tasks[1].status).toBe(TaskStatus.Completed);
    });

    it('setCredentials updates session.credentials', () => {
      const store = createStore();
      const creds = {
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://app.amplitude.com',
        appId: 42,
      };
      store.setCredentials(creds);
      expect(store.session.credentials).toEqual(creds);
    });

    it('setOAuthComplete clears any cached project API key for the install dir', async () => {
      const { clearApiKey } = await import('../../../utils/api-key-store.js');
      const store = createStore();
      (clearApiKey as Mock).mockClear();

      store.setOAuthComplete({
        accessToken: 'access',
        idToken: 'id',
        cloudRegion: 'us',
        orgs: [],
      });

      // Stale keychain entries from prior runs in different orgs must be
      // wiped so AuthScreen step 1 misses and the freshly-fetched env key
      // wins. See src/ui/tui/screens/AuthScreen.tsx step 1.
      expect(clearApiKey).toHaveBeenCalledTimes(1);
      expect(clearApiKey).toHaveBeenCalledWith(store.session.installDir);
    });

    it('setFrameworkConfig updates integration and frameworkConfig', () => {
      const store = createStore();
      const integration = Integration.nextjs;
      const config = {
        metadata: { name: 'Next.js' },
      } as WizardStore['session']['frameworkConfig'];

      store.setFrameworkConfig(integration, config);

      expect(store.session.integration).toBe(integration);
      expect(store.session.frameworkConfig).toBe(config);
    });

    it('setDetectionComplete marks detection done', () => {
      const store = createStore();
      expect(store.session.detectionComplete).toBe(false);
      store.setDetectionComplete();
      expect(store.session.detectionComplete).toBe(true);
    });

    it('setDetectedFramework sets the label', () => {
      const store = createStore();
      store.setDetectedFramework('Django');
      expect(store.session.detectedFrameworkLabel).toBe('Django');
    });

    it('setLoginUrl sets and clears the login URL', () => {
      const store = createStore();
      store.setLoginUrl('https://example.com/auth');
      expect(store.session.loginUrl).toBe('https://example.com/auth');

      store.setLoginUrl(null);
      expect(store.session.loginUrl).toBeNull();
    });

    it('setServiceStatus sets status info', () => {
      const store = createStore();
      const status = {
        description: 'Major outage',
        statusPageUrl: 'https://status.amplitude.com',
      };
      store.setServiceStatus(status);
      expect(store.session.serviceStatus).toEqual(status);

      store.setServiceStatus(null);
      expect(store.session.serviceStatus).toBeNull();
    });

    it('setRetryState sets and clears retry banner state', () => {
      const store = createStore();
      expect(store.session.retryState).toBeNull();

      const state = {
        attempt: 3,
        maxRetries: 10,
        nextRetryAtMs: Date.now() + 2000,
        errorStatus: 504,
        reason: 'Amplitude gateway error',
        startedAt: Date.now(),
      };
      store.setRetryState(state);
      expect(store.session.retryState).toEqual(state);

      store.setRetryState(null);
      expect(store.session.retryState).toBeNull();
    });

    it('setMcpComplete marks MCP step done with outcome', () => {
      const store = createStore();
      expect(store.session.mcpComplete).toBe(false);
      store.setMcpComplete(McpOutcome.Installed, ['Cursor']);
      expect(store.session.mcpComplete).toBe(true);
      expect(store.session.mcpOutcome).toBe(McpOutcome.Installed);
      expect(store.session.mcpInstalledClients).toEqual(['Cursor']);
    });

    it('setOutroData sets outro information', () => {
      const store = createStore();
      const data = { kind: OutroKind.Success, message: 'Done!' };
      store.setOutroData(data);
      expect(store.session.outroData).toEqual(data);
    });

    it('setOutroData notifies subscribers even when data shape is unchanged', () => {
      // Contract: every call to setOutroData fires a change notification
      // (and the 'outro reached' analytics event). Callers that need to
      // re-notify subscribers without re-firing analytics should use
      // emitChange() directly — see InkUI.outro()/cancel() defensive
      // re-emit branches.
      const store = createStore();
      const listener = vi.fn();
      const data = { kind: OutroKind.Error, message: 'Authentication failed' };
      store.setOutroData(data);
      store.subscribe(listener);
      store.setOutroData(data);
      expect(listener).toHaveBeenCalled();
    });

    it('setOutroData emits speed-to-finish properties on outro reached', () => {
      // Contract: the `outro reached` event is the canonical "end of
      // run" signal used to chart median/p90 time-to-finish over time.
      // It must include `'duration ms'` (Running → outro wall clock)
      // and the segmentation properties needed to slice the trend.
      const store = createStore();
      store.session.integration = Integration.Nextjs;
      store.session.detectedFrameworkLabel = 'Next.js (App Router)';
      store.session.activationLevel = 'partial';
      store.setRunPhase(RunPhase.Running);
      store.setOutroData({ kind: OutroKind.Success });

      const call = wizardCaptureMock.mock.calls.find(
        ([eventName]) => eventName === 'outro reached',
      );
      expect(call).toBeDefined();
      const props = call![1] as Record<string, unknown>;
      expect(props['outro kind']).toBe(OutroKind.Success);
      expect(props['integration']).toBe(Integration.Nextjs);
      expect(props['detected framework']).toBe('Next.js (App Router)');
      expect(props['activation level']).toBe('partial');
      expect(typeof props['duration ms']).toBe('number');
      expect(props['duration ms'] as number).toBeGreaterThanOrEqual(0);
      expect(typeof props['returning user']).toBe('boolean');
    });

    it('setOutroData emits null duration when runStartedAt is null', () => {
      // Some outro paths fire before the run ever transitions to Running
      // (e.g. early auth cancel). Emit `null` so chart filters can drop
      // those rows cleanly instead of computing a misleading zero.
      const store = createStore();
      store.setOutroData({ kind: OutroKind.Cancel });
      const call = wizardCaptureMock.mock.calls.find(
        ([eventName]) => eventName === 'outro reached',
      );
      expect(call).toBeDefined();
      const props = call![1] as Record<string, unknown>;
      expect(props['duration ms']).toBeNull();
    });

    it('setFrameworkContext sets key-value pairs', () => {
      const store = createStore();
      store.setFrameworkContext('packageManager', 'pnpm');
      expect(store.session.frameworkContext['packageManager']).toBe('pnpm');

      store.setFrameworkContext('srcDir', 'src');
      expect(store.session.frameworkContext['srcDir']).toBe('src');
    });

    it('setOrgAndProject clears org/project IDs when called with empty inputs', () => {
      // Regression: AuthScreen "Start Over", stale-org clear, and the
      // create-project fallback all pass `{ id: '', name: '' }` to reset
      // session state. Both fields must collapse to null so an empty string
      // `selectedOrgId` doesn't still satisfy `isAuthenticated`, leaving the
      // session in a meaningless state.
      const store = createStore();
      expect(() =>
        store.setOrgAndProject(
          { id: '', name: '' },
          { id: '', name: '' },
          '/tmp/no-such-dir',
          { persist: false },
        ),
      ).not.toThrow();
      expect(store.session.selectedOrgId).toBeNull();
      expect(store.session.selectedProjectId).toBeNull();
      expect(store.session.selectedProjectName).toBe('');
    });

    it('restoreSessionIds clears selectedOrgId/ProjectId when called with empty inputs', () => {
      // Defense-in-depth: keep restoreSessionIds consistent with
      // setOrgAndProject so neither write path throws on empty input
      // and neither leaves isAuthenticated reporting a meaningless empty id.
      const store = createStore();
      expect(() =>
        store.restoreSessionIds({
          orgId: '',
          orgName: '',
          projectId: '',
          projectName: '',
        }),
      ).not.toThrow();
      expect(store.session.selectedOrgId).toBeNull();
      expect(store.session.selectedProjectId).toBeNull();
    });

    it('restoreSessionIds stores non-empty project ids', () => {
      const store = createStore();
      store.restoreSessionIds({ projectId: 'ws-77', projectName: 'Prod' });
      expect(store.session.selectedProjectId).toBe('ws-77');
      expect(store.session.selectedProjectName).toBe('Prod');
    });

    it('setOrgAndProject stores non-empty ids', () => {
      const store = createStore();
      store.setOrgAndProject(
        { id: 'org-1', name: 'Acme' },
        { id: 'ws-42', name: 'Amplitude' },
        '/tmp/no-such-dir',
        { persist: false },
      );
      expect(store.session.selectedOrgId).toBe('org-1');
      expect(store.session.selectedProjectId).toBe('ws-42');
    });

    it('setOrgAndProject syncs credentials.appId and projectApiKey to the new project', () => {
      // Regression: switching project mid-session left credentials.appId
      // pointing at the originally-OAuth'd project, so /whoami and any
      // reader of credentials.* showed the stale id.
      const store = createStore();
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'old-key',
        host: 'https://api2.amplitude.com',
        appId: 187520,
      });
      store.setOrgAndProject(
        { id: 'org-2', name: 'EU Org' },
        {
          id: 'ws-99',
          name: 'EU Project',
          environments: [
            {
              rank: 0,
              app: { id: '900001', apiKey: 'new-key' },
            },
          ],
        },
        '/tmp/no-such-dir',
        { persist: false },
      );
      expect(store.session.selectedAppId).toBe('900001');
      expect(store.session.credentials?.appId).toBe(900001);
      expect(store.session.credentials?.projectApiKey).toBe('new-key');
    });

    it('setOrgAndProject preserves projectApiKey when env payload omits it', () => {
      // Some picker payloads only carry app.id (no apiKey). Don't blank
      // out the active key in that case — keep what we already had.
      const store = createStore();
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'keep-me',
        host: 'https://api2.amplitude.com',
        appId: 187520,
      });
      store.setOrgAndProject(
        { id: 'org-2', name: 'Acme' },
        {
          id: 'ws-99',
          name: 'Other',
          environments: [{ rank: 0, app: { id: '900001' } }],
        },
        '/tmp/no-such-dir',
        { persist: false },
      );
      expect(store.session.credentials?.appId).toBe(900001);
      expect(store.session.credentials?.projectApiKey).toBe('keep-me');
    });

    it('every setter emits exactly one change event', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.completeSetup();
      store.setRunPhase(RunPhase.Running);
      store.setCredentials(null);
      store.setDetectionComplete();
      store.setDetectedFramework('React');
      store.setLoginUrl('url');
      store.setServiceStatus(null);
      store.setMcpComplete();
      store.setOutroData({ kind: OutroKind.Success });
      store.setFrameworkContext('k', 'v');
      store.setFrameworkConfig(null, null);

      expect(cb).toHaveBeenCalledTimes(11);
    });

    it('setRegionForced clears all region-tied state so Auth re-runs', () => {
      const store = createStore();
      // Simulate an authenticated user mid-session in US.
      store.session.region = 'us';
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://api2.amplitude.com',
        appId: 42,
      });
      store.session.userEmail = 'user@example.com';
      store.session.selectedOrgId = 'org-1';
      store.session.selectedOrgName = 'Acme';
      store.session.selectedProjectId = 'ws-1';
      store.session.selectedProjectName = 'Amplitude';
      store.session.selectedAppId = '769610';
      store.session.selectedEnvName = 'Production';
      store.session.projectHasData = true;
      store.session.activationLevel = 'full';
      store.session.activationOptionsComplete = true;
      store.session.dataIngestionConfirmed = true;
      store.session.mcpComplete = true;
      store.session.mcpOutcome = McpOutcome.Installed;
      store.session.pendingOrgs = [];
      store.session.pendingAuthIdToken = 'idt';
      store.session.pendingAuthAccessToken = 'at';
      store.session.apiKeyNotice = 'stale';

      store.setRegionForced();

      expect(store.session.regionForced).toBe(true);
      expect(store.session.credentials).toBeNull();
      expect(store.session.userEmail).toBeNull();
      expect(store.session.selectedOrgId).toBeNull();
      expect(store.session.selectedOrgName).toBeNull();
      expect(store.session.selectedProjectId).toBeNull();
      expect(store.session.selectedProjectName).toBeNull();
      expect(store.session.selectedAppId).toBeNull();
      expect(store.session.selectedEnvName).toBeNull();
      expect(store.session.projectHasData).toBeNull();
      expect(store.session.activationLevel).toBeNull();
      expect(store.session.activationOptionsComplete).toBe(false);
      expect(store.session.dataIngestionConfirmed).toBe(false);
      expect(store.session.mcpComplete).toBe(false);
      expect(store.session.mcpOutcome).toBeNull();
      expect(store.session.pendingOrgs).toBeNull();
      expect(store.session.pendingAuthIdToken).toBeNull();
      expect(store.session.pendingAuthAccessToken).toBeNull();
      expect(store.session.apiKeyNotice).toBeNull();
    });

    it('setRegionForced clears framework + feature state so a new-zone run starts clean', () => {
      const store = createStore();
      store.session.region = 'us';
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://api2.amplitude.com',
        appId: 42,
      });
      // Simulate a run that progressed past framework detection and feature opt-in.
      store.session.integration = Integration.NextJs;
      store.session.frameworkConfig = {} as never;
      store.session.frameworkContext = { router: 'app' };
      store.session.discoveredFeatures = ['llm', 'session_replay'] as never;
      store.session.additionalFeatureQueue = ['llm'] as never;
      store.session.additionalFeatureCurrent = 'llm' as never;
      store.session.additionalFeatureCompleted = ['session_replay'] as never;
      store.session.optInFeaturesComplete = true;
      store.session.mcpInstalledClients = ['cursor', 'claude'];
      store.session.slackComplete = true;
      store.session.slackOutcome = SlackOutcome.Joined;

      store.setRegionForced();

      expect(store.session.integration).toBeNull();
      expect(store.session.frameworkConfig).toBeNull();
      expect(store.session.frameworkContext).toEqual({});
      expect(store.session.discoveredFeatures).toEqual([]);
      expect(store.session.additionalFeatureQueue).toEqual([]);
      expect(store.session.additionalFeatureCurrent).toBeNull();
      expect(store.session.additionalFeatureCompleted).toEqual([]);
      expect(store.session.optInFeaturesComplete).toBe(false);
      expect(store.session.mcpInstalledClients).toEqual([]);
      expect(store.session.slackComplete).toBe(false);
      expect(store.session.slackOutcome).toBeNull();
      // Lifecycle reset still happens.
      expect(store.session.runPhase).toBe(RunPhase.Idle);
      expect(store.session.outroData).toBeNull();
    });

    it('showLogoutOverlay sets loggingOut synchronously before pushing the overlay', () => {
      const store = createStore();
      expect(store.session.loggingOut).toBe(false);
      store.showLogoutOverlay();
      // The synchronous flag-set must happen before the overlay is pushed,
      // so the bin.ts re-auth watcher can rely on it the moment /logout
      // dispatches.
      expect(store.session.loggingOut).toBe(true);
      expect(store.currentScreen).toBe(Overlay.Logout);
    });

    it('hideLogoutOverlay clears loggingOut so a cancelled /logout does not block re-auth', () => {
      const store = createStore();
      store.showLogoutOverlay();
      expect(store.session.loggingOut).toBe(true);
      store.hideLogoutOverlay();
      expect(store.session.loggingOut).toBe(false);
    });

    it('setRegionForced clears outroData and runPhase so /region works after setup completes', () => {
      const store = createStore();
      store.session.region = 'us';
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://api2.amplitude.com',
        appId: 42,
      });
      store.session.outroData = { kind: OutroKind.Success, message: 'Done' };
      store.setRunPhase(RunPhase.Completed);

      store.setRegionForced();

      expect(store.session.outroData).toBeNull();
      expect(store.session.runPhase).toBe(RunPhase.Idle);
    });

    it('setRegionForced wipes signup ceremony state so the new zone re-runs the probe POST', () => {
      // /region during a mid-signup ceremony: signupAuth.zone is pinned
      // to the old region, and a cached signupRequiredFields from the
      // old zone's needs_information response would steer the new
      // zone's pass through the wrong field-collection screens. Every
      // ceremony key must reset alongside the rest of the zone-scoped
      // state.
      const store = createStore();
      store.session.region = 'us';
      store.session.authOnboardingPath = AuthOnboardingPath.CreateAccount;
      store.session.signupEmail = 'ada@example.com';
      store.session.signupFullName = 'Ada Lovelace';
      store.session.tosAccepted = true;
      store.session.signupRequiredFields = ['full_name', 'terms_acceptance'];
      store.session.legalDocumentBundle = {
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      };
      store.session.legalDocumentSource = 'local';
      store.session.signupAbandoned = false;
      store.session.signupTokensObtained = true;
      store.session.signupAuth = {
        idToken: 'i',
        accessToken: 'a',
        refreshToken: 'r',
        zone: 'us',
        userInfo: null,
        dashboardUrl: null,
      };

      store.setRegionForced();

      expect(store.session.signupEmail).toBeNull();
      expect(store.session.signupFullName).toBeNull();
      expect(store.session.tosAccepted).toBeNull();
      expect(store.session.signupRequiredFields).toBeNull();
      // Lock-step with tosAccepted: legal-doc state must reset together so
      // a stale bundle can't ride into a follow-up POST whose acceptance
      // got cleared.
      expect(store.session.legalDocumentBundle).toBeNull();
      expect(store.session.legalDocumentSource).toBeNull();
      expect(store.session.signupAuth).toBeNull();
      expect(store.session.signupAbandoned).toBe(false);
      expect(store.session.signupTokensObtained).toBe(false);
    });

    it('setRegion persists new zone to existing ampli.json even when org/workspace are cleared', async () => {
      const store = createStore();
      // Seed ampli.json in the store's tmpdir as if from a prior SUSI
      writeAmpliConfig(store.session.installDir, {
        OrgId: 'org-old',
        WorkspaceId: 'ws-old',
        Zone: 'us',
        SourceId: 'src-1',
      });

      store.setRegionForced();
      expect(store.session.selectedOrgId).toBeNull();

      store.setRegion('eu');
      await new Promise((r) => setTimeout(r, 50));

      const result = readAmpliConfig(store.session.installDir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.Zone).toBe('eu');
      expect(result.config.OrgId).toBeUndefined();
      expect(result.config.WorkspaceId).toBeUndefined();
      expect(result.config.SourceId).toBe('src-1'); // unrelated fields preserved
    });

    it('setRegion surfaces a feedback notice when project binding writes fail', async () => {
      const store = createStore();
      writeAmpliConfig(store.session.installDir, {
        OrgId: 'org-1',
        WorkspaceId: 'ws-1',
        Zone: 'us',
      });

      const ampliConfig = await import('../../../lib/ampli-config.js');
      const spy = vi
        .spyOn(ampliConfig, 'writeAmpliConfig')
        .mockReturnValue(false);

      try {
        store.setRegion('eu');
        await new Promise((r) => setTimeout(r, 50));
        expect(spy).toHaveBeenCalled();
        expect(store.commandFeedback ?? '').toMatch(/binding files/i);
      } finally {
        spy.mockRestore();
      }
    });

    it('setRegion does not create ampli.json when none exists', async () => {
      const store = createStore();
      store.setRegion('us');
      await new Promise((r) => setTimeout(r, 50));
      expect(
        fs.existsSync(path.join(store.session.installDir, 'ampli.json')),
      ).toBe(false);
    });

    it('/region mid-session routes back through RegionSelect then Auth', () => {
      const store = createStore();
      // Walk into a post-auth state.
      store.concludeIntro();
      store.setRegion('us');
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://api2.amplitude.com',
        appId: 1,
      });
      store.session.selectedOrgName = 'Acme';
      store.session.selectedOrgId = 'org-1';
      store.session.selectedProjectName = 'Amplitude';
      store.session.selectedProjectId = 'ws-1';
      store.session.selectedAppId = 'app-1';
      store.setProjectHasData(false);
      expect(store.currentScreen).toBe(Screen.Run);

      store.setRegionForced();
      expect(store.currentScreen).toBe(Screen.RegionSelect);

      store.setRegion('eu');
      expect(store.currentScreen).toBe(Screen.Auth);
    });

    // ── Overlay stack invalidation (audit #5) ──────────────────────
    //
    // The three hard-reset handlers (`setRegionForced`,
    // `resetForFreshStart`, `cancelWizard`) all nuke session state, but
    // they used to leave `router.overlays` untouched. If `Overlay.Mcp`
    // or `Overlay.Slack` was up when the user typed `/region`, the
    // overlay kept rendering against a session whose credentials and
    // org/project were now null — `SlackScreen` swallows the null-token
    // path silently and `McpScreen.installer.detectClients()` would
    // run its zone-scoped installer against the wrong region. The fix
    // wires `router.clearOverlays()` into each reset handler. These
    // tests pin the contract: overlays are gone after the reset, and
    // `currentScreen` resolves to a sensible flow screen — never an
    // orphaned overlay rendering against wiped state.
    it('setRegionForced clears any active overlay so it does not orphan against the wiped session', () => {
      const store = createStore();
      store.concludeIntro();
      store.setRegion('us');
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://api2.amplitude.com',
        appId: 1,
      });
      store.session.selectedOrgName = 'Acme';
      store.session.selectedOrgId = 'org-1';
      store.session.selectedProjectName = 'Amplitude';
      store.session.selectedProjectId = 'ws-1';
      store.session.selectedAppId = 'app-1';

      store.pushOverlay(Overlay.Mcp);
      expect(store.router.hasOverlay).toBe(true);
      expect(store.currentScreen).toBe(Overlay.Mcp);

      store.setRegionForced();

      expect(store.router.hasOverlay).toBe(false);
      // Lands on RegionSelect — the flow's normal /region landing pad —
      // not on the now-orphaned Overlay.Mcp.
      expect(store.currentScreen).toBe(Screen.RegionSelect);
    });

    it('cancelWizard clears any active overlay so Outro is not masked', () => {
      const store = createStore();
      store.concludeIntro();
      store.setRegion('us');
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://api2.amplitude.com',
        appId: 1,
      });
      store.pushOverlay(Overlay.Slack);
      expect(store.router.hasOverlay).toBe(true);

      store.cancelWizard('user pressed esc');

      expect(store.router.hasOverlay).toBe(false);
      // Cancel fast-path: router.resolve sees outroData.kind === Cancel
      // and routes to Outro. Without clearOverlays this would still be
      // Overlay.Slack because overlays beat the fast-path in resolve().
      expect(store.currentScreen).toBe(Screen.Outro);
    });

    it('resetForFreshStart clears any active overlay so the flow restarts cleanly', () => {
      const store = createStore();
      store.concludeIntro();
      store.setRegion('us');
      store.pushOverlay(Overlay.Mcp);
      expect(store.router.hasOverlay).toBe(true);

      store.resetForFreshStart();

      expect(store.router.hasOverlay).toBe(false);
      // intro is reset → first flow screen is Intro again.
      expect(store.currentScreen).toBe(Screen.Intro);
    });
  });

  // ── runSignupAttempt wrapper ──────────────────────────────────────

  describe('runSignupAttempt', () => {
    // The wrapper is the load-bearing piece for the back-nav wall:
    // signupInFlight must be true exactly while the wrapped POST is
    // pending and false otherwise, regardless of whether the call
    // resolves or rejects. Without these tests the contract is only
    // exercised indirectly via SigningUpScreen and a future refactor
    // could silently break it.

    const SIGNUP_INPUT = {
      email: 'ada@example.com',
      fullName: null,
      zone: 'us' as const,
    };

    it('flips signupInFlight true while performSignupOrAuth is pending', async () => {
      const { performSignupOrAuth } = await import(
        '../../../utils/signup-or-auth.js'
      );
      const store = createStore();
      expect(store.session.signupInFlight).toBe(false);

      let release: ((value: never) => void) | null = null;
      const pending = new Promise<never>((_, reject) => {
        release = reject;
      });
      vi.mocked(performSignupOrAuth).mockReturnValueOnce(pending);

      const wrapped = store.runSignupAttempt(SIGNUP_INPUT);

      // Yield so runSignupAttempt's setKey runs before we read the flag.
      await Promise.resolve();
      expect(store.session.signupInFlight).toBe(true);

      release!(new Error('release'));
      await expect(wrapped).rejects.toThrow('release');
      expect(store.session.signupInFlight).toBe(false);
    });

    it('clears signupInFlight after performSignupOrAuth resolves', async () => {
      const { performSignupOrAuth } = await import(
        '../../../utils/signup-or-auth.js'
      );
      const store = createStore();
      vi.mocked(performSignupOrAuth).mockResolvedValueOnce({
        kind: 'redirect',
      } as never);
      const result = await store.runSignupAttempt(SIGNUP_INPUT);
      expect(result.kind).toBe('redirect');
      expect(store.session.signupInFlight).toBe(false);
    });

    it('clears signupInFlight after performSignupOrAuth rejects', async () => {
      const { performSignupOrAuth } = await import(
        '../../../utils/signup-or-auth.js'
      );
      const store = createStore();
      const boom = new Error('boom');
      vi.mocked(performSignupOrAuth).mockRejectedValueOnce(boom);

      await expect(store.runSignupAttempt(SIGNUP_INPUT)).rejects.toBe(boom);
      // try/finally must clear regardless of throw — the wall would
      // otherwise stay stuck-on after a thrown signup attempt.
      expect(store.session.signupInFlight).toBe(false);
    });
  });

  // ── postAgentSteps (FinalizingPanel state) ────────────────────────

  describe('post-agent step queue', () => {
    it('seedPostAgentSteps replaces the queue and emits change', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);
      cb.mockClear();
      store.seedPostAgentSteps([
        {
          id: 'commit-events',
          label: 'Save events',
          activeForm: 'Saving events',
          status: 'pending',
        },
      ]);
      expect(store.session.postAgentSteps).toHaveLength(1);
      expect(store.session.postAgentSteps[0].id).toBe('commit-events');
      expect(cb).toHaveBeenCalled();
    });

    it('setPostAgentStep stamps startedAt on in_progress transition', () => {
      const store = createStore();
      store.seedPostAgentSteps([
        {
          id: 'create-dashboard',
          label: 'Create dashboard',
          activeForm: 'Creating dashboard',
          status: 'pending',
        },
      ]);
      const before = Date.now();
      store.setPostAgentStep('create-dashboard', { status: 'in_progress' });
      const step = store.session.postAgentSteps[0];
      expect(step.status).toBe('in_progress');
      expect(step.startedAt).toBeGreaterThanOrEqual(before);
      expect(step.startedAt).toBeLessThanOrEqual(Date.now());
    });

    it('setPostAgentStep preserves startedAt across status transitions', () => {
      const store = createStore();
      store.seedPostAgentSteps([
        {
          id: 'commit-events',
          label: 'Save events',
          activeForm: 'Saving events',
          status: 'pending',
        },
      ]);
      store.setPostAgentStep('commit-events', { status: 'in_progress' });
      const startedAt = store.session.postAgentSteps[0].startedAt;
      // A subsequent transition shouldn't reset the timer.
      store.setPostAgentStep('commit-events', { status: 'completed' });
      expect(store.session.postAgentSteps[0].startedAt).toBe(startedAt);
    });

    it('setPostAgentStep records skip reason', () => {
      const store = createStore();
      store.seedPostAgentSteps([
        {
          id: 'commit-events',
          label: 'Save events',
          activeForm: 'Saving events',
          status: 'pending',
        },
      ]);
      store.setPostAgentStep('commit-events', {
        status: 'skipped',
        reason: "couldn't resolve project",
      });
      expect(store.session.postAgentSteps[0].status).toBe('skipped');
      expect(store.session.postAgentSteps[0].reason).toBe(
        "couldn't resolve project",
      );
    });

    it('setPostAgentStep is a no-op for unknown ids', () => {
      const store = createStore();
      store.seedPostAgentSteps([
        {
          id: 'commit-events',
          label: 'Save events',
          activeForm: 'Saving events',
          status: 'pending',
        },
      ]);
      const cb = vi.fn();
      store.subscribe(cb);
      cb.mockClear();
      store.setPostAgentStep('does-not-exist', { status: 'completed' });
      expect(cb).not.toHaveBeenCalled();
      expect(store.session.postAgentSteps[0].status).toBe('pending');
    });
  });

  // ── resetForFreshStart (IntroScreen "Start fresh" branch) ───────

  describe('resetForFreshStart', () => {
    it('clears every field IntroScreen used to wipe via direct assignment', () => {
      const store = createStore();
      // Walk into a checkpoint-restored state with everything populated.
      store.session._restoredFromCheckpoint = true;
      store.session.introConcluded = true;
      store.session.detectionComplete = true;
      store.session.detectedFrameworkLabel = 'Next.js';
      store.session.integration = Integration.nextjs;
      store.session.frameworkConfig = { metadata: { name: 'Next.js' } } as any;
      store.session.frameworkContext = { foo: 'bar' } as any;
      store.session.region = 'us';
      store.session.selectedOrgId = 'org-1';
      store.session.selectedOrgName = 'Acme';
      store.session.selectedProjectId = 'ws-1';
      store.session.selectedProjectName = 'Amplitude';
      store.session.selectedEnvName = 'production';

      store.resetForFreshStart();

      expect(store.session._restoredFromCheckpoint).toBe(false);
      expect(store.session.introConcluded).toBe(false);
      expect(store.session.detectionComplete).toBe(false);
      expect(store.session.detectedFrameworkLabel).toBeNull();
      expect(store.session.integration).toBeNull();
      expect(store.session.frameworkConfig).toBeNull();
      expect(store.session.frameworkContext).toEqual({});
      expect(store.session.region).toBeNull();
      expect(store.session.selectedOrgId).toBeNull();
      expect(store.session.selectedOrgName).toBeNull();
      expect(store.session.selectedProjectId).toBeNull();
      expect(store.session.selectedProjectName).toBeNull();
      expect(store.session.selectedEnvName).toBeNull();
    });

    it('notifies subscribers (emits change)', () => {
      const store = createStore();
      const listener = vi.fn();
      store.subscribe(listener);
      const before = store.getVersion();

      store.resetForFreshStart();

      expect(listener).toHaveBeenCalled();
      expect(store.getVersion()).toBeGreaterThan(before);
    });
  });

  describe('backToWelcome', () => {
    it('is a no-op when regionForced', () => {
      const store = createStore();
      store.session.introConcluded = true;
      store.session.regionForced = true;
      store.session.region = 'us';

      store.backToWelcome();

      expect(store.session.introConcluded).toBe(true);
      expect(store.session.region).toBe('us');
    });

    it('rewinds intro and region and clears create-account draft', () => {
      const store = createStore();
      store.session.authOnboardingPath = AuthOnboardingPath.CreateAccount;
      store.session.introConcluded = true;
      store.session.region = 'eu';
      store.session.tosAccepted = false;
      store.session.signupEmail = 'x@y.co';
      store.session.signupFullName = 'X Y';
      store.session.signupTokensObtained = true;
      // Pre-seed ceremony state that a real session might have at the
      // moment the user hits Esc back to Welcome — server returned
      // needs_information, signupAuth never settled, signupAbandoned
      // false. backToWelcome must clear all three so the next forward
      // pass through the create-account section starts fresh.
      store.session.signupRequiredFields = ['full_name'];
      store.session.signupAuth = null;
      store.session.signupAbandoned = false;

      store.backToWelcome();

      expect(store.session.introConcluded).toBe(false);
      expect(store.session.region).toBeNull();
      expect(store.session.tosAccepted).toBeNull();
      expect(store.session.signupEmail).toBeNull();
      expect(store.session.signupFullName).toBeNull();
      expect(store.session.signupTokensObtained).toBe(false);
      // Ceremony state must be wiped — mirroring `setSignupEmail(null)`'s
      // contract. Without this, a second-time-around user re-typing the
      // same email would skip the probe POST and consume the cached
      // needs_information response.
      expect(store.session.signupRequiredFields).toBeNull();
      expect(store.session.signupAuth).toBeNull();
      expect(store.session.signupAbandoned).toBe(false);
      expect(wizardCaptureMock).toHaveBeenCalledWith('back navigation', {
        to: 'welcome',
      });
    });

    it('clears ceremony state populated by a successful signup before backToWelcome', () => {
      // Edge case the bound-to-setSignupEmail contract was meant to
      // catch: signup succeeded (signupAuth populated, server account
      // exists), user hits Esc back to Welcome before the auth task
      // finishes resolving creds. Without the ceremony reset, the next
      // forward pass would release the auth gate on stale tokens.
      const store = createStore();
      store.session.authOnboardingPath = AuthOnboardingPath.CreateAccount;
      store.session.introConcluded = true;
      store.session.region = 'us';
      store.session.signupEmail = 'ada@example.com';
      store.session.signupFullName = 'Ada Lovelace';
      store.session.signupRequiredFields = ['full_name'];
      store.session.signupAuth = {
        idToken: 'i',
        accessToken: 'a',
        refreshToken: 'r',
        zone: 'us',
        userInfo: null,
        dashboardUrl: null,
      };

      store.backToWelcome();

      expect(store.session.signupRequiredFields).toBeNull();
      expect(store.session.signupAuth).toBeNull();
      expect(store.session.signupAbandoned).toBe(false);
    });

    it('keeps create-account onboarding path after rewind', () => {
      const store = createStore();
      store.session.authOnboardingPath = AuthOnboardingPath.CreateAccount;
      store.session.introConcluded = true;
      store.session.region = 'us';

      store.backToWelcome();

      expect(store.session.authOnboardingPath).toBe(
        AuthOnboardingPath.CreateAccount,
      );
    });

    it('sets lastNavDirection to pop so back transitions animate correctly', () => {
      const store = createStore();
      store.session.introConcluded = true;
      store.session.region = 'us';

      store.backToWelcome();

      expect(store.lastNavDirection).toBe('pop');
    });
  });

  // ── Setter analytics events ────────────────────────────────────

  describe('setter analytics events', () => {
    it('completeSetup fires setup confirmed event', () => {
      const store = createStore();
      store.completeSetup();
      expect(wizardCaptureMock).toHaveBeenCalledWith(
        'setup confirmed',
        expect.any(Object),
      );
    });

    it('setCredentials fires auth complete event', () => {
      const store = createStore();
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        appId: 42,
      });
      // region resolves via resolveZone → falls to DEFAULT_AMPLITUDE_ZONE
      // since the test session has no intent, ampli.json, or stored user.
      expect(wizardCaptureMock).toHaveBeenCalledWith('auth complete', {
        'app id': 42,
        region: 'us',
      });
    });

    it('setCredentials identifies user by email when userEmail is set', () => {
      const store = createStore();
      store.session.userEmail = 'ada@example.com';
      store.session.selectedOrgId = 'org-1';
      store.session.selectedOrgName = 'Acme';
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        appId: 42,
      });
      expect(analytics.setDistinctId).toHaveBeenCalledWith('ada@example.com');
      expect(analytics.identifyUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'ada@example.com',
          org_id: 'org-1',
          org_name: 'Acme',
          app_id: 42,
        }),
      );
    });

    it('setCredentials skips identify when userEmail is null', () => {
      const store = createStore();
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        appId: 42,
      });
      expect(analytics.setDistinctId).not.toHaveBeenCalled();
      expect(analytics.identifyUser).not.toHaveBeenCalled();
    });

    it('setFrameworkConfig identifies user with integration', () => {
      const store = createStore();
      const config = {
        metadata: { name: 'Next.js' },
      } as WizardStore['session']['frameworkConfig'];
      store.setFrameworkConfig(Integration.nextjs, config);
      expect(analytics.identifyUser).toHaveBeenCalledWith({
        integration: Integration.nextjs,
      });
    });

    it('enableFeature fires feature enabled event', () => {
      const store = createStore();
      store.enableFeature(AdditionalFeature.LLM);
      expect(wizardCaptureMock).toHaveBeenCalledWith('feature enabled', {
        feature: AdditionalFeature.LLM,
        source: 'picklist',
      });
    });

    it('setMcpComplete fires mcp complete event', () => {
      const store = createStore();
      store.setMcpComplete(McpOutcome.Installed, ['Cursor', 'VS Code']);
      expect(wizardCaptureMock).toHaveBeenCalledWith(
        'mcp complete',
        expect.objectContaining({
          'mcp outcome': McpOutcome.Installed,
          'mcp installed clients': ['Cursor', 'VS Code'],
        }),
      );
    });
  });

  // ── Screen resolution (derived state) ────────────────────────────

  // Helper: advance store to RunScreen (past Intro → RegionSelect → Auth → DataSetup)
  function advanceToRun(store: ReturnType<typeof createStore>) {
    // Intro: conclude intro (Intro screen isComplete)
    store.concludeIntro();
    // RegionSelect: set region (skips it)
    store.setRegion('us');
    // Auth: set credentials + org/project/env (Auth screen isComplete
    // requires all four: credentials and all three names)
    store.setCredentials({
      accessToken: 'tok',
      projectApiKey: 'pk',
      host: 'h',
      appId: 1,
    });
    // Set org/project/env names directly to satisfy Auth.isComplete
    // (it only checks names, not IDs — so we don't have to set IDs and
    // trigger setOrgAndProject's ampli.json write).
    store.session.selectedOrgName = 'Acme';
    store.session.selectedProjectName = 'Amplitude';
    store.setSelectedEnvName('Production');
    // DataSetup: set projectHasData (DataSetup screen isComplete)
    store.setProjectHasData(false);
  }

  describe('currentScreen', () => {
    it('starts at intro for Wizard flow', () => {
      const store = createStore();
      expect(store.currentScreen).toBe(Screen.Intro);
    });

    it('advances to intro after credentials, region, and projectHasData are set', () => {
      const store = createStore();
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        appId: 1,
      });
      store.setRegion('us');
      store.setProjectHasData(false);
      expect(store.currentScreen).toBe(Screen.Intro);
    });

    it('advances to run after completing the intro screen', () => {
      const store = createStore();
      advanceToRun(store);
      expect(store.currentScreen).toBe(Screen.Run);
    });

    it('advances to mcp after run completes', () => {
      const store = createStore();
      advanceToRun(store);
      store.setRunPhase(RunPhase.Completed);
      expect(store.currentScreen).toBe(Screen.Mcp);
    });

    it('advances to data ingestion check after mcp completes', () => {
      const store = createStore();
      advanceToRun(store);
      store.setRunPhase(RunPhase.Completed);
      store.setMcpComplete();
      expect(store.currentScreen).toBe(Screen.DataIngestionCheck);
    });

    it('advances to checklist after data ingestion confirmed', () => {
      const store = createStore();
      advanceToRun(store);
      store.setRunPhase(RunPhase.Completed);
      store.setMcpComplete();
      store.setDataIngestionConfirmed();
      expect(store.currentScreen).toBe(Screen.Slack);
    });

    it('advances to outro after slack completes', () => {
      const store = createStore();
      advanceToRun(store);
      store.setRunPhase(RunPhase.Completed);
      store.setMcpComplete();
      store.setDataIngestionConfirmed();
      store.setSlackComplete();
      expect(store.currentScreen).toBe(Screen.Outro);
    });

    it('starts at McpAdd for McpAdd flow', () => {
      const store = createStore(Flow.McpAdd);
      expect(store.currentScreen).toBe(Screen.McpAdd);
    });

    it('starts at McpRemove for McpRemove flow', () => {
      const store = createStore(Flow.McpRemove);
      expect(store.currentScreen).toBe(Screen.McpRemove);
    });
  });

  // ── Overlay navigation ───────────────────────────────────────────

  describe('overlay navigation', () => {
    it('pushOverlay shows the overlay over the current screen', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);
      expect(store.currentScreen).toBe(Overlay.Outage);
    });

    it('popOverlay returns to the underlying screen', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);
      store.popOverlay();
      expect(store.currentScreen).toBe(Screen.Intro);
    });

    it('pushOverlay emits change and increments version', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.pushOverlay(Overlay.Outage);

      expect(cb).toHaveBeenCalledTimes(1);
      expect(store.getVersion()).toBe(1);
    });

    it('popOverlay emits change and increments version', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);

      const cb = vi.fn();
      store.subscribe(cb);
      store.popOverlay();

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('pushOverlay sets direction to push', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);
      expect(store.lastNavDirection).toBe('push');
    });

    it('popOverlay sets direction to pop', () => {
      const store = createStore();
      store.pushOverlay(Overlay.Outage);
      store.popOverlay();
      expect(store.lastNavDirection).toBe('pop');
    });
  });

  // ── Agent observation state ──────────────────────────────────────

  describe('statusMessages', () => {
    it('pushStatus appends messages', () => {
      const store = createStore();
      store.pushStatus('Installing SDK...');
      store.pushStatus('Configuring...');
      expect(store.statusMessages).toEqual([
        'Installing SDK...',
        'Configuring...',
      ]);
    });

    it('pushStatus emits change', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.pushStatus('msg');
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('tasks', () => {
    it('setTasks replaces the task list', () => {
      const store = createStore();
      const tasks = [
        { label: 'Install SDK', status: TaskStatus.Pending, done: false },
        { label: 'Configure', status: TaskStatus.Pending, done: false },
      ];
      store.setTasks(tasks);
      expect(store.tasks).toEqual(tasks);
    });

    it('updateTask marks a task as done', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Install SDK', status: TaskStatus.Pending, done: false },
      ]);

      store.updateTask(0, true);

      expect(store.tasks[0].done).toBe(true);
      expect(store.tasks[0].status).toBe(TaskStatus.Completed);
    });

    it('updateTask marks a task as not done', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Install SDK', status: TaskStatus.Completed, done: true },
      ]);

      store.updateTask(0, false);

      expect(store.tasks[0].done).toBe(false);
      expect(store.tasks[0].status).toBe(TaskStatus.Pending);
    });

    it('updateTask is a no-op for out-of-bounds index', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Install SDK', status: TaskStatus.Pending, done: false },
      ]);

      const cb = vi.fn();
      store.subscribe(cb);
      store.updateTask(99, true);

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('applyJourneyTransition', () => {
    // The 4-step user-visible journey is driven by deterministic tool-call
    // signals classified in `src/lib/journey-state.ts`. These tests pin
    // the store-side semantics: a transition updates the named step's
    // status, applies a monotonic guard (completed steps cannot regress),
    // and the renderer cascades earlier steps to completed when a later
    // step advances (sequential ordering invariant).
    //
    // History: a fifth `dashboard` step lived here until DEFER_DASHBOARD_PLAN
    // PR 4 — chart and dashboard creation moved to the deferred
    // `amplitude-wizard dashboard` command. Wire is now the terminal step
    // and is flipped to completed by the agent-runner post-loop boundary
    // rather than by a downstream cascade.

    it('renders exactly the four canonical steps from frame 1', () => {
      const store = createStore();
      store.applyJourneyTransition('install', 'in_progress');

      expect(store.tasks).toHaveLength(4);
      expect(store.tasks.map((t) => t.label)).toEqual([
        'Detect your project setup',
        'Install Amplitude',
        'Plan and approve events to track',
        'Wire up event tracking',
      ]);
    });

    it('marks the named step in_progress and earlier steps completed', () => {
      const store = createStore();
      store.applyJourneyTransition('install', 'in_progress');

      expect(store.tasks[0].status).toBe(TaskStatus.Completed); // detect
      expect(store.tasks[1].status).toBe(TaskStatus.InProgress); // install
      expect(store.tasks[2].status).toBe(TaskStatus.Pending); // plan
    });

    it('optimistic detect transition surfaces in_progress immediately on RunScreen mount', () => {
      // S1 — When RunScreen mounts the wizard fires
      // applyJourneyTransition('detect', 'in_progress') so the canonical
      // task list shows movement (active glyph on row 0) from frame 1
      // instead of sitting at "0 done · 4 to go" with every row dim until
      // the agent's first TodoWrite (~30s into cold start). This test
      // pins the rendered shape so a regression in the renderer cascade
      // can't silently break the optimistic-mount UX.
      const store = createStore();
      store.applyJourneyTransition('detect', 'in_progress');

      expect(store.tasks).toHaveLength(4);
      expect(store.tasks[0].status).toBe(TaskStatus.InProgress); // detect
      expect(store.tasks[1].status).toBe(TaskStatus.Pending); // install
      expect(store.tasks[2].status).toBe(TaskStatus.Pending); // plan
      expect(store.tasks[3].status).toBe(TaskStatus.Pending); // wire
    });

    it('cascades earlier steps to completed when a later step advances', () => {
      // Same invariant as PR-A's "skips ahead" case, now derived from
      // a deterministic tool call rather than a TodoWrite string.
      const store = createStore();
      store.applyJourneyTransition('wire', 'in_progress');

      expect(store.tasks[0].status).toBe(TaskStatus.Completed);
      expect(store.tasks[1].status).toBe(TaskStatus.Completed);
      expect(store.tasks[2].status).toBe(TaskStatus.Completed);
      expect(store.tasks[3].status).toBe(TaskStatus.InProgress);
    });

    it('flips wire to completed when explicitly transitioned (terminal step)', () => {
      // Wire is terminal post-DEFER_DASHBOARD_PLAN PR 4 — there is no
      // downstream step to cascade-roll it into completed. The
      // agent-runner post-loop calls applyJourneyTransition('wire',
      // 'completed') directly once the agent stream ends and events.json
      // is on disk; the renderer must mark it Completed.
      const store = createStore();
      store.applyJourneyTransition('wire', 'in_progress');
      store.applyJourneyTransition('wire', 'completed');

      expect(store.tasks[3].status).toBe(TaskStatus.Completed);
    });

    it('promotes a stale in_progress step to completed when a later step is also in_progress', () => {
      // The classifier emits per-tool-call transitions; nothing
      // prevents `install: in_progress` from sitting in derived state
      // when `wire: in_progress` later fires (no explicit "install
      // completed" tool call ever lands — install completion is
      // implicit via the sequential cascade).
      //
      // The user-visible list MUST stay single-in_progress: the older
      // in_progress is stale and must render as Completed, even though
      // it's still in the derived map as `in_progress`.
      const store = createStore();
      store.applyJourneyTransition('install', 'in_progress');
      store.applyJourneyTransition('wire', 'in_progress');

      expect(store.tasks[0].status).toBe(TaskStatus.Completed); // detect (cascade)
      expect(store.tasks[1].status).toBe(TaskStatus.Completed); // install (was in_progress, cascaded)
      expect(store.tasks[2].status).toBe(TaskStatus.Completed); // plan (cascade)
      expect(store.tasks[3].status).toBe(TaskStatus.InProgress); // wire (frontier)
    });

    it('forces monotonic progress — completed steps cannot regress', () => {
      // Retry scenario: a stale tool call replays after a step has been
      // verified completed. The store ignores the demotion.
      const store = createStore();
      store.applyJourneyTransition('install', 'completed');
      store.applyJourneyTransition('install', 'in_progress');

      expect(store.tasks[1].status).toBe(TaskStatus.Completed);
    });

    it('is idempotent — re-applying the same transition is a no-op', () => {
      const store = createStore();
      const cb = vi.fn();
      store.applyJourneyTransition('install', 'in_progress');
      store.subscribe(cb);
      store.applyJourneyTransition('install', 'in_progress');
      expect(cb).not.toHaveBeenCalled();
    });

    it('emits change for every effective transition', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);
      store.applyJourneyTransition('install', 'in_progress');
      store.applyJourneyTransition('install', 'completed');
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });

  describe('syncTodos', () => {
    // syncTodos refreshes the `activeForm` flavor text beside each
    // canonical step AND forwards the agent's authoritative status
    // (`in_progress` / `completed`) to `applyJourneyTransition`, which
    // owns the monotonic guard. The list is always rendered as the
    // canonical 4 rows, regardless of TodoWrite content.

    it('renders exactly the four canonical steps', () => {
      const store = createStore();
      store.syncTodos([
        { content: 'Install Amplitude', status: 'in_progress' },
      ]);

      expect(store.tasks).toHaveLength(4);
      expect(store.tasks.map((t) => t.label)).toEqual([
        'Detect your project setup',
        'Install Amplitude',
        'Plan and approve events to track',
        'Wire up event tracking',
      ]);
    });

    it('forwards status=in_progress from TodoWrite to applyJourneyTransition', () => {
      const store = createStore();
      store.syncTodos([
        {
          content: 'Detect your project setup',
          status: 'in_progress',
          activeForm: 'Detecting…',
        },
      ]);

      // The agent's explicit signal flips the canonical step.
      expect(store.tasks[0].status).toBe(TaskStatus.InProgress);
    });

    it('forwards status=completed from TodoWrite to applyJourneyTransition', () => {
      const store = createStore();
      store.syncTodos([{ content: 'Install Amplitude', status: 'completed' }]);

      expect(store.tasks[1].status).toBe(TaskStatus.Completed);
    });

    it('ignores TodoWrite statuses other than in_progress / completed', () => {
      const store = createStore();
      store.syncTodos([{ content: 'Install Amplitude', status: 'pending' }]);
      store.syncTodos([{ content: 'Install Amplitude', status: 'cancelled' }]);

      expect(store.tasks.every((t) => t.status === TaskStatus.Pending)).toBe(
        true,
      );
    });

    it('monotonic guard prevents completed → in_progress regression from TodoWrite', () => {
      const store = createStore();
      store.syncTodos([{ content: 'Install Amplitude', status: 'completed' }]);
      expect(store.tasks[1].status).toBe(TaskStatus.Completed);

      // A subsequent TodoWrite restating the step as in_progress must
      // not demote it — applyJourneyTransition's guard owns this.
      store.syncTodos([
        { content: 'Install Amplitude', status: 'in_progress' },
      ]);
      expect(store.tasks[1].status).toBe(TaskStatus.Completed);
    });

    it('updates the matched step activeForm so the user sees current narration', () => {
      const store = createStore();
      store.applyJourneyTransition('install', 'in_progress');
      store.syncTodos([
        {
          content: 'Install Amplitude',
          status: 'in_progress',
          activeForm: 'Installing project dependencies',
        },
      ]);

      expect(store.tasks[1].activeForm).toBe('Installing project dependencies');
    });

    it('drops todos that do not exactly match a canonical label', () => {
      const store = createStore();
      store.applyJourneyTransition('install', 'in_progress');
      store.syncTodos([
        {
          content: 'Install Amplitude SDK',
          status: 'in_progress',
          activeForm: 'Installing extra thing',
        },
      ]);

      // Drift label dropped; activeForm falls back to the canonical default.
      expect(store.tasks[1].activeForm).toBe('Installing Amplitude');
    });

    it('emits change', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);
      store.syncTodos([{ content: 'Install Amplitude', status: 'pending' }]);
      expect(cb).toHaveBeenCalled();
    });
  });

  // ── Navigation direction ─────────────────────────────────────────

  describe('lastNavDirection', () => {
    it('starts as null', () => {
      const store = createStore();
      expect(store.lastNavDirection).toBeNull();
    });

    it('is set to push on emitChange', () => {
      const store = createStore();
      store.emitChange();
      expect(store.lastNavDirection).toBe('push');
    });
  });

  // ── Concurrent / rapid-fire mutations ─────────────────────────────

  describe('concurrent mutations', () => {
    it('rapid-fire setters each increment version by 1', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);

      store.completeSetup();
      store.setRunPhase(RunPhase.Running);
      store.pushStatus('msg1');
      store.pushStatus('msg2');
      store.setDetectedFramework('React');

      expect(store.getVersion()).toBe(5);
      expect(cb).toHaveBeenCalledTimes(5);
    });

    it('subscriber sees consistent state during a setter call', () => {
      const store = createStore();
      const snapshots: { confirmed: boolean; version: number }[] = [];

      store.subscribe(() => {
        snapshots.push({
          confirmed: store.session.setupConfirmed,
          version: store.getSnapshot(),
        });
      });

      store.completeSetup();

      expect(snapshots).toEqual([{ confirmed: true, version: 1 }]);
    });

    it('multiple subscribers all see the same state', () => {
      const store = createStore();
      const results: number[] = [];

      store.subscribe(() => results.push(store.getSnapshot()));
      store.subscribe(() => results.push(store.getSnapshot()));
      store.subscribe(() => results.push(store.getSnapshot()));

      store.completeSetup();

      // All 3 subscribers should see version 1
      expect(results).toEqual([1, 1, 1]);
    });

    it('subscriber that mutates store during notification triggers additional notifications', () => {
      const store = createStore();
      const versions: number[] = [];

      // First subscriber triggers another mutation
      store.subscribe(() => {
        versions.push(store.getSnapshot());
        if (
          store.session.setupConfirmed &&
          store.session.runPhase === RunPhase.Idle
        ) {
          store.setRunPhase(RunPhase.Running);
        }
      });

      store.completeSetup();

      // Should see version 1 (from completeSetup) and version 2 (from setRunPhase)
      expect(versions).toEqual([1, 2]);
      expect(store.session.runPhase).toBe(RunPhase.Running);
    });

    it('interleaved overlay and session mutations are all visible', () => {
      const store = createStore();
      const screens: string[] = [];

      // Advance past Intro so the underlying screen is RegionSelect → then Auth → DataSetup
      store.concludeIntro();

      store.subscribe(() => {
        screens.push(store.currentScreen);
      });

      store.pushOverlay(Overlay.Outage); // -> outage
      // Org/project/env names are required for Auth.isComplete. Assign
      // directly so subscribers only fire for the three explicit mutations
      // this test is exercising (setCredentials, setRegion, popOverlay).
      // Only names — IDs intentionally omitted to avoid setRegion below
      // triggering an ampli.json write.
      store.session.selectedOrgName = 'Acme';
      store.session.selectedProjectName = 'Amplitude';
      store.session.selectedEnvName = 'Production';
      store.setCredentials({
        // -> outage (overlay still on top)
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'h',
        appId: 1,
      });
      store.setRegion('us'); // -> outage (overlay still on top)
      store.popOverlay(); // -> data-setup (next incomplete screen after credentials+region)

      expect(screens).toEqual([
        Overlay.Outage,
        Overlay.Outage,
        Overlay.Outage,
        Screen.DataSetup,
      ]);
    });

    it('unsubscribing mid-notification does not affect other subscribers', () => {
      const store = createStore();
      const log: string[] = [];

      store.subscribe(() => {
        log.push('sub1');
      });

      const unsub2 = store.subscribe(() => {
        log.push('sub2');
      });

      store.subscribe(() => {
        log.push('sub3');
      });

      store.emitChange();
      expect(log).toEqual(['sub1', 'sub2', 'sub3']);

      // Unsub the second listener
      unsub2();
      log.length = 0;
      store.emitChange();
      expect(log).toEqual(['sub1', 'sub3']);
    });
  });

  // ── Multiple subscribers ─────────────────────────────────────────

  describe('multiple subscribers', () => {
    it('supports many concurrent subscribers', () => {
      const store = createStore();
      const callbacks = Array.from({ length: 50 }, () => vi.fn());
      const unsubs = callbacks.map((cb) => store.subscribe(cb));

      store.emitChange();

      callbacks.forEach((cb) => expect(cb).toHaveBeenCalledTimes(1));

      // Unsubscribe all
      unsubs.forEach((unsub) => unsub());
      store.emitChange();

      // No more notifications
      callbacks.forEach((cb) => expect(cb).toHaveBeenCalledTimes(1));
    });

    it('double-unsubscribe is safe', () => {
      const store = createStore();
      const cb = vi.fn();
      const unsub = store.subscribe(cb);

      unsub();
      unsub(); // should not throw

      store.emitChange();
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('setFrameworkContext overwrites existing keys', () => {
      const store = createStore();
      store.setFrameworkContext('key', 'value1');
      store.setFrameworkContext('key', 'value2');
      expect(store.session.frameworkContext['key']).toBe('value2');
    });

    it('setFrameworkConfig with null integration and config', () => {
      const store = createStore();
      store.setFrameworkConfig(null, null);
      expect(store.session.integration).toBeNull();
      expect(store.session.frameworkConfig).toBeNull();
    });

    it('pushStatus with empty string', () => {
      const store = createStore();
      store.pushStatus('');
      expect(store.statusMessages).toEqual(['']);
    });

    it('syncTodos with empty array seeds the canonical 4 as pending', () => {
      // The user-visible list is locked to the canonical 4. With no
      // derived journey state and an empty TodoWrite, all 4 rows still
      // render so the user sees the journey ahead.
      const store = createStore();
      store.syncTodos([]);

      expect(store.tasks).toHaveLength(4);
      expect(store.tasks.every((t) => t.status === TaskStatus.Pending)).toBe(
        true,
      );
    });

    it('syncTodos with empty / unrecognised status leaves every step pending', () => {
      const store = createStore();
      store.syncTodos([{ content: 'Install Amplitude', status: '' }]);
      // syncTodos forwards in_progress / completed only; an empty
      // status string is ignored, so every step stays pending.
      expect(store.tasks.every((t) => t.status === TaskStatus.Pending)).toBe(
        true,
      );
    });

    it('updateTask with negative index is a no-op', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Task', status: TaskStatus.Pending, done: false },
      ]);
      const cb = vi.fn();
      store.subscribe(cb);
      store.updateTask(-1, true);
      expect(cb).not.toHaveBeenCalled();
    });

    it('popOverlay on empty stack does not crash', () => {
      const store = createStore();
      expect(() => store.popOverlay()).not.toThrow();
      expect(store.currentScreen).toBe(Screen.Intro);
    });

    it('screen advances to mcp on RunPhase.Error (Mcp screen is shown; skipped on error would show outro)', () => {
      const store = createStore();
      advanceToRun(store);
      store.setRunPhase(RunPhase.Error);
      // Run is "complete" (either Completed or Error), so we advance to Mcp.
      // Mcp's show predicate: runPhase !== Error → false, so Mcp is hidden → Outro
      expect(store.currentScreen).toBe(Screen.Outro);
    });

    it('completeSetup can only resolve the promise once', async () => {
      const store = createStore();
      store.completeSetup();
      store.completeSetup(); // second call — promise already resolved

      await store.setupComplete;
      expect(store.session.setupConfirmed).toBe(true);
    });

    it('version property (string) is independent from internal _version counter', () => {
      const store = createStore();
      store.version = '1.2.3';
      expect(store.version).toBe('1.2.3');
      expect(store.getVersion()).toBe(0);

      store.emitChange();
      expect(store.version).toBe('1.2.3');
      expect(store.getVersion()).toBe(1);
    });
  });

  // ── Full wizard flow simulation ──────────────────────────────────

  describe('full wizard flow', () => {
    it('walks through the entire wizard flow correctly', () => {
      const store = createStore();
      const screenHistory: string[] = [];
      store.subscribe(() => screenHistory.push(store.currentScreen));

      // Flow starts at Intro (new first screen)
      expect(store.currentScreen).toBe(Screen.Intro);

      // Step 1: Conclude intro (advances to RegionSelect)
      store.concludeIntro();
      expect(store.currentScreen).toBe(Screen.RegionSelect);

      // Step 2: Select region (before OAuth)
      store.setRegion('us');
      expect(store.currentScreen).toBe(Screen.Auth);

      // Step 3: Authenticate (credentials set by AuthScreen SUSI flow).
      // Org/project/env are resolved as part of the SUSI flow too; set them
      // directly (no setter) so Auth.isComplete passes without bumping the
      // version counter this test asserts on. Only names — Auth.isComplete
      // checks names, not IDs, and omitting IDs avoids side effects.
      store.session.selectedOrgName = 'Acme';
      store.session.selectedProjectName = 'Amplitude';
      store.session.selectedEnvName = 'Production';
      store.setCredentials({
        accessToken: 'tok',
        projectApiKey: 'pk',
        host: 'https://app.amplitude.com',
        appId: 1,
      });
      expect(store.currentScreen).toBe(Screen.DataSetup);

      // Step 4: DataSetup advances to Run
      store.setProjectHasData(false);
      expect(store.currentScreen).toBe(Screen.Run);

      // Step 5: Start and complete run
      store.setRunPhase(RunPhase.Running);
      expect(store.currentScreen).toBe(Screen.Run);

      store.setRunPhase(RunPhase.Completed);
      expect(store.currentScreen).toBe(Screen.Mcp);

      // Step 6: Complete MCP
      store.setMcpComplete();
      expect(store.currentScreen).toBe(Screen.DataIngestionCheck);

      // Step 7: Confirm data ingestion — advances directly to Slack
      store.setDataIngestionConfirmed();
      expect(store.currentScreen).toBe(Screen.Slack);

      // Step 8: Complete Slack
      store.setSlackComplete();
      expect(store.currentScreen).toBe(Screen.Outro);

      // Verify version was bumped for each setter call (9 setters above)
      expect(store.getVersion()).toBe(9);
    });
  });

  // ── setupComplete promise ────────────────────────────────────────

  describe('setupComplete', () => {
    it('resolves when completeSetup is called', async () => {
      const store = createStore();
      store.completeSetup();
      await store.setupComplete;
      expect(store.session.setupConfirmed).toBe(true);
    });

    it('is a promise that can be awaited before completeSetup is called', async () => {
      const store = createStore();

      let resolved = false;
      void store.setupComplete.then(() => {
        resolved = true;
      });

      // Not yet resolved
      await Promise.resolve(); // flush microtasks
      expect(resolved).toBe(false);

      store.completeSetup();
      await store.setupComplete;
      expect(resolved).toBe(true);
    });
  });

  // ── outroDismissed promise (graceful error outro) ────────────────

  describe('outroDismissed / signalOutroDismissed', () => {
    it('resolves when signalOutroDismissed is called', async () => {
      const store = createStore();

      let resolved = false;
      void store.outroDismissed().then(() => {
        resolved = true;
      });

      // Not yet resolved
      await Promise.resolve();
      expect(resolved).toBe(false);

      store.signalOutroDismissed();
      await store.outroDismissed();
      expect(resolved).toBe(true);
    });

    it('returns the same promise for multiple awaiters before dismissal', () => {
      const store = createStore();

      const p1 = store.outroDismissed();
      const p2 = store.outroDismissed();
      expect(p1).toBe(p2);

      store.signalOutroDismissed();
      // Both awaiters resolve via the shared promise; nothing else to assert.
    });

    it('handles dismissal arriving before any awaiter (pre-resolved)', async () => {
      const store = createStore();

      // Dismissal fires first
      store.signalOutroDismissed();

      // Then someone awaits — should resolve immediately
      let resolved = false;
      await store.outroDismissed().then(() => {
        resolved = true;
      });
      expect(resolved).toBe(true);
    });

    it('is idempotent — extra signalOutroDismissed calls are no-ops', () => {
      const store = createStore();

      // Multiple calls should not throw or break the promise mechanism
      expect(() => {
        store.signalOutroDismissed();
        store.signalOutroDismissed();
        store.signalOutroDismissed();
      }).not.toThrow();
    });
  });

  // ── Back-navigation reset helpers ────────────────────────────────
  // Each pre-Run reset helper must clear post-Run state so the router
  // doesn't short-circuit past the agent run / outro after a back-nav.
  describe('back-navigation reset helpers', () => {
    /** Seed a store as if the user had completed a full run. */
    function seedPostRunState(store: WizardStore): void {
      store.setRunPhase(RunPhase.Completed);
      store.setMcpComplete(McpOutcome.Installed, ['Cursor']);
      store.setOutroData({ kind: OutroKind.Success, message: 'Done' });
      // Direct field writes via internal store for fields without setters
      // to mirror end-of-run state shape.
      const internal = store as unknown as {
        $session: {
          setKey: (k: string, v: unknown) => void;
        };
      };
      internal.$session.setKey('slackComplete', true);
      internal.$session.setKey('dataIngestionConfirmed', true);
      internal.$session.setKey('optInFeaturesComplete', true);
      internal.$session.setKey('additionalFeatureQueue', [
        AdditionalFeature.SessionReplay,
      ]);
      internal.$session.setKey('additionalFeatureCompleted', [
        AdditionalFeature.SessionReplay,
      ]);
    }

    /** Assert post-run state has been wiped back to defaults. */
    function expectPostRunCleared(store: WizardStore): void {
      expect(store.session.runPhase).toBe(RunPhase.Idle);
      expect(store.session.runStartedAt).toBeNull();
      expect(store.session.outroData).toBeNull();
      expect(store.session.mcpComplete).toBe(false);
      expect(store.session.mcpOutcome).toBeNull();
      expect(store.session.mcpInstalledClients).toEqual([]);
      expect(store.session.slackComplete).toBe(false);
      expect(store.session.slackOutcome).toBeNull();
      expect(store.session.dataIngestionConfirmed).toBe(false);
      expect(store.session.optInFeaturesComplete).toBe(false);
      expect(store.session.additionalFeatureQueue).toEqual([]);
      expect(store.session.additionalFeatureCurrent).toBeNull();
      expect(store.session.additionalFeatureCompleted).toEqual([]);
    }

    it('resetAuthForRegionChange clears post-run state', () => {
      const store = createStore();
      seedPostRunState(store);
      store.resetAuthForRegionChange();
      expectPostRunCleared(store);
      // Plus its own primary effects.
      expect(store.session.region).toBeNull();
      expect(store.session.regionForced).toBe(true);
      expect(store.session.credentials).toBeNull();
      expect(store.session.pendingOrgs).toBeNull();
      expect(store.session.selectedOrgId).toBeNull();
    });

    it('resetAuthForRegionChange wipes signup ceremony state', () => {
      // Same zone-scoping reasoning as setRegionForced: signupAuth.zone
      // is pinned to the old region, signupRequiredFields cached the
      // old zone's probe response. Funnel ceremony reset through the
      // shared helper so the invariant holds across every reset path.
      const store = createStore();
      store.session.signupEmail = 'ada@example.com';
      store.session.signupFullName = 'Ada Lovelace';
      store.session.tosAccepted = true;
      store.session.signupRequiredFields = ['full_name', 'terms_acceptance'];
      store.session.legalDocumentBundle = {
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      };
      store.session.legalDocumentSource = 'local';
      store.session.signupAbandoned = false;
      store.session.signupTokensObtained = true;
      store.session.signupAuth = {
        idToken: 'i',
        accessToken: 'a',
        refreshToken: 'r',
        zone: 'us',
        userInfo: null,
        dashboardUrl: null,
      };

      store.resetAuthForRegionChange();

      expect(store.session.signupEmail).toBeNull();
      expect(store.session.signupFullName).toBeNull();
      expect(store.session.tosAccepted).toBeNull();
      expect(store.session.signupRequiredFields).toBeNull();
      // Lock-step with tosAccepted — same invariant as in setRegionForced.
      expect(store.session.legalDocumentBundle).toBeNull();
      expect(store.session.legalDocumentSource).toBeNull();
      expect(store.session.signupAuth).toBeNull();
      expect(store.session.signupAbandoned).toBe(false);
      expect(store.session.signupTokensObtained).toBe(false);
    });

    it('clearOrgAndProjectSelection clears post-run state', () => {
      const store = createStore();
      seedPostRunState(store);
      store.clearOrgAndProjectSelection();
      expectPostRunCleared(store);
      expect(store.session.selectedOrgId).toBeNull();
      expect(store.session.selectedProjectId).toBeNull();
    });

    it('resetActivationCheck clears post-run state', () => {
      const store = createStore();
      seedPostRunState(store);
      store.resetActivationCheck();
      expectPostRunCleared(store);
      expect(store.session.projectHasData).toBeNull();
      expect(store.session.activationLevel).toBe('none');
      expect(store.session.activationOptionsComplete).toBe(false);
    });

    it('resetActivationOptions clears post-run state', () => {
      const store = createStore();
      seedPostRunState(store);
      store.resetActivationOptions();
      expectPostRunCleared(store);
      expect(store.session.activationOptionsComplete).toBe(false);
    });

    it('resetFeatureOptIn clears post-run state', () => {
      const store = createStore();
      seedPostRunState(store);
      store.resetFeatureOptIn();
      expectPostRunCleared(store);
    });

    it('popLastFrameworkContextAnswer clears post-run state', () => {
      const store = createStore();
      store.setFrameworkContext('foo', 'bar');
      seedPostRunState(store);
      const popped = store.popLastFrameworkContextAnswer();
      expect(popped).toBe(true);
      expectPostRunCleared(store);
      // The popped answer is gone.
      expect(store.session.frameworkContext['foo']).toBeUndefined();
    });

    it('popLastFrameworkContextAnswer returns false (no-op) when nothing to pop', () => {
      const store = createStore();
      const popped = store.popLastFrameworkContextAnswer();
      expect(popped).toBe(false);
    });
  });

  // ── Signup setter side-effects ──────────────────────────────────
  //
  // `setSignupEmail` and `setSignupFullName` are reused on both the
  // happy "user submitted a value" path and the back-nav "revert
  // cleared the value" path. The setters need to:
  //   1. Only fire `'signup ... captured'` analytics on positive
  //      captures (back-nav clears must NOT pollute the funnel).
  //   2. On `setSignupEmail(null)`, also reset the ceremony state
  //      (`signupRequiredFields` / `signupAuth` / `signupAbandoned`)
  //      so a forward pass after back-nav fires a fresh probe POST
  //      against whatever email the user types next.
  describe('signup setter side-effects', () => {
    it('setSignupEmail with a string fires analytics and sets the value', () => {
      const store = createStore();
      const wizardCapture = analytics.wizardCapture as Mock;
      wizardCapture.mockClear();

      store.setSignupEmail('ada@example.com');

      expect(store.session.signupEmail).toBe('ada@example.com');
      expect(wizardCapture).toHaveBeenCalledWith('signup email captured');
    });

    it('setSignupEmail(null) does NOT fire the captured analytics event', () => {
      const store = createStore();
      const wizardCapture = analytics.wizardCapture as Mock;
      wizardCapture.mockClear();

      store.setSignupEmail(null);

      expect(store.session.signupEmail).toBeNull();
      expect(wizardCapture).not.toHaveBeenCalledWith(
        'signup email captured',
        expect.anything(),
      );
      expect(wizardCapture).not.toHaveBeenCalledWith('signup email captured');
    });

    it('setSignupEmail(null) resets the entire ceremony as one unit', () => {
      // Pre-seed a session that's mid-ceremony: probe POST returned
      // needs_information, ToS was accepted, signupFullName was typed,
      // signupAuth is populated from a success arm. Going back to the
      // email screen must invalidate every piece of that state so the
      // next forward pass starts fresh.
      //
      // Defensive coverage: signupFullName + tosAccepted are also
      // cleared. They're not strictly required to clear today (no
      // current code path reads them to wrongful effect), but they're
      // part of the same conceptual "ceremony" unit — leaving them
      // stale would leak across an Esc-back-then-retype cycle if
      // anything ever reads them in that window.
      const store = createStore();
      const internal = store as unknown as {
        $session: { setKey: (k: string, v: unknown) => void };
      };
      internal.$session.setKey('signupRequiredFields', [
        'full_name',
        'terms_acceptance',
      ]);
      internal.$session.setKey('signupAbandoned', false);
      internal.$session.setKey('signupFullName', 'Ada Lovelace');
      internal.$session.setKey('tosAccepted', true);
      internal.$session.setKey('legalDocumentBundle', {
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      });
      internal.$session.setKey('legalDocumentSource', 'local');
      internal.$session.setKey('signupTokensObtained', true);
      internal.$session.setKey('signupAuth', {
        idToken: 'i',
        accessToken: 'a',
        refreshToken: 'r',
        zone: 'us',
        userInfo: null,
        dashboardUrl: null,
      });

      store.setSignupEmail(null);

      expect(store.session.signupRequiredFields).toBeNull();
      expect(store.session.signupAuth).toBeNull();
      expect(store.session.signupAbandoned).toBe(false);
      expect(store.session.signupFullName).toBeNull();
      expect(store.session.tosAccepted).toBeNull();
      // Lock-step with tosAccepted: legal-doc state is tied to the same
      // probe response, so it must reset alongside acceptance to prevent
      // a stale bundle from riding into a follow-up POST whose acceptance
      // got cleared.
      expect(store.session.legalDocumentBundle).toBeNull();
      expect(store.session.legalDocumentSource).toBeNull();
      // signupTokensObtained gates the post-TUI auth task's "hydrate
      // from disk" branch — leaving it true after a ceremony reset
      // would silently re-use the prior user's tokens on the next
      // forward pass.
      expect(store.session.signupTokensObtained).toBe(false);
    });

    it('resetToS clears tosAccepted but preserves legalDocument{Bundle,Source}', () => {
      // The user backs out of the ToS screen post-acceptance. The
      // router immediately re-resolves to the ToS screen (because
      // `'terms_acceptance'` is still in `signupRequiredFields` and
      // `tosAccepted` is now null), and `ToSScreen` reads URLs from the
      // bundle — clearing them here would strand the user on a blank
      // screen with no interactive elements. The stale-bundle invariant
      // matters only when the WHOLE ceremony resets (new email → new
      // probe response → possibly-new URLs), which is `_resetCeremonyKeys`'
      // job, asserted in the test below.
      const store = createStore();
      const internal = store as unknown as {
        $session: { setKey: (k: string, v: unknown) => void };
      };
      internal.$session.setKey('tosAccepted', true);
      internal.$session.setKey('legalDocumentBundle', {
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      });
      internal.$session.setKey('legalDocumentSource', 'local');

      store.resetToS();

      expect(store.session.tosAccepted).toBeNull();
      expect(store.session.legalDocumentBundle).toEqual({
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      });
      expect(store.session.legalDocumentSource).toBe('local');
    });

    it('full-ceremony reset (via setSignupEmail(null)) wipes the legal-doc bundle', () => {
      // Companion guarantee to resetToS's preservation: when the WHOLE
      // ceremony resets (user backs all the way out to the email
      // screen), `_resetCeremonyKeys` MUST wipe the bundle + source
      // alongside tosAccepted. Otherwise a follow-up ceremony with a
      // different email could send the prior probe's URLs in the
      // accept-tos body.
      const store = createStore();
      const internal = store as unknown as {
        $session: { setKey: (k: string, v: unknown) => void };
      };
      internal.$session.setKey('signupEmail', 'ada@example.com');
      internal.$session.setKey('tosAccepted', true);
      internal.$session.setKey('legalDocumentBundle', {
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      });
      internal.$session.setKey('legalDocumentSource', 'local');

      store.setSignupEmail(null);

      expect(store.session.signupEmail).toBeNull();
      expect(store.session.tosAccepted).toBeNull();
      expect(store.session.legalDocumentBundle).toBeNull();
      expect(store.session.legalDocumentSource).toBeNull();
    });

    it('acceptTermsOfService leaves legalDocumentBundle intact', () => {
      // Forward direction is acceptance, not URL re-supply: the URLs
      // should already have been written by signup-or-auth on the prior
      // probe response. acceptTermsOfService just flips the flag.
      const store = createStore();
      const internal = store as unknown as {
        $session: { setKey: (k: string, v: unknown) => void };
      };
      internal.$session.setKey('legalDocumentBundle', {
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      });
      internal.$session.setKey('legalDocumentSource', 'local');

      store.acceptTermsOfService();

      expect(store.session.tosAccepted).toBe(true);
      expect(store.session.legalDocumentBundle).toEqual({
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      });
      expect(store.session.legalDocumentSource).toBe('local');
    });

    it('setSignupFullName with a string fires analytics and sets the value', () => {
      const store = createStore();
      const wizardCapture = analytics.wizardCapture as Mock;
      wizardCapture.mockClear();

      store.setSignupFullName('Ada Lovelace');

      expect(store.session.signupFullName).toBe('Ada Lovelace');
      expect(wizardCapture).toHaveBeenCalledWith('signup full name captured');
    });

    it('setSignupFullName(null) does NOT fire the captured analytics event', () => {
      const store = createStore();
      const wizardCapture = analytics.wizardCapture as Mock;
      wizardCapture.mockClear();

      store.setSignupFullName(null);

      expect(store.session.signupFullName).toBeNull();
      expect(wizardCapture).not.toHaveBeenCalledWith(
        'signup full name captured',
      );
      expect(wizardCapture).not.toHaveBeenCalledWith(
        'signup full name captured',
        expect.anything(),
      );
    });

    it('setSignupAuth(non-null) folds in signupTokensObtained=true atomically', () => {
      // The auth-task gate releases on `signupAuth !== null` and the
      // post-gate hydration branch reads `signupTokensObtained`. If the
      // two writes were separate calls, a subscriber-fired microtask
      // could observe `signupAuth` set with `signupTokensObtained` still
      // false and route the user to browser OAuth despite valid tokens.
      // This test pins the atomicity contract.
      const store = createStore();
      expect(store.session.signupTokensObtained).toBe(false);

      store.setSignupAuth({
        idToken: 'i',
        accessToken: 'a',
        refreshToken: 'r',
        zone: 'us',
        userInfo: null,
        dashboardUrl: null,
      });

      expect(store.session.signupAuth).not.toBeNull();
      expect(store.session.signupTokensObtained).toBe(true);
    });

    it('setSignupAuth(null) does NOT set signupTokensObtained', () => {
      // Clearing auth (e.g. during a ceremony reset) must not flip the
      // tokens-obtained gate true — only a successful settle does.
      const store = createStore();

      store.setSignupAuth(null);

      expect(store.session.signupAuth).toBeNull();
      expect(store.session.signupTokensObtained).toBe(false);
    });

    it('switchToLogin resets the entire ceremony alongside the path flip', () => {
      // The signup→login switch is conceptually the same kind of reset
      // as `setSignupEmail(null)`: every piece of ceremony state keyed
      // to the previous email must be invalidated so nothing leaks
      // through into the SignIn path. Pin that contract so a future
      // ceremony field added to `_resetCeremonyKeys` doesn't silently
      // drift past `switchToLogin`.
      const store = createStore();
      const internal = store as unknown as {
        $session: { setKey: (k: string, v: unknown) => void };
      };
      internal.$session.setKey('signupEmail', 'ada@example.com');
      internal.$session.setKey('signupFullName', 'Ada Lovelace');
      internal.$session.setKey('signupRequiredFields', ['full_name']);
      internal.$session.setKey('tosAccepted', true);
      internal.$session.setKey('signupTokensObtained', true);
      internal.$session.setKey('signupAuth', {
        idToken: 'i',
        accessToken: 'a',
        refreshToken: 'r',
        zone: 'us',
        userInfo: null,
        dashboardUrl: null,
      });

      store.switchToLogin();

      expect(store.session.authOnboardingPath).toBe(AuthOnboardingPath.SignIn);
      expect(store.session.signupEmail).toBeNull();
      expect(store.session.signupFullName).toBeNull();
      expect(store.session.signupRequiredFields).toBeNull();
      expect(store.session.tosAccepted).toBeNull();
      expect(store.session.signupTokensObtained).toBe(false);
      expect(store.session.signupAuth).toBeNull();
    });
  });

  // ── Inline directory change ──────────────────────────────────────
  //
  // The IntroScreen "Change directory" flow runs through
  // `store.changeInstallDir` + `store.setFrameworkRedetector`. These
  // tests pin the store-side contract: state reset is correct, the
  // re-detector is invoked, and a new call cancels the previous one.
  describe('changeInstallDir', () => {
    function seedDetectionState(store: WizardStore): void {
      // Mimic the post-detection state the IntroScreen would observe
      // before the user opted to change directories.
      store.setFrameworkConfig(Integration.nextjs, {
        metadata: {
          integration: Integration.nextjs,
          name: 'Next.js',
        },
      } as unknown as Parameters<typeof store.setFrameworkConfig>[1]);
      store.setDetectedFramework('Next.js');
      store.setFrameworkContext('appRouter', true);
      store.setDetectionComplete();
    }

    it('resets detection state and updates installDir', () => {
      const store = createStore();
      seedDetectionState(store);
      expect(store.session.detectionComplete).toBe(true);
      expect(store.session.integration).toBe(Integration.nextjs);

      store.changeInstallDir('/tmp/another-project');

      expect(store.session.installDir).toBe('/tmp/another-project');
      expect(store.session.integration).toBeNull();
      expect(store.session.frameworkConfig).toBeNull();
      expect(store.session.detectedFrameworkLabel).toBeNull();
      expect(store.session.detectionComplete).toBe(false);
      expect(store.session.frameworkContext).toEqual({});
      expect(store.session.detectionResults).toEqual([]);
      expect(store.session.discoveredFeatures).toEqual([]);
    });

    it('clears the checkpoint-restore flag — directory change invalidates resume', () => {
      const store = createStore();
      // Mimic a user who opted to "Resume where you left off" but then
      // realized the wizard was pointed at the wrong tree.
      store.session = { ...store.session, _restoredFromCheckpoint: true };

      store.changeInstallDir('/tmp/different-tree');

      expect(store.session._restoredFromCheckpoint).toBe(false);
    });

    it('invokes the registered redetector with the new directory', () => {
      const store = createStore();
      const redetect = vi.fn().mockResolvedValue(undefined);
      store.setFrameworkRedetector(redetect);

      store.changeInstallDir('/tmp/new-target');

      expect(redetect).toHaveBeenCalledTimes(1);
      const [path, signal] = redetect.mock.calls[0];
      expect(path).toBe('/tmp/new-target');
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    it('aborts the previous detection when a second change fires', () => {
      const store = createStore();
      const redetect = vi.fn().mockResolvedValue(undefined);
      store.setFrameworkRedetector(redetect);

      store.changeInstallDir('/tmp/first');
      const firstSignal = redetect.mock.calls[0][1] as AbortSignal;
      expect(firstSignal.aborted).toBe(false);

      store.changeInstallDir('/tmp/second');
      // The first run's signal is now aborted — its detection should
      // bail out rather than stomp on state for the new directory.
      expect(firstSignal.aborted).toBe(true);

      const secondSignal = redetect.mock.calls[1][1] as AbortSignal;
      expect(secondSignal.aborted).toBe(false);
    });

    it('is a no-op for the redetector when none is registered', () => {
      const store = createStore();
      // No setFrameworkRedetector call — simulates test entry points
      // where bin.ts hasn't wired up the helper.
      expect(() => store.changeInstallDir('/tmp/foo')).not.toThrow();
      expect(store.session.installDir).toBe('/tmp/foo');
      expect(store.session.detectionComplete).toBe(false);
    });

    it('tolerates redetector rejections (errors are non-fatal)', async () => {
      const store = createStore();
      const failing = vi.fn().mockRejectedValue(new Error('boom'));
      store.setFrameworkRedetector(failing);

      // Should not throw synchronously.
      expect(() => store.changeInstallDir('/tmp/will-fail')).not.toThrow();
      // Give the rejected promise a tick to settle without bubbling.
      await new Promise((r) => setImmediate(r));
      expect(failing).toHaveBeenCalledTimes(1);
    });

    // Regression: bugbot Issue #2.
    //
    // Before this fix, only the IntroScreen-driven re-detection calls
    // registered an AbortController as the active detection. The
    // INITIAL detection from bin.ts had no controller registered, so a
    // `changeInstallDir` fired before the first scan completed would
    // skip the abort path entirely. The original detection's
    // `setDetectionComplete` could then fire AFTER the reset, briefly
    // flashing stale framework results from the old tree.
    it('aborts a controller registered via registerActiveDetection', () => {
      const store = createStore();
      const initialController = new AbortController();
      store.registerActiveDetection(initialController);

      expect(initialController.signal.aborted).toBe(false);
      store.changeInstallDir('/tmp/swap-during-initial-scan');
      expect(initialController.signal.aborted).toBe(true);
    });

    // Regression: when the user changes installDir mid-session (via the
    // IntroScreen DirectoryPicker), the structured logger must follow
    // — otherwise `~/.amplitude/wizard/runs/<hash>/log.txt` resolves to
    // a different path for every session.installDir-derived consumer
    // (LogViewer in RunScreen, /diagnostics, debug-snapshot) than the
    // logger writes to, and the TUI's "Logs" tab tails an empty file
    // forever. The dedicated logger test pins the path-routing
    // contract; this test pins the call-site contract.
    it('reroutes the structured logger to the new installDir', () => {
      const store = createStore();
      setProjectLogFileMock.mockClear();
      store.changeInstallDir('/tmp/new-project');
      expect(setProjectLogFileMock).toHaveBeenCalledWith('/tmp/new-project');
    });

    // Regression: bugbot Issue #4.
    //
    // `discoveredFeatures` reset alone wasn't enough — the opt-in
    // flags derived from those features (llmOptIn, sessionReplayOptIn,
    // engagementOptIn) and the `additionalFeatureQueue` /
    // `optInFeaturesComplete` markers also need to clear. Otherwise a
    // user who points the wizard at a Python AI repo (LLM analytics
    // discovered, llmOptIn=true, additionalFeatureQueue=[LLM]) and
    // then changes directory to a vanilla Next.js app would have the
    // agent set up LLM analytics in a project that has no LLM SDK.
    it('resets every opt-in flag derived from the old discovery, not just the list', () => {
      const store = createStore();
      // Mimic post-discovery state for the OLD project.
      store.session = {
        ...store.session,
        llmOptIn: true,
        sessionReplayOptIn: true,
        engagementOptIn: true,
        optInFeaturesComplete: true,
        additionalFeatureQueue: [
          AdditionalFeature.LLM,
          AdditionalFeature.SessionReplay,
        ],
      };

      store.changeInstallDir('/tmp/clean-tree');

      expect(store.session.llmOptIn).toBe(false);
      expect(store.session.sessionReplayOptIn).toBe(false);
      expect(store.session.engagementOptIn).toBe(false);
      expect(store.session.optInFeaturesComplete).toBe(false);
      expect(store.session.additionalFeatureQueue).toEqual([]);
      expect(store.session.discoveredFeatures).toEqual([]);
    });

    // Regression: bugbot Issue #8.
    //
    // `frameworkContext` was reset to `{}` but
    // `frameworkContextAnswerOrder` (the per-key answer log used by
    // back-navigation) wasn't. After a directory change, stale keys
    // stayed in the answer-order array. `popLastFrameworkContextAnswer`
    // would then "successfully" pop a key that no longer existed in
    // `frameworkContext`, creating phantom back-nav steps that did
    // nothing visible.
    it('resets frameworkContextAnswerOrder so back-nav has nothing stale to pop', () => {
      const store = createStore();
      store.setFrameworkContext('appRouter', true);
      store.setFrameworkContext('typescript', true);
      expect(store.session.frameworkContextAnswerOrder.length).toBeGreaterThan(
        0,
      );

      store.changeInstallDir('/tmp/new-tree');

      expect(store.session.frameworkContext).toEqual({});
      expect(store.session.frameworkContextAnswerOrder).toEqual([]);
      // popLastFrameworkContextAnswer now correctly reports "nothing
      // to pop" — no phantom back-nav steps.
      expect(store.popLastFrameworkContextAnswer()).toBe(false);
    });

    it('emits a telemetry event with whether a redetector was registered', () => {
      const store = createStore();
      const wizardCapture = analytics.wizardCapture as Mock;
      wizardCapture.mockClear();

      store.changeInstallDir('/tmp/no-redetector');
      const noRedetectorCall = wizardCapture.mock.calls.find(
        (call) => call[0] === 'install dir changed',
      );
      expect(noRedetectorCall?.[1]['has redetector']).toBe(false);

      store.setFrameworkRedetector(vi.fn().mockResolvedValue(undefined));
      store.changeInstallDir('/tmp/with-redetector');
      const withRedetectorCall = wizardCapture.mock.calls
        .filter((call) => call[0] === 'install dir changed')
        .pop();
      expect(withRedetectorCall?.[1]['has redetector']).toBe(true);
    });
  });

  describe('recordFileChangePlanned / recordFileChangeApplied', () => {
    it('appends a planned row, then flips it to applied with bytes + duration', () => {
      const store = createStore();
      expect(store.fileWrites).toEqual([]);

      store.recordFileChangePlanned({
        path: '/proj/src/amplitude.ts',
        operation: 'create',
      });
      expect(store.fileWrites).toHaveLength(1);
      expect(store.fileWrites[0]).toMatchObject({
        path: '/proj/src/amplitude.ts',
        operation: 'create',
        status: 'planned',
      });
      expect(store.fileWrites[0].startedAt).toBeGreaterThan(0);
      expect(store.fileWrites[0].completedAt).toBeUndefined();

      store.recordFileChangeApplied({
        path: '/proj/src/amplitude.ts',
        operation: 'create',
        bytes: 512,
      });
      expect(store.fileWrites).toHaveLength(1);
      expect(store.fileWrites[0]).toMatchObject({
        path: '/proj/src/amplitude.ts',
        operation: 'create',
        status: 'applied',
        bytes: 512,
      });
      expect(store.fileWrites[0].completedAt).toBeGreaterThanOrEqual(
        store.fileWrites[0].startedAt,
      );
    });

    it('synthesizes an applied entry when no matching planned event arrived', () => {
      // Edit / MultiEdit hooks can technically fire PostToolUse without a
      // matching PreToolUse if the SDK reorders or drops a hook (rare but
      // observed). Surface the write rather than silently dropping it.
      const store = createStore();
      store.recordFileChangeApplied({
        path: '/proj/src/orphan.ts',
        operation: 'modify',
      });
      expect(store.fileWrites).toHaveLength(1);
      expect(store.fileWrites[0]).toMatchObject({
        path: '/proj/src/orphan.ts',
        operation: 'modify',
        status: 'applied',
      });
    });

    it('collapses a back-to-back duplicate planned event for the same path', () => {
      // Defensive: PreToolUse can fire twice for the same path during a
      // retry loop. The user should see one in-progress row, not two.
      const store = createStore();
      store.recordFileChangePlanned({
        path: '/proj/src/dup.ts',
        operation: 'modify',
      });
      store.recordFileChangePlanned({
        path: '/proj/src/dup.ts',
        operation: 'modify',
      });
      expect(store.fileWrites).toHaveLength(1);
    });

    it('caps the list at MAX_FILE_WRITES with FIFO eviction', () => {
      // A long-running run that touches hundreds of files (skill installs,
      // lint fix-ups) shouldn't blow up the TUI. Oldest rows fall off.
      const store = createStore();
      for (let i = 0; i < WizardStore.MAX_FILE_WRITES + 5; i++) {
        store.recordFileChangePlanned({
          path: `/proj/file-${i}.ts`,
          operation: 'create',
        });
      }
      expect(store.fileWrites).toHaveLength(WizardStore.MAX_FILE_WRITES);
      // First five rows should have been evicted.
      expect(store.fileWrites[0].path).toBe('/proj/file-5.ts');
    });

    it('keeps fileWritesTotal climbing past MAX_FILE_WRITES', () => {
      // The coaching signal in RunScreen keys off `fileWritesTotal`, not
      // `fileWrites.length`. After the FIFO cap kicks in, the array length
      // plateaus at 50 — but the agent might still be hammering away at
      // file writes with no [STATUS] messages. The monotonic counter is
      // what keeps the coaching timer from prematurely firing tier-1.
      const store = createStore();
      const N = WizardStore.MAX_FILE_WRITES + 7;
      for (let i = 0; i < N; i++) {
        store.recordFileChangePlanned({
          path: `/proj/file-${i}.ts`,
          operation: 'create',
        });
      }
      expect(store.fileWrites).toHaveLength(WizardStore.MAX_FILE_WRITES);
      expect(store.fileWritesTotal).toBe(N);
    });

    it('matches the most recent planned row when the same file is rewritten', () => {
      // Common during multi-pass refactors. Apply the second planned row,
      // not the first — otherwise the duration on the second row would
      // count from the first plan, not the second.
      const store = createStore();
      store.recordFileChangePlanned({
        path: '/proj/twice.ts',
        operation: 'modify',
      });
      store.recordFileChangeApplied({
        path: '/proj/twice.ts',
        operation: 'modify',
      });
      store.recordFileChangePlanned({
        path: '/proj/twice.ts',
        operation: 'modify',
      });
      // At this point row 0 is applied, row 1 is planned.
      expect(store.fileWrites[0].status).toBe('applied');
      expect(store.fileWrites[1].status).toBe('planned');
      store.recordFileChangeApplied({
        path: '/proj/twice.ts',
        operation: 'modify',
      });
      expect(store.fileWrites[0].status).toBe('applied');
      expect(store.fileWrites[1].status).toBe('applied');
    });
  });

  // ── Live activity transitions (stall visibility) ─────────────────
  describe('setCurrentActivity', () => {
    it('starts with no current activity', () => {
      const store = createStore();
      expect(store.session.currentActivity).toBeNull();
    });

    it('sets and clears each stall kind', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);
      cb.mockClear();

      store.setCurrentActivity({
        kind: 'compaction',
        message:
          'Compacting context — keeping the relevant pieces, dropping the rest.',
        startedAt: 1_000,
        estimatedDurationSec: 60,
      });
      expect(store.session.currentActivity?.kind).toBe('compaction');
      expect(cb).toHaveBeenCalled();

      cb.mockClear();
      store.setCurrentActivity({
        kind: 'rate-limit-retry',
        message:
          'Rate limited by Anthropic. Waiting 12s before retry (attempt 2/5).',
        startedAt: 2_000,
      });
      expect(store.session.currentActivity?.kind).toBe('rate-limit-retry');
      expect(
        store.session.currentActivity?.estimatedDurationSec,
      ).toBeUndefined();
      expect(cb).toHaveBeenCalled();

      cb.mockClear();
      store.setCurrentActivity({
        kind: 'cold-start',
        message: 'Loading skills...',
        startedAt: 3_000,
        estimatedDurationSec: 90,
      });
      expect(store.session.currentActivity?.kind).toBe('cold-start');
      expect(cb).toHaveBeenCalled();

      cb.mockClear();
      store.setCurrentActivity({
        kind: 'ingestion-poll',
        message: 'Waiting for events to reach Amplitude (polling every 10s).',
        startedAt: 4_000,
        estimatedDurationSec: 10,
      });
      expect(store.session.currentActivity?.kind).toBe('ingestion-poll');
      expect(cb).toHaveBeenCalled();

      cb.mockClear();
      store.setCurrentActivity({
        kind: 'mcp-tool',
        message: 'Querying Amplitude (query_dataset)...',
        startedAt: 5_000,
        estimatedDurationSec: 30,
      });
      expect(store.session.currentActivity?.kind).toBe('mcp-tool');
      expect(cb).toHaveBeenCalled();

      // Regression: clearing back to idle wipes the field. Without this,
      // a stale "Compacting context" line would persist after a run resumes
      // because the activity-line component renders any non-null value.
      cb.mockClear();
      store.setCurrentActivity(null);
      expect(store.session.currentActivity).toBeNull();
      expect(cb).toHaveBeenCalled();
    });

    it('replaces activity in place rather than queueing', () => {
      const store = createStore();
      store.setCurrentActivity({
        kind: 'cold-start',
        message: 'Loading skills...',
        startedAt: 1,
      });
      store.setCurrentActivity({
        kind: 'cold-start',
        message: 'Initializing agent...',
        startedAt: 2,
      });
      expect(store.session.currentActivity?.message).toBe(
        'Initializing agent...',
      );
      expect(store.session.currentActivity?.startedAt).toBe(2);
    });
  });

  // ── Returning-user account confirm → create-project → cancel ───────
  // Regression: pressing N at the account-confirm screen used to clear
  // the project, then Esc-from-CreateProject left AuthScreen with no
  // project selected, no requiresAccountConfirmation, and no
  // pendingOrgs (returning users never populate it). The OAuth waiting
  // screen would render with an empty login URL — a deadlock.
  describe('account-confirm → create-project cancel restores confirm', () => {
    it('cancel from account-confirm source re-enables requiresAccountConfirmation', () => {
      const store = createStore();
      store.session.credentials = {
        accessToken: 'tok',
        idToken: 'id',
        projectApiKey: 'k',
        host: 'amplitude.com',
        appId: 0,
      } as never;
      store.session.selectedOrgId = 'org-1';
      store.session.selectedOrgName = 'Acme';
      store.session.selectedProjectId = 'proj-1';
      store.session.selectedProjectName = 'Original';
      store.session.requiresAccountConfirmation = true;

      store.dismissAccountConfirmForNewProject();
      store.startCreateProject('account-confirm');
      expect(store.session.requiresAccountConfirmation).toBe(false);
      expect(store.session.createProject.pending).toBe(true);
      // Project state is intact so cancel can fall back cleanly.
      expect(store.session.selectedProjectId).toBe('proj-1');
      expect(store.session.selectedProjectName).toBe('Original');

      store.cancelCreateProject();
      expect(store.session.createProject.pending).toBe(false);
      expect(store.session.requiresAccountConfirmation).toBe(true);
      expect(store.session.selectedProjectId).toBe('proj-1');
      expect(store.session.selectedProjectName).toBe('Original');
    });

    it('cancel from a non-account-confirm source does not re-enable confirmation', () => {
      const store = createStore();
      store.session.requiresAccountConfirmation = false;
      store.startCreateProject('project');
      store.cancelCreateProject();
      expect(store.session.requiresAccountConfirmation).toBe(false);
    });
  });

  describe('pushDiscoveryFact', () => {
    it('appends a fact to the cold-start discovery feed', () => {
      const store = createStore();
      expect(store.session.discoveryFacts).toEqual([]);

      store.pushDiscoveryFact({
        id: 'framework',
        label: 'Framework',
        value: 'Next.js 15',
        discoveredAt: 1_700_000_000_000,
      });

      expect(store.session.discoveryFacts).toHaveLength(1);
      expect(store.session.discoveryFacts[0]).toMatchObject({
        id: 'framework',
        label: 'Framework',
        value: 'Next.js 15',
      });
    });

    it('dedupes by id — re-pushing the same id is a no-op', () => {
      const store = createStore();
      store.pushDiscoveryFact({
        id: 'framework',
        label: 'Framework',
        value: 'Next.js 15',
        discoveredAt: 1,
      });
      // Same id, different value — should be ignored.
      store.pushDiscoveryFact({
        id: 'framework',
        label: 'Framework',
        value: 'Next.js 14',
        discoveredAt: 2,
      });
      expect(store.session.discoveryFacts).toHaveLength(1);
      expect(store.session.discoveryFacts[0].value).toBe('Next.js 15');
    });

    it('preserves insertion order across multiple distinct facts', () => {
      const store = createStore();
      store.pushDiscoveryFact({
        id: 'framework',
        label: 'Framework',
        value: 'Next.js',
        discoveredAt: 1,
      });
      store.pushDiscoveryFact({
        id: 'package-manager',
        label: 'Package manager',
        value: 'pnpm',
        discoveredAt: 2,
      });
      store.pushDiscoveryFact({
        id: 'typescript',
        label: 'TypeScript',
        value: 'yes',
        discoveredAt: 3,
      });
      expect(store.session.discoveryFacts.map((f) => f.id)).toEqual([
        'framework',
        'package-manager',
        'typescript',
      ]);
    });
  });
});
