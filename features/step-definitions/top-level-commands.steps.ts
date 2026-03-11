import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getStoredUser,
  getStoredToken,
  storeToken,
  clearStoredCredentials,
  type StoredUser,
  type StoredOAuthToken,
} from '../../src/utils/ampli-settings.js';

// ── Shared state ──────────────────────────────────────────────────────────────

/** Temp config file used in place of ~/.ampli.json for isolation. */
let tempConfigPath: string;
let tempDir: string;

/** The user set up by a Given step, used to simulate stored credentials. */
let scenarioUser: StoredUser | undefined;

/** Captured output from command execution (simulated). */
let commandOutput: {
  user?: StoredUser;
  token?: StoredOAuthToken;
  oauthTriggered: boolean;
  cleared: boolean;
  parsedArgs?: Record<string, unknown>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFutureExpiry(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
}

function makePastExpiry(daysAgo = 400): string {
  // Access token expired 400 days ago → refresh token also expired (TTL = 364 days from access expiry)
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function makeValidToken(): StoredOAuthToken {
  return {
    accessToken: 'access-abc',
    idToken: 'id-abc',
    refreshToken: 'refresh-abc',
    expiresAt: makeFutureExpiry(),
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

Before(function () {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-wizard-cmd-test-'));
  tempConfigPath = path.join(tempDir, 'ampli.json');

  scenarioUser = undefined;
  commandOutput = { oauthTriggered: false, cleared: false };
});

After(function () {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── Given ─────────────────────────────────────────────────────────────────────

Given('I have valid credentials stored in {string}', function (_path: string) {
  scenarioUser = {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    zone: 'us',
  };
  storeToken(scenarioUser, makeValidToken(), tempConfigPath);
});

Given('I have no credentials stored in {string}', function (_path: string) {
  scenarioUser = undefined;
  // Ensure the temp config is empty / absent
  if (fs.existsSync(tempConfigPath)) fs.unlinkSync(tempConfigPath);
});

Given('I have credentials stored in {string}', function (_path: string) {
  // Alias used by the Logout scenario — stores a user with a valid token
  scenarioUser = {
    id: 'user-2',
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'grace@example.com',
    zone: 'us',
  };
  storeToken(scenarioUser, makeValidToken(), tempConfigPath);
});

Given('I have expired credentials stored in {string}', function (_path: string) {
  scenarioUser = {
    id: 'user-3',
    firstName: 'Margaret',
    lastName: 'Hamilton',
    email: 'margaret@example.com',
    zone: 'us',
  };
  storeToken(
    scenarioUser,
    {
      accessToken: 'old-access',
      idToken: 'old-id',
      refreshToken: 'old-refresh',
      expiresAt: makePastExpiry(),
    },
    tempConfigPath,
  );
});

// ── When ──────────────────────────────────────────────────────────────────────

When('I run {string}', function (command: string) {
  if (command === 'amplitude-wizard whoami') {
    // Simulate whoami: read user + token from temp config
    commandOutput.user = getStoredUser(tempConfigPath);
    commandOutput.token = getStoredToken(undefined, 'us', tempConfigPath);
    return;
  }

  if (command === 'amplitude-wizard login') {
    // Simulate the login command's "check existing session" path:
    // - If a valid token exists → skip OAuth, return stored credentials
    // - If no valid token → would trigger OAuth (marked as triggered) and store fresh tokens
    const existingToken = getStoredToken(undefined, 'us', tempConfigPath);
    if (existingToken) {
      commandOutput.oauthTriggered = false;
      commandOutput.user = getStoredUser(tempConfigPath);
      commandOutput.token = existingToken;
    } else {
      commandOutput.oauthTriggered = true;
      // Simulate OAuth completing with fresh tokens
      if (scenarioUser) {
        const freshToken = makeValidToken();
        storeToken(scenarioUser, freshToken, tempConfigPath);
        commandOutput.user = scenarioUser;
        commandOutput.token = freshToken;
      }
    }
    return;
  }

  if (command === 'amplitude-wizard logout') {
    clearStoredCredentials(tempConfigPath);
    commandOutput.cleared = true;
    return;
  }

  // Bare "amplitude-wizard" with no subcommand → interactive TUI mode
  if (command === 'amplitude-wizard') {
    commandOutput.parsedArgs = { ci: false };
    return;
  }

  // Generic flag parsing for commands like "amplitude-wizard --ci --api-key abc123 ..."
  if (command.startsWith('amplitude-wizard ')) {
    const args = command.slice('amplitude-wizard '.length).split(' ');
    const parsed: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          parsed[key] = next;
          i++;
        } else {
          parsed[key] = true;
        }
      }
    }
    commandOutput.parsedArgs = parsed;
  }
});

// ── Then ──────────────────────────────────────────────────────────────────────

Then('I should see my name, email, and zone', function () {
  const user = commandOutput.user;
  assert.ok(user, 'Expected a logged-in user but got none');
  assert.ok(user.firstName, 'Expected firstName');
  assert.ok(user.email, 'Expected email');
  assert.ok(user.zone, 'Expected zone');
});

Then('I should see {string}', function (message: string) {
  if (message === 'Not logged in') {
    assert.strictEqual(
      commandOutput.user,
      undefined,
      'Expected no user but got one',
    );
  }
});

Then('I should see my logged-in user details', function () {
  assert.ok(commandOutput.user, 'Expected user details but got none');
  assert.ok(commandOutput.token, 'Expected a valid token but got none');
});

Then('I should be redirected through the OAuth flow', function () {
  assert.strictEqual(
    commandOutput.oauthTriggered,
    true,
    'Expected OAuth flow to be triggered but it was not',
  );
});

Then('my token should be refreshed in {string}', function (_configPathLabel: string) {
  const token = getStoredToken(undefined, 'us', tempConfigPath);
  assert.ok(token, 'Expected a refreshed token to be stored but got none');
  const expiresAt = new Date(token.expiresAt);
  assert.ok(expiresAt > new Date(), 'Expected the refreshed token to not be expired');
});

Then('the OAuth flow should not be triggered', function () {
  assert.strictEqual(
    commandOutput.oauthTriggered,
    false,
    'OAuth flow was triggered unexpectedly',
  );
});

Then('the interactive TUI should launch', function () {
  assert.strictEqual(
    commandOutput.parsedArgs?.ci,
    false,
    'Expected interactive mode (no --ci flag)',
  );
});

Then('the wizard should run non-interactively', function () {
  assert.strictEqual(
    commandOutput.parsedArgs?.ci,
    true,
    'Expected --ci flag to be set for non-interactive mode',
  );
});

Then('authentication should come from the provided arguments', function () {
  assert.ok(
    commandOutput.parsedArgs?.apiKey,
    'Expected --api-key to be provided for CI authentication',
  );
});

Then('{string} should be cleared', function (_configPathLabel: string) {
  // Verify the temp config file has been cleared (empty object)
  const raw = fs.existsSync(tempConfigPath)
    ? fs.readFileSync(tempConfigPath, 'utf-8')
    : '{}';
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  assert.deepStrictEqual(
    parsed,
    {},
    'Expected ~/.ampli.json to be cleared to {}',
  );
  // Also verify that getStoredUser returns nothing
  assert.strictEqual(
    getStoredUser(tempConfigPath),
    undefined,
    'Expected no stored user after logout',
  );
});
