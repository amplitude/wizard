import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// Skip the per-project storage bootstrap (migration shim + project log
// file routing) — same reason auth-gate.test.ts sets it. Without this
// the test would migrate real on-disk paths and rotate logs.
process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { buildSessionFromOptions } from '../helpers.js';

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
