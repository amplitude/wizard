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

describe('buildIntegrationPrompt — user identification (MCP path)', () => {
  it('instructs the agent to search for an existing setUserId call before doing anything', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    expect(prompt).toContain('search');
    expect(prompt).toContain('setUserId');
  });

  it('skips if an uncommented setUserId already exists — not if only a comment is present', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    // Guard fires on uncommented calls, not commented-out ones
    expect(prompt).toContain('uncommented');
    expect(prompt).toContain('skip this step entirely');
  });

  it('instructs the agent to find the real auth location in the codebase', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    // Should mention concrete auth patterns to look for
    expect(prompt).toMatch(/login|session restore|OAuth|JWT/i);
  });

  it('instructs the agent to write a real setUserId call when auth location is found', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    expect(prompt).toContain('amplitude.setUserId(userId)');
    expect(prompt).toContain('set_user_id(user_id)');
  });

  it('includes a TODO fallback for when no clear auth location can be found', () => {
    const prompt = buildIntegrationPrompt(
      minimalConfig,
      baseContext,
      {},
      false,
    );

    expect(prompt).toContain('TODO');
    expect(prompt).toContain('Fall back');
  });

  it('applies the same logic on the generic fallback path (skipAmplitudeMcp)', () => {
    const prompt = buildIntegrationPrompt(minimalConfig, baseContext, {}, true);

    expect(prompt).toContain('setUserId');
    expect(prompt).toContain('TODO');
    expect(prompt).toMatch(/login|session restore|OAuth|JWT/i);
  });
});

describe('generic buildPrompt — user identification (fallback path)', () => {
  it('instructs the agent to search for the real auth location', () => {
    const buildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt!;
    const prompt = buildPrompt({ ...baseContext, frameworkContext: {} });

    expect(prompt).toMatch(/login|session restore|OAuth|JWT/i);
    expect(prompt).toContain('setUserId');
  });

  it('includes the real call examples for JS and Python', () => {
    const buildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt!;
    const prompt = buildPrompt({ ...baseContext, frameworkContext: {} });

    expect(prompt).toContain('amplitude.setUserId(userId)');
    expect(prompt).toContain('amplitude_client.set_user_id(user_id)');
  });

  it('includes a TODO fallback for ambiguous auth', () => {
    const buildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt!;
    const prompt = buildPrompt({ ...baseContext, frameworkContext: {} });

    expect(prompt).toContain('TODO');
    expect(prompt).toContain('amplitude.setUserId(user.id)');
  });

  it('guards on uncommented calls only', () => {
    const buildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt!;
    const prompt = buildPrompt({ ...baseContext, frameworkContext: {} });

    expect(prompt).toContain('uncommented');
    expect(prompt).toContain('skip this step entirely');
  });
});
