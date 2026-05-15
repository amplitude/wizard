/**
 * IntroScreen — new-UX returning-user welcome variant.
 *
 * Gated on `WIZARD_NEW_UX === '1'`. When set AND the session is restored
 * from a checkpoint, the IntroScreen swaps the legacy 3-option picker
 * (Resume / Start fresh / Cancel) for a bordered checkpoint summary +
 * 4 hotkey options (Resume / Start fresh / Install MCP / Connect Slack).
 *
 * Legacy path (gate off) is unchanged — covered by IntroScreen.snap.test.tsx.
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

function fakeConfig(integration: Integration): FrameworkConfig {
  return {
    metadata: {
      integration,
      name: 'Next.js',
      glyph: '▲',
      glyphColor: 'white',
      targetsBrowser: true,
    },
    detect: () => Promise.resolve(false),
    buildSystemPrompt: () => Promise.resolve(''),
    needsSetup: () => false,
    buildContext: () => Promise.resolve({}),
  } as unknown as FrameworkConfig;
}

describe('IntroScreen — returning-user welcome (WIZARD_NEW_UX)', () => {
  const ORIGINAL_GATE = process.env.WIZARD_NEW_UX;
  let installDir: string;

  beforeEach(() => {
    process.env.WIZARD_NEW_UX = '1';
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-newux-'));
  });

  afterEach(() => {
    if (ORIGINAL_GATE === undefined) {
      delete process.env.WIZARD_NEW_UX;
    } else {
      process.env.WIZARD_NEW_UX = ORIGINAL_GATE;
    }
    try {
      fs.rmSync(installDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it('renders the bordered checkpoint summary with the 4 hotkey options', () => {
    // Write a real events.json so the events-wired count reads as
    // something other than 0. Schema: `{"events":[{"name": "..."}, ...]}`
    fs.mkdirSync(path.join(installDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, '.amplitude', 'events.json'),
      JSON.stringify({
        events: [{ name: 'Login Clicked' }, { name: 'Signup Started' }],
      }),
    );

    const store = makeStoreForSnapshot({
      installDir,
      _restoredFromCheckpoint: true,
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
      selectedOrgName: 'Acme Corp',
      selectedProjectName: 'Acme Web',
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);

    // New-UX heading copy diverges from the legacy "A previous session
    // was interrupted." flat layout.
    expect(frame).toContain('Welcome back to Amplitude Wizard');
    expect(frame).toContain('A previous session was interrupted');

    // Bordered summary surfaces the last-step + events wired count.
    expect(frame).toContain('Last step');
    expect(frame).toContain('Project selected');
    expect(frame).toContain('Events wired');
    expect(frame).toContain('Next.js');
    expect(frame).toContain('Acme Corp');

    // All four hotkey options render with their bracketed prefix.
    expect(frame).toContain('[r] Resume');
    expect(frame).toContain('[s] Start fresh');
    expect(frame).toContain('[m] Install MCP');
    expect(frame).toContain('[c] Connect Slack');
  });

  it('falls back to the legacy 3-option picker when WIZARD_NEW_UX is off', () => {
    delete process.env.WIZARD_NEW_UX;
    const store = makeStoreForSnapshot({
      installDir,
      _restoredFromCheckpoint: true,
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
      selectedOrgName: 'Acme Corp',
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);

    // Legacy phrasing — no "Welcome back to" heading.
    expect(frame).toContain('A previous session was interrupted');
    expect(frame).not.toContain('Welcome back to Amplitude Wizard');
    // Legacy 3-option picker, no hotkey prefixes.
    expect(frame).toContain('Resume where you left off');
    expect(frame).toContain('Start fresh');
    expect(frame).toContain('Cancel');
    expect(frame).not.toContain('[m] Install MCP');
    expect(frame).not.toContain('[c] Connect Slack');
  });

  it('synthesizes a "Last step" label even when no events.json is on disk', () => {
    const store = makeStoreForSnapshot({
      installDir,
      _restoredFromCheckpoint: true,
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeConfig(Integration.nextjs),
      // No org / project — checkpoint stopped at framework-detection.
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('Framework detected');
    expect(frame).toContain('Events wired');
    // Zero events wired — explicit "0" rather than hidden so the user
    // knows the count came up empty.
    expect(frame).toContain('Events wired 0');
  });
});
