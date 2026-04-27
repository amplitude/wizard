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
import { OutroKind, AdditionalFeature } from '../../../lib/wizard-session.js';
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
      // installDir is overridden by the test helper — compare the rest.
      const { installDir: storeInstallDir, ...rest } = store.session;
      const { installDir: defaultInstallDir, ...defaults } = buildSession({});
      expect(rest).toEqual(defaults);
      expect(storeInstallDir).toMatch(/wizard-store-test-/);
      expect(defaultInstallDir).toBeDefined();
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

    it('setFrameworkContext sets key-value pairs', () => {
      const store = createStore();
      store.setFrameworkContext('packageManager', 'pnpm');
      expect(store.session.frameworkContext['packageManager']).toBe('pnpm');

      store.setFrameworkContext('srcDir', 'src');
      expect(store.session.frameworkContext['srcDir']).toBe('src');
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
      store.session.selectedWorkspaceId = 'ws-1';
      store.session.selectedWorkspaceName = 'Amplitude';
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
      expect(store.session.selectedWorkspaceId).toBeNull();
      expect(store.session.selectedWorkspaceName).toBeNull();
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
      store.session.selectedWorkspaceName = 'Amplitude';
      store.session.selectedWorkspaceId = 'ws-1';
      store.session.selectedAppId = 'app-1';
      store.setProjectHasData(false);
      expect(store.currentScreen).toBe(Screen.Run);

      store.setRegionForced();
      expect(store.currentScreen).toBe(Screen.RegionSelect);

      store.setRegion('eu');
      expect(store.currentScreen).toBe(Screen.Auth);
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
    // Auth: set credentials + org/workspace/env (Auth screen isComplete
    // requires all four: credentials and all three names)
    store.setCredentials({
      accessToken: 'tok',
      projectApiKey: 'pk',
      host: 'h',
      appId: 1,
    });
    // Set org/workspace/env names directly to satisfy Auth.isComplete
    // (it only checks names, not IDs — so we don't have to set IDs and
    // trigger setOrgAndWorkspace's ampli.json write).
    store.session.selectedOrgName = 'Acme';
    store.session.selectedWorkspaceName = 'Amplitude';
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

  describe('syncTodos', () => {
    it('maps incoming todos to TaskItems', () => {
      const store = createStore();
      store.syncTodos([
        { content: 'Install SDK', status: 'pending' },
        { content: 'Configure', status: 'completed' },
      ]);

      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[0]).toEqual({
        label: 'Install SDK',
        activeForm: undefined,
        status: TaskStatus.Pending,
        done: false,
      });
      expect(store.tasks[1]).toEqual({
        label: 'Configure',
        activeForm: undefined,
        status: TaskStatus.Completed,
        done: true,
      });
    });

    it('retains completed tasks not in the incoming list', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Old done task', status: TaskStatus.Completed, done: true },
        { label: 'Old pending task', status: TaskStatus.Pending, done: false },
      ]);

      store.syncTodos([{ content: 'New task', status: 'pending' }]);

      // Old done task is retained, old pending task is dropped
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[0].label).toBe('Old done task');
      expect(store.tasks[1].label).toBe('New task');
    });

    it('does not duplicate completed tasks that appear in both', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Shared task', status: TaskStatus.Completed, done: true },
      ]);

      store.syncTodos([{ content: 'Shared task', status: 'completed' }]);

      // Should not have duplicates — incomingLabels includes "Shared task",
      // so the retained filter excludes it
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].label).toBe('Shared task');
    });

    it('preserves activeForm from incoming todos', () => {
      const store = createStore();
      store.syncTodos([
        {
          content: 'Installing',
          status: 'in_progress',
          activeForm: 'Installing SDK...',
        },
      ]);

      expect(store.tasks[0].activeForm).toBe('Installing SDK...');
    });

    it('emits change', () => {
      const store = createStore();
      const cb = vi.fn();
      store.subscribe(cb);
      store.syncTodos([{ content: 'task', status: 'pending' }]);
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
      // Org/workspace/env names are required for Auth.isComplete. Assign
      // directly so subscribers only fire for the three explicit mutations
      // this test is exercising (setCredentials, setRegion, popOverlay).
      // Only names — IDs intentionally omitted to avoid setRegion below
      // triggering an ampli.json write.
      store.session.selectedOrgName = 'Acme';
      store.session.selectedWorkspaceName = 'Amplitude';
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

    it('syncTodos with empty array clears non-completed tasks', () => {
      const store = createStore();
      store.setTasks([
        { label: 'Pending', status: TaskStatus.Pending, done: false },
        { label: 'Done', status: TaskStatus.Completed, done: true },
      ]);

      store.syncTodos([]);

      // Only the completed task is retained
      expect(store.tasks).toEqual([
        { label: 'Done', status: TaskStatus.Completed, done: true },
      ]);
    });

    it('syncTodos with unknown status defaults to Pending', () => {
      const store = createStore();
      store.syncTodos([{ content: 'Task', status: '' }]);
      expect(store.tasks[0].status).toBe(TaskStatus.Pending);
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
      // Org/workspace/env are resolved as part of the SUSI flow too; set them
      // directly (no setter) so Auth.isComplete passes without bumping the
      // version counter this test asserts on. Only names — Auth.isComplete
      // checks names, not IDs, and omitting IDs avoids side effects.
      store.session.selectedOrgName = 'Acme';
      store.session.selectedWorkspaceName = 'Amplitude';
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
});
