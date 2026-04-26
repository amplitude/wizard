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
import { describe, it, expect } from 'vitest';
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
  it('renders the detecting state with spinner and "Detecting project framework" copy', () => {
    const store = makeStoreForSnapshot({
      detectionComplete: false,
      frameworkConfig: null,
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    expect(frame).toContain('Amplitude Wizard');
    expect(frame).toContain('Detecting project framework');
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
    // Continue / Change framework / Cancel actions
    expect(frame).toContain('Continue');
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
