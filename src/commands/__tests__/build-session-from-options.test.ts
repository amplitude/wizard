import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// Skip the per-project storage bootstrap (migration shim + project log
// file routing) — same reason auth-gate.test.ts sets it. Without this
// the test would migrate real on-disk paths and rotate logs.
process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { buildSessionFromOptions } from '../helpers.js';
import { replaceStoredUser } from '../../utils/ampli-settings.js';
import { writeAmpliConfig } from '../../lib/ampli-config.js';

// `buildSessionFromOptions` resolves `executionMode` from CLI options + TTY
// state and threads it into `buildSession`. The signup-flag gating axis
// matters here: in interactive (Ink TUI) mode, --auth-onboarding /
// --email / --accept-tos are ignored because the screens are canonical;
// in --ci / --agent they're honored because there's no TUI to override.
//
// `process.stdout.isTTY` flips the resolveMode classification, so each
// test stamps it explicitly and restores after.

describe('buildSessionFromOptions executionMode resolution', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
  });

  it('TUI mode (TTY, no other flags) drops signup flags as designed', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    const session = await buildSessionFromOptions({
      authOnboarding: 'create-account',
      email: 'ada@example.com',
      acceptTos: true,
    });

    expect(session.authOnboardingPath).toBe('sign_in');
    expect(session.signupEmail).toBeNull();
    expect(session.tosAccepted).toBeNull();
    // --full-name is still honored even in TUI mode (metadata-only).
  });

  it('CI mode (--ci) honors signup flags', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    const session = await buildSessionFromOptions(
      {
        authOnboarding: 'create-account',
        email: 'ada@example.com',
        acceptTos: true,
      },
      { ci: true },
    );

    expect(session.authOnboardingPath).toBe('create_account');
    expect(session.signupEmail).toBe('ada@example.com');
    expect(session.tosAccepted).toBe(true);
  });

  it('agent mode (--agent) honors signup flags', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    const session = await buildSessionFromOptions({
      agent: true,
      authOnboarding: 'create-account',
      email: 'ada@example.com',
      acceptTos: true,
    });

    expect(session.authOnboardingPath).toBe('create_account');
    expect(session.signupEmail).toBe('ada@example.com');
    expect(session.tosAccepted).toBe(true);
  });
});

// `prePopulateDisplayFields` runs at the tail of `buildSessionFromOptions`
// and reads from local cache (stored user + ampli.json) to fill the
// welcomeBack panel on the TUI's first frame. Two invariants matter:
//
//   1. The prefill is gated on interactive mode. Running in --ci / --agent
//      would silently populate fields the non-TUI flow uses as sentinels —
//      in particular, `session.region` is what gateAgentSignupArguments /
//      gateCiSignupAcceptToS read as "did the user pass --region", and a
//      cached zone there silently misroutes signup into the wrong DC.
//   2. Even in interactive mode, the prefill must NOT write
//      `session.region`. That field is reserved for explicit user intent
//      (see wizard-session.ts). IntroScreen reads the displayed zone
//      directly via tryResolveZone instead.
describe('buildSessionFromOptions display-field prefill', () => {
  let originalCacheDir: string | undefined;
  let originalIsTTY: boolean | undefined;
  let tmpCache: string;
  let tmpInstallDir: string;

  beforeEach(() => {
    originalCacheDir = process.env.AMPLITUDE_WIZARD_CACHE_DIR;
    originalIsTTY = process.stdout.isTTY;

    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'prefill-cache-'));
    tmpInstallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefill-project-'));
    process.env.AMPLITUDE_WIZARD_CACHE_DIR = tmpCache;

    // Stored OAuth user — populates getStoredUser() with a real account.
    replaceStoredUser(
      {
        id: 'user-abc',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        zone: 'eu',
      },
      {
        accessToken: 'access',
        idToken: 'id',
        refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    );

    // Per-project ampli config with a ProjectName so readAmpliConfig
    // returns something for the prefill to consume.
    writeAmpliConfig(tmpInstallDir, {
      OrgId: 'org-1',
      ProjectId: 'proj-1',
      ProjectName: 'Acme Analytics',
      Zone: 'eu',
    });
  });

  afterEach(() => {
    if (originalCacheDir === undefined) {
      delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
    } else {
      process.env.AMPLITUDE_WIZARD_CACHE_DIR = originalCacheDir;
    }
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
    fs.rmSync(tmpCache, { recursive: true, force: true });
    fs.rmSync(tmpInstallDir, { recursive: true, force: true });
  });

  it('interactive mode prefills userEmail + selectedProjectName', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    const session = await buildSessionFromOptions({
      installDir: tmpInstallDir,
    });

    expect(session.userEmail).toBe('ada@example.com');
    expect(session.selectedProjectName).toBe('Acme Analytics');
  });

  it('interactive mode does NOT write session.region from cache', async () => {
    // Critical contract: session.region is reserved for explicit user
    // intent. IntroScreen reads the displayed zone via tryResolveZone
    // (which DOES consult cache) — but session.region itself stays null
    // until the user signals intent. Writing it from cache would defeat
    // RegionSelect's gating AND the non-interactive signup sentinels.
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    const session = await buildSessionFromOptions({
      installDir: tmpInstallDir,
    });

    expect(session.region).toBeNull();
  });

  it('CI mode (--ci) skips the prefill entirely', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    const session = await buildSessionFromOptions(
      { installDir: tmpInstallDir },
      { ci: true },
    );

    expect(session.userEmail).toBeNull();
    expect(session.selectedProjectName).toBeNull();
    expect(session.region).toBeNull();
  });

  it('agent mode (--agent) skips the prefill entirely', async () => {
    // The signup gate uses session.region == null as the "user didn't
    // pass --region" sentinel. Without this skip, a stored zone would
    // silently bypass the gate and misroute the signup.
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    const session = await buildSessionFromOptions({
      agent: true,
      installDir: tmpInstallDir,
    });

    expect(session.userEmail).toBeNull();
    expect(session.selectedProjectName).toBeNull();
    expect(session.region).toBeNull();
  });
});
