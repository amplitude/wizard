import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// Skip the per-project storage bootstrap (migration shim + project log
// file routing) — same reason auth-gate.test.ts sets it. Without this
// the test would migrate real on-disk paths and rotate logs.
process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { buildSessionFromOptions } from '../helpers.js';

// `buildSessionFromOptions` resolves `executionMode` from CLI options + TTY
// state and threads it into `buildSession`. The interesting axis here is
// classic mode: it's interactive (TTY, no auto-approve) but doesn't own
// the Ink TUI's signup screens, so signup flags MUST survive the build.
//
// `process.stdout.isTTY` flips the resolveMode classification, so each
// test stamps it explicitly and restores after.

describe('buildSessionFromOptions executionMode resolution', () => {
  let originalIsTTY: boolean | undefined;
  let originalClassicEnv: string | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
    originalClassicEnv = process.env.AMPLITUDE_WIZARD_CLASSIC;
    delete process.env.AMPLITUDE_WIZARD_CLASSIC;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
    if (originalClassicEnv === undefined) {
      delete process.env.AMPLITUDE_WIZARD_CLASSIC;
    } else {
      process.env.AMPLITUDE_WIZARD_CLASSIC = originalClassicEnv;
    }
  });

  it('classic mode preserves signup flags despite TTY (regression: bugbot PR #535)', async () => {
    // Classic mode runs in a TTY but isn't the Ink TUI — its
    // runDirectSignupIfRequested in default.ts depends on these flags.
    // resolveMode classifies "TTY + no auto-approve" as 'interactive',
    // which would otherwise make buildSession strip them.
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });

    const session = await buildSessionFromOptions({
      classic: true,
      authOnboarding: 'create-account',
      email: 'ada@example.com',
      'full-name': 'Ada Lovelace',
      acceptTos: true,
    });

    expect(session.authOnboardingPath).toBe('create_account');
    expect(session.signupEmail).toBe('ada@example.com');
    expect(session.signupFullName).toBe('Ada Lovelace');
    expect(session.tosAccepted).toBe(true);
  });

  it('AMPLITUDE_WIZARD_CLASSIC=1 also preserves signup flags', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });
    process.env.AMPLITUDE_WIZARD_CLASSIC = '1';

    const session = await buildSessionFromOptions({
      authOnboarding: 'create-account',
      email: 'ada@example.com',
      'full-name': 'Ada Lovelace',
      acceptTos: true,
    });

    expect(session.authOnboardingPath).toBe('create_account');
    expect(session.signupEmail).toBe('ada@example.com');
    expect(session.tosAccepted).toBe(true);
  });

  it('TUI mode (TTY, no --classic) drops signup flags as designed', async () => {
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
