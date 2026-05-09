/**
 * capture-current-screens — render every wizard screen at a representative
 * state and write the frames to `docs/_tui-current-state.md`.
 *
 * This is a one-shot "live capture" generator, not a regression test. The
 * output is the source of truth for the "current state" half of the
 * redesign mocks doc. It runs the same rendering path as production
 * (ink-testing-library + the real screen components + the real
 * `WizardStore`), so the captured frames are what users actually see.
 *
 * To re-generate after copy/layout changes:
 *
 *     pnpm exec vitest run src/ui/tui/__tests__/capture-current-screens.test.tsx
 *
 * The doc lives at `docs/_tui-current-state.md` (gitignored prefix on
 * purpose — it's a generated artifact, but committed alongside the mocks
 * so reviewers can see the captured baseline without re-running tests).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import { describe, it } from 'vitest';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from './snapshot-utils.js';

import { IntroScreen } from '../screens/IntroScreen.js';
import { SetupScreen } from '../screens/SetupScreen.js';
import { AuthScreen } from '../screens/AuthScreen.js';
import { CreateProjectScreen } from '../screens/CreateProjectScreen.js';
import { RegionSelectScreen } from '../screens/RegionSelectScreen.js';
import { SignupEmailScreen } from '../screens/SignupEmailScreen.js';
import { SigningUpScreen } from '../screens/SigningUpScreen.js';
import { SignupFullNameScreen } from '../screens/SignupFullNameScreen.js';
import { ToSScreen } from '../screens/ToSScreen.js';
import { DataSetupScreen } from '../screens/DataSetupScreen.js';
import { ActivationOptionsScreen } from '../screens/ActivationOptionsScreen.js';
import { RunScreen } from '../screens/RunScreen.js';
import { McpScreen } from '../screens/McpScreen.js';
import { DataIngestionCheckScreen } from '../screens/DataIngestionCheckScreen.js';
import { SlackScreen } from '../screens/SlackScreen.js';
import { LogoutScreen } from '../screens/LogoutScreen.js';
import { LoginScreen } from '../screens/LoginScreen.js';
import { OutroScreen } from '../screens/OutroScreen.js';
import { OutageScreen } from '../screens/OutageScreen.js';

import { Integration } from '../../../lib/constants.js';
import { OutroKind } from '../session-constants.js';
import { TaskStatus } from '../../wizard-ui.js';
import { configureLogFile } from '../../../lib/observability/index.js';
import { createMcpInstaller } from '../services/mcp-installer.js';
import type { FrameworkConfig } from '../../../lib/framework-config.js';

function fakeNextjsConfig(
  overrides: Partial<FrameworkConfig['metadata']> = {},
): FrameworkConfig {
  return {
    metadata: {
      integration: Integration.nextjs,
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

interface Capture {
  /** Logical screen name (e.g. "IntroScreen"). */
  screen: string;
  /** Short state description (e.g. "detecting", "welcome back"). */
  state: string;
  /** Sanitized last frame from ink-testing-library. */
  frame: string;
}

const captures: Capture[] = [];

function record(screen: string, state: string, frame: string): void {
  captures.push({ screen, state, frame });
}

describe('capture wizard screens (writes docs/_tui-current-state.md)', () => {
  it('captures IntroScreen — detecting', () => {
    const store = makeStoreForSnapshot({
      detectionComplete: false,
      frameworkConfig: null,
      installDir: '/projects/my-app',
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    record('IntroScreen', 'detecting', frame);
  });

  it('captures IntroScreen — detected (Next.js)', () => {
    const store = makeStoreForSnapshot({
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeNextjsConfig(),
      installDir: '/projects/my-app',
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    record('IntroScreen', 'detected (Next.js)', frame);
  });

  it('captures IntroScreen — generic fallback', () => {
    const store = makeStoreForSnapshot({
      detectionComplete: true,
      integration: Integration.generic,
      frameworkConfig: fakeNextjsConfig({
        integration: Integration.generic,
        name: 'Generic',
        glyph: undefined,
      }),
      installDir: '/projects/my-app',
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    record('IntroScreen', 'generic fallback', frame);
  });

  it('captures IntroScreen — welcome back', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const os = require('node:os') as typeof import('node:os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-welcome-'));
    fs.writeFileSync(
      path.join(tmp, 'ampli.json'),
      JSON.stringify({ OrgId: 'org-1', ProjectId: 'prj-1' }),
    );
    fs.mkdirSync(path.join(tmp, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.amplitude', 'events.json'),
      JSON.stringify([
        { name: 'signup_started', description: '' },
        { name: 'signup_completed', description: '' },
        { name: 'checkout_started', description: '' },
      ]),
    );

    const store = makeStoreForSnapshot({
      installDir: tmp,
      userEmail: 'kelson@amplitude.com',
      selectedProjectName: 'Acme Analytics',
      region: 'us',
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeNextjsConfig(),
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    record('IntroScreen', 'welcome back (returning user)', frame);
  });

  it('captures IntroScreen — resume from checkpoint', () => {
    const store = makeStoreForSnapshot({
      _restoredFromCheckpoint: true,
      detectionComplete: true,
      detectedFrameworkLabel: 'Next.js',
      integration: Integration.nextjs,
      frameworkConfig: fakeNextjsConfig(),
      selectedOrgName: 'Acme Corp',
      installDir: '/projects/my-app',
    });
    const { frame } = renderSnapshot(<IntroScreen store={store} />, store);
    record('IntroScreen', 'resume from checkpoint', frame);
  });

  it('captures SetupScreen — detecting configuration', () => {
    const store = makeStoreForSnapshot({
      frameworkConfig: fakeNextjsConfig(),
    });
    const { frame } = renderSnapshot(<SetupScreen store={store} />, store);
    record('SetupScreen', 'detecting', frame);
  });

  it('captures AuthScreen — OAuth waiting', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      loginUrl:
        'https://app.amplitude.com/oauth?response_type=code&client_id=wizard',
      pendingOrgs: null,
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    record('AuthScreen', 'OAuth waiting', frame);
  });

  it('captures AuthScreen — org picker', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        { id: 'org-1', name: 'Acme Corp', projects: [] },
        { id: 'org-2', name: 'Globex', projects: [] },
        { id: 'org-3', name: 'Initech', projects: [] },
      ],
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    record('AuthScreen', 'org picker', frame);
  });

  it('captures AuthScreen — project picker', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        {
          id: 'org-1',
          name: 'Acme Corp',
          projects: [
            { id: 'ws-1', name: 'Production' },
            { id: 'ws-2', name: 'Staging' },
            { id: 'ws-3', name: 'Internal Tools' },
          ],
        },
        { id: 'org-2', name: 'Globex', projects: [] },
      ],
      selectedOrgId: 'org-1',
      selectedOrgName: 'Acme Corp',
    });
    const { frame } = renderSnapshot(<AuthScreen store={store} />, store);
    record('AuthScreen', 'project picker', frame);
  });

  it('captures CreateProjectScreen — idle prompt', () => {
    const store = makeStoreForSnapshot({
      selectedOrgName: 'Acme Corp',
    });
    const { frame } = renderSnapshot(
      <CreateProjectScreen store={store} />,
      store,
    );
    record('CreateProjectScreen', 'idle prompt', frame);
  });

  it('captures RegionSelectScreen — first time picker', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <RegionSelectScreen store={store} />,
      store,
    );
    record('RegionSelectScreen', 'first-time picker', frame);
  });

  it('captures SignupEmailScreen — empty input', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <SignupEmailScreen store={store} />,
      store,
    );
    record('SignupEmailScreen', 'empty input', frame);
  });

  it('captures SigningUpScreen — checking account', () => {
    const store = makeStoreForSnapshot({
      signupEmail: 'kelson@amplitude.com',
    });
    const { frame } = renderSnapshot(<SigningUpScreen store={store} />, store);
    record('SigningUpScreen', 'checking account', frame);
  });

  it('captures SignupFullNameScreen — empty input', () => {
    const store = makeStoreForSnapshot({
      signupEmail: 'kelson@amplitude.com',
    });
    const { frame } = renderSnapshot(
      <SignupFullNameScreen store={store} />,
      store,
    );
    record('SignupFullNameScreen', 'empty input', frame);
  });

  it('captures ToSScreen — terms picker', () => {
    const store = makeStoreForSnapshot({
      signupEmail: 'kelson@amplitude.com',
    });
    const { frame } = renderSnapshot(<ToSScreen store={store} />, store);
    record('ToSScreen', 'terms picker', frame);
  });

  it('captures DataSetupScreen — analyzing project', () => {
    const store = makeStoreForSnapshot({
      integration: Integration.nextjs,
    });
    const { frame } = renderSnapshot(<DataSetupScreen store={store} />, store);
    record('DataSetupScreen', 'analyzing project', frame);
  });

  it('captures ActivationOptionsScreen — installed waiting', () => {
    const store = makeStoreForSnapshot({
      integration: Integration.nextjs,
      activationLevel: 'partial',
      activationDiagnostics: {
        snippetConfigured: true,
        recentEventCount: 0,
        approvedEvents: [],
        ingestedEvents: [],
        eventsCheckedAt: Date.now(),
      },
    });
    const { frame } = renderSnapshot(
      <ActivationOptionsScreen store={store} />,
      store,
    );
    record('ActivationOptionsScreen', 'installed - waiting for events', frame);
  });

  it('captures RunScreen — cold start, first task in progress', () => {
    const store = makeStoreForSnapshot({
      runStartedAt: Date.now() - 55_000,
      integration: Integration.nextjs,
      frameworkConfig: fakeNextjsConfig(),
      selectedProjectName: 'Acme Analytics',
      region: 'us',
      discoveryFacts: [
        {
          id: 'fact-framework',
          label: 'Framework',
          value: 'JavaScript (Web)',
          discoveredAt: Date.now() - 50_000,
        },
        {
          id: 'fact-typescript',
          label: 'TypeScript',
          value: 'yes',
          discoveredAt: Date.now() - 49_000,
        },
        {
          id: 'fact-pkg',
          label: 'Package manager',
          value: 'Yarn V1',
          discoveredAt: Date.now() - 48_000,
        },
        {
          id: 'fact-project',
          label: 'Project',
          value: 'Amplitude',
          discoveredAt: Date.now() - 47_000,
        },
        {
          id: 'fact-region',
          label: 'Region',
          value: 'US',
          discoveredAt: Date.now() - 46_000,
        },
      ],
    });
    store.setTasks([
      {
        label: 'Detect your project setup',
        activeForm: 'Detecting your project setup',
        status: TaskStatus.InProgress,
        done: false,
      },
      {
        label: 'Install Amplitude',
        activeForm: 'Installing Amplitude',
        status: TaskStatus.Pending,
        done: false,
      },
      {
        label: 'Plan and approve events to track',
        activeForm: 'Planning events',
        status: TaskStatus.Pending,
        done: false,
      },
      {
        label: 'Wire up event tracking',
        activeForm: 'Wiring up event tracking',
        status: TaskStatus.Pending,
        done: false,
      },
    ]);
    store.pushStatus('Reading package.json');
    const { frame } = renderSnapshot(<RunScreen store={store} />, store);
    record('RunScreen', 'cold start, first task in progress', frame);
  });

  it('captures McpScreen — looking for AI tools', () => {
    const store = makeStoreForSnapshot();
    const installer = createMcpInstaller(false);
    const { frame } = renderSnapshot(
      <McpScreen store={store} installer={installer} />,
      store,
    );
    record('McpScreen', 'looking for AI tools', frame);
  });

  it('captures DataIngestionCheckScreen — listening', () => {
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      integration: Integration.nextjs,
      activationLevel: 'none',
    });
    const { frame } = renderSnapshot(
      <DataIngestionCheckScreen store={store} />,
      store,
    );
    record('DataIngestionCheckScreen', 'listening for events', frame);
  });

  it('captures SlackScreen — connect prompt', () => {
    const store = makeStoreForSnapshot({
      region: 'us',
    });
    const { frame } = renderSnapshot(<SlackScreen store={store} />, store);
    record('SlackScreen', 'connect prompt', frame);
  });

  it('captures LogoutScreen — confirm', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <LogoutScreen
        installDir={store.session.installDir}
        onComplete={() => {}}
        onLoggedOut={() => {}}
      />,
      store,
    );
    record('LogoutScreen', 'confirm prompt', frame);
  });

  it('captures LoginScreen — refreshing credentials', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <LoginScreen store={store} onComplete={() => {}} />,
      store,
    );
    record('LoginScreen', 'refreshing credentials', frame);
  });

  it('captures OutroScreen — success', () => {
    configureLogFile({ path: '<tmp>/amplitude-wizard.log' });
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Success,
        changes: [
          'Installed @amplitude/analytics-browser',
          'Added .env.local with AMPLITUDE_API_KEY',
          'Added 3 planned events to your tracking plan',
        ],
        docsUrl: 'https://amplitude.com/docs/get-started/quickstart',
        continueUrl:
          'https://app.amplitude.com/analytics/amplitude/project/769610',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    record('OutroScreen', 'success', frame);
  });

  it('captures OutroScreen — error', () => {
    configureLogFile({ path: '<tmp>/amplitude-wizard.log' });
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message:
          'The agent could not detect your framework. Re-run with --menu to pick one manually.',
        docsUrl: 'https://amplitude.com/docs/get-started/quickstart',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    record('OutroScreen', 'error', frame);
  });

  it('captures OutroScreen — cancel', () => {
    configureLogFile({ path: '<tmp>/amplitude-wizard.log' });
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Cancel,
        message: 'Setup cancelled.',
        docsUrl: 'https://amplitude.com/docs/get-started/quickstart',
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    record('OutroScreen', 'cancel', frame);
  });

  it('captures OutageScreen — degraded services banner', () => {
    const store = makeStoreForSnapshot({
      serviceStatus: {
        description:
          'Elevated error rates affecting Anthropic API requests via gateway.',
        statusPageUrl: 'https://status.anthropic.com',
      },
    });
    const { frame } = renderSnapshot(<OutageScreen store={store} />, store);
    record('OutageScreen', 'degraded services', frame);
  });

  it('writes captures to docs/_tui-current-state.md', () => {
    const docPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'docs',
      '_tui-current-state.md',
    );
    const out: string[] = [];
    out.push('# TUI — current state (live captures)\n');
    out.push(
      '> Generated by `src/ui/tui/__tests__/capture-current-screens.test.tsx`. ',
    );
    out.push(
      'Each frame is the literal `lastFrame()` from `ink-testing-library` ',
    );
    out.push('rendered against a stubbed `WizardStore`. ANSI colors stripped.\n');
    out.push('Re-generate with:\n');
    out.push('```bash');
    out.push(
      'pnpm exec vitest run src/ui/tui/__tests__/capture-current-screens.test.tsx',
    );
    out.push('```\n');

    const byScreen = new Map<string, Capture[]>();
    for (const c of captures) {
      const arr = byScreen.get(c.screen) ?? [];
      arr.push(c);
      byScreen.set(c.screen, arr);
    }

    // Replace per-run tmpdir paths so the doc is reproducible across
    // hosts. Capture paths under /tmp/, /var/folders/ (macOS), and
    // /private/var/ collapse to a deterministic placeholder.
    const sanitize = (s: string): string =>
      s
        .replace(/\/tmp\/capture-welcome-[A-Za-z0-9]+/g, '/projects/my-app')
        .replace(/\/tmp\/wizard-snapshot-[A-Za-z0-9]+/g, '/projects/my-app')
        .replace(
          /\/var\/folders\/[^\s]+?\/wizard-snapshot-[A-Za-z0-9]+/g,
          '/projects/my-app',
        );

    for (const [screen, list] of byScreen) {
      out.push(`## ${screen}\n`);
      for (const c of list) {
        out.push(`### state: ${c.state}\n`);
        out.push('```');
        out.push(sanitize(c.frame));
        out.push('```\n');
      }
    }

    fs.mkdirSync(path.dirname(docPath), { recursive: true });
    fs.writeFileSync(docPath, out.join('\n'), 'utf8');
  });
});
