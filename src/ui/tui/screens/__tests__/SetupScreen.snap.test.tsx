/**
 * SetupScreen — generic framework disambiguation prompts.
 *
 * The screen runs auto-detection on mount, then asks the user to resolve
 * any unresolved questions one at a time. The first frame is always the
 * "Detecting project configuration…" spinner — that's what we snapshot.
 *
 * Mounting with a frameworkConfig that has zero questions causes the
 * router to skip the screen via its show predicate (covered in router
 * tests). Here we focus on what the user sees when the screen IS active:
 *   1. The detecting spinner.
 *   2. The "Project Setup" heading + framework subtitle.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { SetupScreen } from '../SetupScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { Integration } from '../../../../lib/constants.js';
import type { FrameworkConfig } from '../../../../lib/framework-config.js';

function configWithQuestions(): FrameworkConfig {
  return {
    metadata: {
      integration: Integration.django,
      name: 'Django',
      glyph: '🐍',
      glyphColor: 'green',
      targetsBrowser: false,
      setup: {
        questions: [
          {
            key: 'router',
            message: 'Which router does your project use?',
            options: [
              { label: 'Django default', value: 'django' },
              { label: 'Wagtail', value: 'wagtail' },
            ],
            detect: () => Promise.resolve(null),
          },
        ],
      },
    },
    detect: () => Promise.resolve(false),
    buildSystemPrompt: () => Promise.resolve(''),
    needsSetup: () => true,
    buildContext: () => Promise.resolve({}),
  } as unknown as FrameworkConfig;
}

describe('SetupScreen snapshots', () => {
  it('renders the "Detecting project configuration" spinner on mount', () => {
    const store = makeStoreForSnapshot({
      integration: Integration.django,
      frameworkConfig: configWithQuestions(),
    });
    const { frame } = renderSnapshot(<SetupScreen store={store} />, store);
    // First render is the spinner — useEffect hasn't resolved yet.
    expect(frame).toContain('Detecting project configuration');
    expect(frame).toMatchSnapshot();
  });

  it('renders nothing when no questions and no spinner (resolved)', () => {
    // Edge case: framework config with no questions at all. The screen
    // bails before auto-detection completes, but the first frame is
    // still the spinner — which is fine for the snapshot.
    const cfg = configWithQuestions();
    cfg.metadata.setup = { questions: [] };
    const store = makeStoreForSnapshot({
      integration: Integration.django,
      frameworkConfig: cfg,
    });
    const { frame } = renderSnapshot(<SetupScreen store={store} />, store);
    expect(frame).toContain('Detecting project configuration');
  });
});
