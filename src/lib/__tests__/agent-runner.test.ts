import { buildIntegrationPrompt } from '../agent-runner';
import { GENERIC_AGENT_CONFIG } from '../../frameworks/generic/generic-wizard-agent';
import type { FrameworkConfig } from '../framework-config';
import { Integration } from '../constants';
import { detectNodePackageManagers } from '../package-manager-detection';

const baseContext = {
  frameworkVersion: '1.0.0',
  typescript: false,
  projectApiKey: 'test-api-key',
  host: 'https://api2.amplitude.com',
  projectId: 12345,
};

/** Non-server (client-side) config — e.g. Next.js, JS Web */
const clientConfig: FrameworkConfig = {
  metadata: {
    name: 'TestFramework',
    integration: Integration.nextjs,
    docsUrl: 'https://example.com/docs',
  },
  detection: {
    packageName: 'test-pkg',
    packageDisplayName: 'TestFramework',
    usesPackageJson: true,
    getVersion: () => undefined,
    detectPackageManager: detectNodePackageManagers,
    detect: () => Promise.resolve(false),
  },
  environment: {
    uploadToHosting: false,
    getEnvVars: () => ({}),
  },
  analytics: {
    getTags: () => ({}),
  },
  prompts: {
    projectTypeDetection: 'Look for package.json',
  },
  ui: {
    successMessage: 'Done',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [],
    getOutroNextSteps: () => [],
  },
};

/** Server-side config — e.g. Python, Django, Flask, FastAPI */
const serverConfig: FrameworkConfig = {
  ...clientConfig,
  metadata: {
    ...clientConfig.metadata,
    name: 'Python',
    integration: Integration.python,
    serverSide: true,
  },
};

describe('buildIntegrationPrompt — client-side user identification (MCP path)', () => {
  it('attempts to find the auth location and write setUserId() directly', () => {
    const prompt = buildIntegrationPrompt(clientConfig, baseContext, {}, false);

    expect(prompt).toContain('setUserId');
    expect(prompt).toContain('search the codebase');
  });

  it('falls back to a TODO comment if no auth location is found', () => {
    const prompt = buildIntegrationPrompt(clientConfig, baseContext, {}, false);

    expect(prompt).toContain('TODO');
    expect(prompt).toContain('fall back');
  });

  it('guards on uncommented setUserId calls only', () => {
    const prompt = buildIntegrationPrompt(clientConfig, baseContext, {}, false);

    expect(prompt).toContain('uncommented');
    expect(prompt).toContain('skip this step entirely');
  });

  it('includes the JS/TS setUserId example', () => {
    const prompt = buildIntegrationPrompt(clientConfig, baseContext, {}, false);

    expect(prompt).toContain('amplitude.setUserId(user.id)');
  });

  it('mentions common auth locations to search for', () => {
    const prompt = buildIntegrationPrompt(clientConfig, baseContext, {}, false);

    expect(prompt).toMatch(/login callback|sign-in handler|OAuth redirect/);
  });

  it('applies the auto-instrument approach on the generic fallback path (skipAmplitudeMcp)', () => {
    const prompt = buildIntegrationPrompt(clientConfig, baseContext, {}, true);

    expect(prompt).toContain('setUserId');
    expect(prompt).toContain('TODO');
    expect(prompt).toMatch(/login callback|session restore|OAuth redirect/);
  });
});

describe('buildIntegrationPrompt — server-side user identification (MCP path)', () => {
  it('uses the Python identify() API instead of setUserId()', () => {
    const prompt = buildIntegrationPrompt(serverConfig, baseContext, {}, false);

    expect(prompt).toContain('identify(');
    expect(prompt).toContain('user_id');
  });

  it('does NOT include a setUserId() call example', () => {
    const prompt = buildIntegrationPrompt(serverConfig, baseContext, {}, false);

    // The prompt explains the SDK has no setUserId, but must not show a JS-style call example
    expect(prompt).not.toContain('amplitude.setUserId(');
  });

  it('shows the BaseEvent user_id pattern', () => {
    const prompt = buildIntegrationPrompt(serverConfig, baseContext, {}, false);

    expect(prompt).toContain('BaseEvent');
    expect(prompt).toContain('user_id');
  });

  it('shows the identify() + EventOptions pattern', () => {
    const prompt = buildIntegrationPrompt(serverConfig, baseContext, {}, false);

    expect(prompt).toContain('EventOptions');
  });

  it('guards on user_id already being set on events', () => {
    const prompt = buildIntegrationPrompt(serverConfig, baseContext, {}, false);

    expect(prompt).toContain('skip this step entirely');
  });
});

describe('generic buildPrompt — user identification (fallback path)', () => {
  it('includes the setUserId TODO instruction after init', () => {
    const buildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt!;
    const prompt = buildPrompt({ ...baseContext, frameworkContext: {} });

    expect(prompt).toContain('setUserId');
    expect(prompt).toContain('TODO');
  });

  it('guards on uncommented calls only', () => {
    const buildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt!;
    const prompt = buildPrompt({ ...baseContext, frameworkContext: {} });

    expect(prompt).toContain('uncommented');
  });

  it('includes the JS commented-out example', () => {
    const buildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt!;
    const prompt = buildPrompt({ ...baseContext, frameworkContext: {} });

    expect(prompt).toContain('amplitude.setUserId(user.id)');
  });
});
