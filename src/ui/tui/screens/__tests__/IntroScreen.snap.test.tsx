/**
 * IntroScreen — snapshots for the four intro states.
 *
 * The screen branches on a tangled set of conditions (detection complete,
 * framework picked, restored from checkpoint, manual selection, generic
 * fallback). Snapshotting each lets us catch copy / layout regressions
 * without setting up the framework registry async-import dance.
 *
 * Coverage:
 *   1. Detecting — spinner + heading
 *   2. Detection succeeded with a real framework — labelled "(detected)"
 *   3. Generic fallback — "No framework detected" copy + picker hint
 *   4. Resume-from-checkpoint — "previous session was interrupted" panel
 *
 * Note: rendering past the initial frame requires the framework registry's
 * dynamic import, which Vitest can't await synchronously. We render the
 * first frame only, which is enough to pin the rendered text.
 */

import React from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IntroScreen } from '../IntroScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { Integration } from '../../../../lib/constants.js';
import type { FrameworkConfig } from '../../../../lib/framework-config.js';

/**
 * Build a minimal FrameworkConfig for tests. The screen only reads
 * metadata.name / glyph / glyphColor / preRunNotice / beta — everything
 * else can be a no-op stub.
 */
function fakeConfig(
  integration: Integration,
  overrides: Partial<FrameworkConfig['metadata']> = {},
): FrameworkConfig {
  return {
    metadata: {
      integration,
      name: 'Next.js',
      glyph: '▲',
      glyphColor: 'white',
      targetsBrowser: true,
      ...overrides,
    },
    detect: () => Promise.resolve(false),
    buildSystemPrompt: () => Promise.resolve(''),
    needsSetup: () => false,
    buildContext: () => Promise.resolve({}),
  } as unknown as FrameworkConfig;
}

describe('IntroScreen snapshots', () => {
  it('renders the detecting state with target line + "Scanning …" spinner', () => {
    const store = makeStoreForSnapshot({
      detectionComplete: false,
      frameworkConfig: null,
      // Pin a stable path so the snapshot doesn't include a per-run
      // tmpdir like `/var/folders/.../wizard-snapshot-XXX`.
      installDir: '/projects/my-app',
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('Amplitude Wizard');
    // Target line is visible during detection — that's the whole point
    // of moving it above the spinner. If a user pointed the wizard at
    // the wrong directory, they need to spot it here.
    expect(frame).toContain('Target');
    expect(frame).toContain('Scanning');
    expect(frame).toMatchSnapshot();
  });

  it('shows the detected framework with "(detected)" suffix and Continue picker', () => {
    const store = makeStoreForSnapshot({
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('Next.js (detected)');
    // Continue (sign-in vs create) / Change framework / Cancel actions
    expect(frame).toContain('Continue — sign in');
    expect(frame).toContain('create');
    expect(frame).toContain('Change framework');
    expect(frame).toContain('Cancel');
  });

  it('shows the BETA tag when the framework metadata.beta is true', () => {
    const store = makeStoreForSnapshot({
      detectionComplete: true,
      detectedFrameworkLabel: 'Unreal',
      integration: Integration.unreal,
      frameworkConfig: fakeConfig(Integration.unreal, {
        name: 'Unreal',
        beta: true,
      }),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('[BETA]');
  });

  it('shows the preRunNotice from framework metadata when set', () => {
    const store = makeStoreForSnapshot({
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs, {
        preRunNotice: 'Heads up: this guide assumes app router.',
      }),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('Heads up: this guide assumes app router.');
  });

  it('shows the generic fallback messaging when integration is generic', () => {
    const store = makeStoreForSnapshot({
      detectionComplete: true,
      integration: Integration.generic,
      frameworkConfig: fakeConfig(Integration.generic, {
        name: 'Generic',
        glyph: undefined,
      }),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('No framework detected');
    // Generic frameworks should NOT get the "(detected)" suffix
    expect(frame).not.toContain('(detected)');
  });

  it('renders the resume-from-checkpoint picker when _restoredFromCheckpoint is true', () => {
    const store = makeStoreForSnapshot({
      _restoredFromCheckpoint: true,
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
      selectedOrgName: 'Acme Corp',
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('A previous session was interrupted');
    expect(frame).toContain('Resume where you left off');
    expect(frame).toContain('Start fresh');
    expect(frame).toContain('Acme Corp');
  });
});

// ── Welcome-back panel ──────────────────────────────────────────────────
//
// Returning users (signed in + ampli.json on disk) get a personalized
// header instead of the marketing tagline. These tests exercise the
// gating logic and the three-line content fallbacks.
describe('IntroScreen — welcome-back panel', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-welcome-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(installDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  /** Helper — minimal ampli.json signal that this is a known project. */
  function writeAmpliConfig(): void {
    fs.writeFileSync(
      path.join(installDir, 'ampli.json'),
      JSON.stringify({ OrgId: 'org-1', ProjectId: 'prj-1' }),
    );
  }

  /** Helper — drop a canonical events.json with the given names + mtime. */
  function writeEventsFile(names: string[], mtime?: Date): void {
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    const eventsPath = path.join(installDir, '.amplitude', 'events.json');
    fs.writeFileSync(
      eventsPath,
      JSON.stringify(names.map((n) => ({ name: n, description: '' }))),
    );
    if (mtime) {
      fs.utimesSync(eventsPath, mtime, mtime);
    }
  }

  it('greets a returning user with project + region + events', () => {
    writeAmpliConfig();
    writeEventsFile(
      ['signup_started', 'signup_completed', 'checkout_started'],
      new Date(Date.now() - 2 * 60 * 60_000), // 2 hours ago
    );

    const store = makeStoreForSnapshot({
      installDir,
      userEmail: 'kelson@amplitude.com',
      selectedProjectName: 'Acme Analytics',
      region: 'us',
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('Welcome back, kelson@amplitude.com');
    expect(frame).toContain('Acme Analytics · US');
    expect(frame).toContain('3 events instrumented');
    expect(frame).toContain('hours ago');
    // Signed-in users must not see first-run "sign in" menu copy — it
    // contradicts the welcome-back header.
    expect(frame).toContain("You're signed in as kelson@amplitude.com");
    expect(frame).toContain('Continue — workspace setup');
    expect(frame).toContain('Create a new Amplitude account');
    expect(frame).not.toContain('Sign in to an existing Amplitude account');
    expect(frame).not.toContain('new Amplitude organization');
    // Marketing tagline must NOT appear for returning users — that's
    // the whole point of this branch.
    expect(frame).not.toContain('AI-powered analytics setup in minutes');
  });

  it('hides the events line when no events.json exists', () => {
    writeAmpliConfig();

    const store = makeStoreForSnapshot({
      installDir,
      userEmail: 'kelson@amplitude.com',
      selectedProjectName: 'Acme Analytics',
      region: 'us',
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('Welcome back, kelson@amplitude.com');
    expect(frame).toContain('Acme Analytics');
    expect(frame).not.toContain('events instrumented');
  });

  it('falls back to email-only line when project name is not yet known', () => {
    writeAmpliConfig();

    const store = makeStoreForSnapshot({
      installDir,
      userEmail: 'kelson@amplitude.com',
      selectedProjectName: null,
      region: null,
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('Welcome back, kelson@amplitude.com');
    // Must NOT crash or render a stray separator when project + region
    // are both null.
    expect(frame).not.toContain(' · undefined');
  });

  it('silently skips events line when events.json is malformed', () => {
    writeAmpliConfig();
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'events.json'),
      '{ this is not valid json',
    );

    const store = makeStoreForSnapshot({
      installDir,
      userEmail: 'kelson@amplitude.com',
      selectedProjectName: 'Acme Analytics',
      region: 'us',
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
    });
    // The whole render must not throw — the helper swallows the parse
    // error and returns 0 events.
    expect(() =>
      renderSnapshot(<IntroScreen store={store} />, store),
    ).not.toThrow();
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('Welcome back, kelson@amplitude.com');
    expect(frame).not.toContain('events instrumented');
  });

  it('keeps the marketing tagline for first-time users (no userEmail)', () => {
    writeAmpliConfig();

    const store = makeStoreForSnapshot({
      installDir,
      userEmail: null,
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('AI-powered analytics setup in minutes');
    expect(frame).not.toContain('Welcome back');
    expect(frame).toContain('Continue — sign in');
  });

  it('keeps the marketing tagline when ampli.json is absent', () => {
    // userEmail set but no ampli.json — this is the "signed in but new
    // project" case. Hold off the welcome-back personalization until we
    // have at least one disk signal that the user has run the wizard
    // here before.
    const store = makeStoreForSnapshot({
      installDir,
      userEmail: 'kelson@amplitude.com',
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('AI-powered analytics setup in minutes');
    expect(frame).not.toContain('Welcome back');
    // Signed in but first run in this directory — same menu as welcome-back.
    expect(frame).toContain("You're signed in as kelson@amplitude.com");
    expect(frame).toContain('Continue — workspace setup');
    expect(frame).toContain('Create a new Amplitude account');
  });
});
