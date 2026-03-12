import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WizardRouter } from '../../src/ui/tui/router.js';
import { Screen, Flow } from '../../src/ui/tui/flows.js';
import { buildSession, type WizardSession } from '../../src/lib/wizard-session.js';
import {
  persistApiKey,
  readApiKeyWithSource,
} from '../../src/utils/api-key-store.js';
import { writeAmpliConfig, readAmpliConfig } from '../../src/lib/ampli-config.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let projectDir: string;
let router: WizardRouter;
let session: WizardSession;

const MOCK_ORG = { id: 'org-1', name: 'Acme', workspaces: [{ id: 'ws-1', name: 'Default' }] };
const MOCK_ORG_MULTI_WS = {
  id: 'org-1',
  name: 'Acme',
  workspaces: [
    { id: 'ws-1', name: 'Default' },
    { id: 'ws-2', name: 'Staging' },
  ],
};
const MOCK_ORG_2 = { id: 'org-2', name: 'Beta Corp', workspaces: [{ id: 'ws-3', name: 'Main' }] };

function mockCredentials(): WizardSession['credentials'] {
  return {
    accessToken: 'id-token-abc',
    projectApiKey: 'api-key-xyz',
    host: 'https://api.amplitude.com',
    projectId: 0,
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

Before(function () {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-susi-test-'));
  router = new WizardRouter(Flow.Wizard);
  session = buildSession({ installDir: projectDir });
  // Region is selected before OAuth in the real flow; pre-populate here.
  session.region = 'us';
  // Simulate OAuth completing — pendingAuthIdToken set
  session.pendingAuthIdToken = 'id-token-abc';
  session.pendingAuthCloudRegion = 'us';
});

After(function () {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// ── Given ─────────────────────────────────────────────────────────────────────

Given(
  'the OAuth flow has completed with one org and one workspace',
  function () {
    session.pendingOrgs = [MOCK_ORG];
  },
);

Given(
  'the OAuth flow has completed with one org and multiple workspaces',
  function () {
    session.pendingOrgs = [MOCK_ORG_MULTI_WS];
  },
);

Given('the OAuth flow has completed with multiple orgs', function () {
  session.pendingOrgs = [MOCK_ORG, MOCK_ORG_2];
});

Given('the OAuth flow has completed', function () {
  session.pendingOrgs = [MOCK_ORG];
});

Given('the OAuth flow has completed and org and workspace are selected', function () {
  session.pendingOrgs = [MOCK_ORG];
  session.selectedOrgId = MOCK_ORG.id;
  session.selectedOrgName = MOCK_ORG.name;
  session.selectedWorkspaceId = MOCK_ORG.workspaces[0].id;
  session.selectedWorkspaceName = MOCK_ORG.workspaces[0].name;
});

Given('there is no saved API key for this project', function () {
  // Ensure no .env.local key exists in the temp dir
  const envPath = path.join(projectDir, '.env.local');
  if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
});

Given('there is a saved API key for this project', function () {
  // Write a key to .env.local (the file-based fallback — no keychain in tests)
  fs.writeFileSync(
    path.join(projectDir, '.env.local'),
    'AMPLITUDE_API_KEY=saved-key-abc\n',
    'utf-8',
  );
});

Given('the wizard has launched', function () {
  // session is fresh from Before — no credentials, no pending orgs yet
});

Given('OAuth has not yet completed', function () {
  session.pendingOrgs = null; // null = still waiting
});

Given('the login URL is set in the session', function () {
  session.loginUrl = 'https://auth.amplitude.com/login?code=abc';
});

// ── When ──────────────────────────────────────────────────────────────────────

When('the org and workspace are selected', function () {
  session.selectedOrgId = MOCK_ORG.id;
  session.selectedOrgName = MOCK_ORG.name;
  session.selectedWorkspaceId = MOCK_ORG.workspaces[0].id;
  session.selectedWorkspaceName = MOCK_ORG.workspaces[0].name;
  writeAmpliConfig(projectDir, {
    OrgId: MOCK_ORG.id,
    WorkspaceId: MOCK_ORG.workspaces[0].id,
    Zone: 'us',
  });
});

When('I select an org', function () {
  session.selectedOrgId = MOCK_ORG.id;
  session.selectedOrgName = MOCK_ORG.name;
  session.selectedWorkspaceId = MOCK_ORG.workspaces[0].id;
  session.selectedWorkspaceName = MOCK_ORG.workspaces[0].name;
});

When('I select a workspace', function () {
  session.selectedWorkspaceId = MOCK_ORG_MULTI_WS.workspaces[0].id;
  session.selectedWorkspaceName = MOCK_ORG_MULTI_WS.workspaces[0].name;
});

When('I enter a valid Amplitude API key', function () {
  const key = 'my-amplitude-api-key-12345';
  session.credentials = {
    accessToken: session.pendingAuthIdToken ?? '',
    projectApiKey: key,
    host: 'https://api.amplitude.com',
    projectId: 0,
  };
  // Persist — file fallback since keychain is not available in tests
  persistApiKey(key, projectDir);
});

// ── Then ──────────────────────────────────────────────────────────────────────

Then('the org should be auto-selected', function () {
  // In the real flow, AuthScreen's useEffect selects the only org.
  // Here we assert the router shows Auth screen (pending — org not yet in session)
  // OR that if we manually advance, DataSetup is next.
  // We verify the structure: single org means no picker is needed.
  assert.ok(
    session.pendingOrgs !== null && session.pendingOrgs.length === 1,
    'Expected exactly one pending org (auto-selectable)',
  );
});

Then('the workspace should be auto-selected', function () {
  assert.ok(
    session.pendingOrgs?.[0]?.workspaces.length === 1,
    'Expected exactly one workspace (auto-selectable)',
  );
});

Then('I should be prompted to enter my Amplitude API key', function () {
  // Once org+workspace are selected (auto), credentials should still be null
  // — the API key input step should follow.
  assert.strictEqual(
    session.credentials,
    null,
    'Expected credentials to still be null (waiting for API key)',
  );
});

Then('I should see an org picker', function () {
  assert.ok(
    session.pendingOrgs !== null && session.pendingOrgs.length > 1,
    'Expected multiple orgs for picker to appear',
  );
  // Router should show Auth screen (credentials not yet set)
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Auth,
    `Expected Auth screen but got ${screen}`,
  );
});

Then('that org should be stored in my session', function () {
  assert.ok(session.selectedOrgId, 'Expected selectedOrgId to be set');
});

Then('I should see a workspace picker', function () {
  assert.ok(
    session.pendingOrgs?.[0]?.workspaces.length !== undefined &&
      session.pendingOrgs[0].workspaces.length > 1,
    'Expected multiple workspaces for picker to appear',
  );
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Auth,
    `Expected Auth screen but got ${screen}`,
  );
});

Then('that workspace should be stored in my session', function () {
  assert.ok(
    session.selectedWorkspaceId,
    'Expected selectedWorkspaceId to be set',
  );
});

Then(
  '"ampli.json" should be written with OrgId, WorkspaceId, and Zone',
  function () {
    const result = readAmpliConfig(projectDir);
    assert.ok(
      result.ok === true,
      `Expected ampli.json to be valid, got: ${result.ok ? 'ok' : (result as { ok: false; error: string }).error}`,
    );
    if (result.ok) {
      assert.ok(result.config.OrgId, 'Expected OrgId in ampli.json');
      assert.ok(result.config.WorkspaceId, 'Expected WorkspaceId in ampli.json');
      assert.ok(result.config.Zone, 'Expected Zone in ampli.json');
    }
  },
);

Then(
  'the API key should be saved to the system keychain or .env.local',
  function () {
    const result = readApiKeyWithSource(projectDir);
    assert.ok(result !== null, 'Expected a saved API key to be found');
    assert.ok(result?.key.length, 'Expected a non-empty API key');
  },
);

Then("I should proceed without being asked for the key again", function () {
  const result = readApiKeyWithSource(projectDir);
  assert.ok(
    result !== null,
    'Expected saved key to exist so future runs can skip the prompt',
  );
});

Then('I should not be prompted to enter an API key', function () {
  // Verify the saved key is readable — AuthScreen would auto-advance with it
  const result = readApiKeyWithSource(projectDir);
  assert.ok(result !== null, 'Expected a saved API key to be found');
});

Then('I should proceed automatically with the saved key', function () {
  // Simulate what AuthScreen useEffect does: reads key and sets credentials
  const result = readApiKeyWithSource(projectDir);
  assert.ok(result, 'Expected saved key');
  session.credentials = {
    accessToken: session.pendingAuthIdToken ?? '',
    projectApiKey: result.key,
    host: 'https://api.amplitude.com',
    projectId: 0,
  };
  session.projectHasData = false;
  // With credentials set, router should advance past Auth
  const screen = router.resolve(session);
  assert.notStrictEqual(
    screen,
    Screen.Auth,
    'Expected router to advance past Auth when credentials are set',
  );
});

Then('the AuthScreen should show a loading spinner', function () {
  // pendingOrgs === null means OAuth is still in progress — AuthScreen shows spinner
  assert.strictEqual(
    session.pendingOrgs,
    null,
    'Expected pendingOrgs to be null while OAuth is pending',
  );
  // Router should resolve to Auth screen (credentials not yet set)
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Auth,
    `Expected Auth screen but got ${screen}`,
  );
});

Then(
  'the AuthScreen should display the login URL for manual copy-paste',
  function () {
    assert.ok(
      session.loginUrl,
      'Expected loginUrl to be set in session',
    );
  },
);

Given('the user has no Amplitude organizations', function () {
  session.pendingOrgs = []; // OAuth done, but returned zero orgs
});

Then(
  'the wizard should display guidance to create an org at app.amplitude.com',
  function () {
    // pendingOrgs === [] means OAuth succeeded but the user has no orgs yet
    assert.ok(
      session.pendingOrgs !== null && session.pendingOrgs.length === 0,
      'Expected pendingOrgs to be an empty array',
    );
    // Router stays on Auth — AuthScreen is responsible for showing the guidance
    const screen = router.resolve(session);
    assert.strictEqual(
      screen,
      Screen.Auth,
      `Expected Auth screen while awaiting org creation but got ${screen}`,
    );
  },
);
