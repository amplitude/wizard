import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock the auth plumbing — agent-ops shouldn't actually hit ~/.ampli.json.
vi.mock('../../utils/ampli-settings.js', () => ({
  getStoredUser: vi.fn(),
  getStoredToken: vi.fn(),
}));

import {
  getAuthStatus,
  getAuthToken,
  runStatus,
  runDetect,
  runPlan,
} from '../agent-ops.js';
import { getStoredUser, getStoredToken } from '../../utils/ampli-settings.js';

const mockedGetStoredUser = vi.mocked(getStoredUser);
const mockedGetStoredToken = vi.mocked(getStoredToken);

// ── auth ────────────────────────────────────────────────────────────

describe('getAuthStatus', () => {
  beforeEach(() => {
    mockedGetStoredUser.mockReset();
    mockedGetStoredToken.mockReset();
  });

  it('returns loggedIn:false when no user is stored', () => {
    mockedGetStoredUser.mockReturnValue(undefined);
    expect(getAuthStatus()).toEqual({
      loggedIn: false,
      user: null,
      tokenExpiresAt: null,
    });
  });

  it('returns loggedIn:false when user id is "pending"', () => {
    mockedGetStoredUser.mockReturnValue({
      id: 'pending',
      firstName: '',
      lastName: '',
      email: '',
      zone: 'US',
    });
    expect(getAuthStatus().loggedIn).toBe(false);
  });

  it('returns loggedIn:true with user + token expiry when fully authed', () => {
    mockedGetStoredUser.mockReturnValue({
      id: 'abc123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      zone: 'US',
    });
    mockedGetStoredToken.mockReturnValue({
      accessToken: 'tok-xyz',
      idToken: 'id-xyz',
      refreshToken: 'ref-xyz',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const result = getAuthStatus();
    expect(result.loggedIn).toBe(true);
    expect(result.user).toEqual({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      zone: 'US',
    });
    expect(result.tokenExpiresAt).toBe('2099-01-01T00:00:00.000Z');
  });
});

describe('getAuthToken', () => {
  beforeEach(() => {
    mockedGetStoredUser.mockReset();
    mockedGetStoredToken.mockReset();
  });

  it('returns nulls when not logged in', () => {
    mockedGetStoredUser.mockReturnValue(undefined);
    expect(getAuthToken()).toEqual({
      token: null,
      expiresAt: null,
      zone: null,
    });
  });

  it('returns the access token and zone when authed', () => {
    mockedGetStoredUser.mockReturnValue({
      id: 'abc',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b',
      zone: 'EU',
    });
    mockedGetStoredToken.mockReturnValue({
      accessToken: 'secret-token',
      idToken: 'id',
      refreshToken: 'ref',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    expect(getAuthToken()).toEqual({
      token: 'secret-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      zone: 'EU',
    });
  });

  it('returns zone but null token when user stored but no token', () => {
    mockedGetStoredUser.mockReturnValue({
      id: 'abc',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b',
      zone: 'US',
    });
    mockedGetStoredToken.mockReturnValue(undefined);
    expect(getAuthToken()).toEqual({
      token: null,
      expiresAt: null,
      zone: 'US',
    });
  });
});

// ── detect / status ────────────────────────────────────────────────

describe('runDetect + runStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ops-test-'));
    mockedGetStoredUser.mockReset();
    mockedGetStoredToken.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runDetect returns integration:null and confidence:none for an empty dir', async () => {
    const result = await runDetect(tmpDir);
    expect(result.integration).toBeNull();
    expect(result.confidence).toBe('none');
    expect(Array.isArray(result.signals)).toBe(true);
  });

  it('runDetect returns js-node for a plain Node.js project', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'x', main: 'index.js' }),
    );
    const result = await runDetect(tmpDir);
    expect(result.integration).toBe('javascript_node');
    expect(result.confidence).toBe('detected');
    expect(result.frameworkName).toBeTruthy();
  });

  it('runStatus composes detect + amplitude-installed + api-key + auth into one object', async () => {
    mockedGetStoredUser.mockReturnValue(undefined);
    const result = await runStatus(tmpDir);
    expect(result.installDir).toBe(tmpDir);
    expect(result.framework).toBeDefined();
    expect(result.amplitudeInstalled).toBeDefined();
    expect(result.apiKey).toBeDefined();
    expect(result.auth).toEqual({ loggedIn: false, email: null, zone: null });
  });

  it('runPlan resolves a relative installDir to an absolute path before persisting', async () => {
    // Regression: a relative `installDir` (e.g. `.` or `./foo`) used to be
    // persisted verbatim; `apply` would later re-resolve it against its
    // *own* cwd and run wizard against the wrong directory. Fix resolves
    // to absolute at plan time so the persisted path is portable.
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'x', main: 'index.js' }),
    );
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const result = await runPlan('.');
      expect(path.isAbsolute(result.plan.installDir)).toBe(true);
      // path.resolve doesn't follow symlinks (e.g. /var → /private/var on
      // macOS), so compare via fs.realpathSync to guard against the
      // /private/tmp ↔ /tmp aliasing that would otherwise flake the test.
      expect(fs.realpathSync(result.plan.installDir)).toBe(
        fs.realpathSync(tmpDir),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  // ── pre-existing event hints from .amplitude-events.json ──────────

  it('runPlan returns empty events when no .amplitude-events.json is present', async () => {
    const result = await runPlan(tmpDir);
    expect(result.plan.events).toEqual([]);
  });

  it('runPlan hydrates events from a valid .amplitude-events.json', async () => {
    // Resumability win unlocked by PR #274: a prior cancelled run leaves
    // .amplitude-events.json on disk; re-running `wizard plan` should
    // reflect those events in the new plan emission.
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      JSON.stringify([
        { name: 'Sign Up Completed', description: 'User finished signup' },
        { event: 'Checkout Started', description: 'Cart submitted' },
        // Casing variants the agent emits in the wild — both should land.
        { eventName: 'Page Viewed' },
        { event_name: 'Button Clicked', eventDescriptionAndReasoning: 'CTA' },
        // Empty/whitespace name → skipped silently.
        { name: '   ', description: 'no name' },
      ]),
    );

    const result = await runPlan(tmpDir);
    expect(result.plan.events).toEqual([
      { name: 'Sign Up Completed', description: 'User finished signup' },
      { name: 'Checkout Started', description: 'Cart submitted' },
      { name: 'Page Viewed', description: '' },
      { name: 'Button Clicked', description: 'CTA' },
    ]);
  });

  it('runPlan returns empty events for malformed .amplitude-events.json (no throw)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      '{ this is : not valid json',
    );
    const result = await runPlan(tmpDir);
    expect(result.plan.events).toEqual([]);
  });

  it('runPlan returns empty events for non-array .amplitude-events.json content (no throw)', async () => {
    // Object with no `events: [...]` wrapper and no array — schema rejects.
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      JSON.stringify({ planVersion: 2, count: 3 }),
    );
    const result = await runPlan(tmpDir);
    expect(result.plan.events).toEqual([]);
  });

  it('runPlan unwraps a `{ events: [...] }` wrapper object (matches TUI parser)', async () => {
    // Some skills imply the wrapper shape; the TUI parser unwraps it and so
    // do we, so the resumability hint hydrates instead of blanking out.
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      JSON.stringify({
        events: [
          { name: 'Wrapped Event', event_description: 'snake_case desc' },
          { name: 'Another One', eventDescription: 'camelCase desc' },
        ],
      }),
    );
    const result = await runPlan(tmpDir);
    expect(result.plan.events).toEqual([
      { name: 'Wrapped Event', description: 'snake_case desc' },
      { name: 'Another One', description: 'camelCase desc' },
    ]);
  });

  it('runPlan prefers concise event_description over verbose eventDescriptionAndReasoning', async () => {
    // Mirrors agent-interface.ts e3f25614 — if both fields are present,
    // the concise standard alias wins so the plan stays scannable.
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      JSON.stringify([
        {
          name: 'Sign Up',
          event_description: 'concise desc',
          eventDescriptionAndReasoning:
            'long-form reasoning about why we should track this and how it ties to retention…',
        },
      ]),
    );
    const result = await runPlan(tmpDir);
    expect(result.plan.events).toEqual([
      { name: 'Sign Up', description: 'concise desc' },
    ]);
  });
});
