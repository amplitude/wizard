import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'node:assert';
import { WizardRouter } from '../../src/ui/tui/router.js';
import { Screen, Flow } from '../../src/ui/tui/flows.js';
import {
  buildSession,
  type WizardSession,
} from '../../src/lib/wizard-session.js';
import { Integration } from '../../src/lib/constants.js';
import type { FrameworkConfig } from '../../src/lib/framework-config.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let router: WizardRouter;
let session: WizardSession;

/** Minimal FrameworkConfig with no setup questions. */
function makeConfig(name: string): FrameworkConfig {
  return {
    metadata: {
      name,
      integration: Integration.nextjs,
      docsUrl: 'https://example.com',
    },
    detection: {
      packageName: 'next',
      packageDisplayName: 'Next.js',
      getVersion: () => undefined,
      detect: async () => true,
      detectPackageManager: async () => ({ detected: [], primary: null, recommendation: '' }),
    },
    environment: {} as FrameworkConfig['environment'],
    analytics: {} as FrameworkConfig['analytics'],
    prompts: {} as FrameworkConfig['prompts'],
    ui: {} as FrameworkConfig['ui'],
  };
}

/** FrameworkConfig with one unanswered setup question. */
function makeConfigWithQuestion(key: string): FrameworkConfig {
  const base = makeConfig('Next.js');
  return {
    ...base,
    metadata: {
      ...base.metadata,
      setup: {
        questions: [
          {
            key,
            message: `Which ${key}?`,
            options: [
              { label: 'Option A', value: 'a' },
              { label: 'Option B', value: 'b' },
            ],
            detect: async () => null, // cannot auto-detect → must ask user
          },
        ],
      },
    },
  };
}

function advancePastAuth(s: WizardSession): void {
  s.credentials = {
    accessToken: 'tok',
    projectApiKey: 'key',
    host: 'https://api.amplitude.com',
    projectId: 0,
  };
  s.region = 'us';
  s.projectHasData = false;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

Before(function () {
  router = new WizardRouter(Flow.Wizard);
  session = buildSession({});
  advancePastAuth(session);
});

// ── Given ─────────────────────────────────────────────────────────────────────

Given('I am in the Framework Detection flow', function () {
  // State is already at Intro after advancePastAuth in Before
  const screen = router.resolve(session);
  assert.strictEqual(screen, Screen.Intro, `Expected Intro but got ${screen}`);
});

Given('my framework has setup questions', function () {
  const config = makeConfigWithQuestion('router');
  session.frameworkConfig = config;
  session.integration = Integration.nextjs;
  session.detectionComplete = true;
});

Given('I run the wizard with the "--menu" flag', function () {
  session.menu = true;
  session.detectionComplete = true;
  // menu=true means detection completed without a framework
  session.frameworkConfig = null;
  session.integration = null;
});

// ── When ──────────────────────────────────────────────────────────────────────

When('the wizard successfully auto-detects my framework', function () {
  const config = makeConfig('Next.js');
  session.integration = Integration.nextjs;
  session.frameworkConfig = config;
  session.detectionComplete = true;
});

When('I confirm the detection', function () {
  session.setupConfirmed = true;
});

When('I confirm', function () {
  session.setupConfirmed = true;
});

When('there are no unresolved setup questions', function () {
  // frameworkConfig has no setup questions — needsSetup returns false
  if (session.frameworkConfig) {
    (session.frameworkConfig.metadata as unknown as Record<string, unknown>).setup =
      undefined;
  }
});

When('all setup questions can be auto-detected', function () {
  // Simulate auto-detection: populate frameworkContext with all question keys
  if (session.frameworkConfig?.metadata.setup?.questions) {
    for (const q of session.frameworkConfig.metadata.setup.questions) {
      session.frameworkContext[q.key] = 'auto-detected-value';
    }
  }
});

When('some setup questions cannot be auto-detected', function () {
  // frameworkContext is empty — needsSetup returns true
  session.frameworkContext = {};
});

When('the wizard cannot auto-detect my framework', function () {
  session.detectionComplete = true;
  session.frameworkConfig = null;
  session.integration = null;
});

When('I select a framework from the picker', function () {
  const config = makeConfig('Vue');
  session.frameworkConfig = config;
  session.integration = Integration.vue;
  session.detectionComplete = true;
});

When('I answer all questions', function () {
  if (session.frameworkConfig?.metadata.setup?.questions) {
    for (const q of session.frameworkConfig.metadata.setup.questions) {
      session.frameworkContext[q.key] = 'user-answer';
    }
  }
});

// ── Then ──────────────────────────────────────────────────────────────────────

Then('I should see the detected framework displayed', function () {
  // Router still shows Intro — framework is set, not yet confirmed
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Intro,
    `Expected Intro (showing detection result) but got ${screen}`,
  );
  assert.ok(
    session.frameworkConfig !== null,
    'Expected frameworkConfig to be set',
  );
});

Then('I should proceed to the Agent Run', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Run,
    `Expected Run but got ${screen}`,
  );
});

Then('I should see the framework picker menu', function () {
  // Router shows Intro with no frameworkConfig — IntroScreen shows picker
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Intro,
    `Expected Intro (picker) but got ${screen}`,
  );
  assert.strictEqual(
    session.frameworkConfig,
    null,
    'Expected frameworkConfig to be null (picker state)',
  );
});

Then(
  'I should see the framework picker menu without attempting auto-detection',
  function () {
    const screen = router.resolve(session);
    assert.strictEqual(
      screen,
      Screen.Intro,
      `Expected Intro (menu mode picker) but got ${screen}`,
    );
    assert.ok(session.menu, 'Expected session.menu to be true');
  },
);

Then('the answers should be filled in automatically', function () {
  if (session.frameworkConfig?.metadata.setup?.questions) {
    for (const q of session.frameworkConfig.metadata.setup.questions) {
      assert.ok(
        q.key in session.frameworkContext,
        `Expected ${q.key} to be auto-filled in frameworkContext`,
      );
    }
  }
});

Then('I should proceed to the Agent Run without being prompted', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Run,
    `Expected Run (no Setup screen needed) but got ${screen}`,
  );
});

Then('I should see a picker for each undetected question', function () {
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Setup,
    `Expected Setup (question picker) but got ${screen}`,
  );
});

Then('I should see the selected framework displayed', function () {
  // After picking from the framework picker, router shows Intro (confirm screen)
  const screen = router.resolve(session);
  assert.strictEqual(
    screen,
    Screen.Intro,
    `Expected Intro (showing selected framework) but got ${screen}`,
  );
  assert.ok(
    session.frameworkConfig !== null,
    'Expected frameworkConfig to be set after selection',
  );
});

When('I confirm the detected framework', function () {
  session.setupConfirmed = true;
});
