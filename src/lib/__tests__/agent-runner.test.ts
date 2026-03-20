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

const minimalConfig: FrameworkConfig = {
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

describe('buildIntegrationPrompt — user identification TODO (MCP path)', () => {
  it('includes a step to add the setUserId TODO comment after init', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    expect(prompt).toContain('setUserId');
    expect(prompt).toContain('TODO');
  });

  it('skips the step if an uncommented setUserId already exists', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    expect(prompt).toContain('uncommented');
    expect(prompt).toContain('skip this step entirely');
  });

  it('includes the JS/TS commented-out example', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    expect(prompt).toContain('amplitude.setUserId(user.id)');
  });

  it('includes the Python commented-out example', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    expect(prompt).toContain('set_user_id');
  });

  it('explains why auth cannot be auto-instrumented', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    expect(prompt).toMatch(/login callback|session restore|OAuth redirect/);
  });

  it('applies the same logic on the generic fallback path (skipAmplitudeMcp)', () => {
    const prompt = buildIntegrationPrompt(minimalConfig, baseContext, {}, true);

    expect(prompt).toContain('setUserId');
    expect(prompt).toContain('TODO');
    expect(prompt).toMatch(/login callback|session restore|OAuth redirect/);
  });
});

describe('generic buildPrompt — user identification TODO (fallback path)', () => {
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

  it('includes the Python commented-out example', () => {
    const buildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt!;
    const prompt = buildPrompt({ ...baseContext, frameworkContext: {} });

    expect(prompt).toContain('amplitude_client.set_user_id');
  });
});
