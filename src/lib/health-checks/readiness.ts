import {
  ServiceHealthStatus,
  type AllServicesHealth,
  type BaseHealthResult,
  type ComponentHealthResult,
  type HealthCheckKey,
} from './types';
import {
  checkAnthropicHealth,
  checkAmplitudeStatusAndComponents,
  checkGithubHealth,
  checkNpmStatusAndComponents,
  checkCloudflareStatusAndComponents,
} from './statuspage';
import { checkLlmGatewayHealth, checkMcpHealth } from './endpoints';

// ---------------------------------------------------------------------------
// Service labels (used in human-readable reason strings)
// ---------------------------------------------------------------------------

const SERVICE_LABELS: Record<HealthCheckKey, string> = {
  anthropic: 'Anthropic',
  amplitudeOverall: 'Amplitude',
  amplitudeComponents: 'Amplitude (components)',
  github: 'GitHub',
  npmOverall: 'npm',
  npmComponents: 'npm (components)',
  cloudflareOverall: 'Cloudflare',
  cloudflareComponents: 'Cloudflare (components)',
  llmGateway: 'LLM Gateway',
  mcp: 'MCP',
};

// ---------------------------------------------------------------------------
// Readiness config
// ---------------------------------------------------------------------------

export interface WizardReadinessConfig {
  /** Services where status=Down blocks the run (readiness=No). */
  downBlocksRun: HealthCheckKey[];
  /** Services where status=Degraded (or worse) blocks the run (readiness=No). */
  degradedBlocksRun?: HealthCheckKey[];
}

/**
 * See README section "Health checks" for the full rationale.
 * Adjust these arrays to change what blocks a wizard run.
 */
export const DEFAULT_WIZARD_READINESS_CONFIG: WizardReadinessConfig = {
  downBlocksRun: [
    'anthropic',
    'amplitudeOverall',
    'npmOverall',
    'llmGateway',
    'mcp',
  ],
  degradedBlocksRun: ['anthropic'],
};

// ---------------------------------------------------------------------------
// Aggregate check
// ---------------------------------------------------------------------------

export async function checkAllExternalServices(): Promise<AllServicesHealth> {
  // Collapses the three statuspage `*Overall` + `*Components` pairs into a
  // single `summary.json` fetch each (Statuspage's summary endpoint returns
  // both the page-level indicator and the component list in one response).
  // Cuts the aggregate readiness check from 10 fetches to 7.
  const [anthropic, amplitude, github, npm, cloudflare, llmGateway, mcp] =
    await Promise.all([
      checkAnthropicHealth(),
      checkAmplitudeStatusAndComponents(),
      checkGithubHealth(),
      checkNpmStatusAndComponents(),
      checkCloudflareStatusAndComponents(),
      checkLlmGatewayHealth(),
      checkMcpHealth(),
    ]);
  return {
    anthropic,
    amplitudeOverall: amplitude.overall,
    amplitudeComponents: amplitude.components,
    github,
    npmOverall: npm.overall,
    npmComponents: npm.components,
    cloudflareOverall: cloudflare.overall,
    cloudflareComponents: cloudflare.components,
    llmGateway,
    mcp,
  };
}

// ---------------------------------------------------------------------------
// Wizard readiness evaluation
// ---------------------------------------------------------------------------

export enum WizardReadiness {
  Yes = 'yes',
  No = 'no',
  YesWithWarnings = 'yes_with_warnings',
}

export interface WizardReadinessResult {
  decision: WizardReadiness;
  health: AllServicesHealth;
  reasons: string[];
}

function describeResult(label: string, h: BaseHealthResult): string {
  const parts = [`${label}: ${h.status}`];
  if (h.rawIndicator) parts.push(`indicator=${h.rawIndicator}`);
  if (h.error) parts.push(h.error);
  return parts.join(' — ');
}

const MAX_COMPONENT_NAMES = 8;

function describeComponents(label: string, h: ComponentHealthResult): string {
  const affected = h.degradedOrDownComponents;
  if (!affected || affected.length === 0)
    return `${label} components: all operational`;
  const shown = affected
    .slice(0, MAX_COMPONENT_NAMES)
    .map((c) => `${c.name} (${c.status})`);
  const suffix =
    affected.length > MAX_COMPONENT_NAMES
      ? `, +${affected.length - MAX_COMPONENT_NAMES} more`
      : '';
  return `${label} components impacted: ${shown.join(', ')}${suffix}`;
}

export async function evaluateWizardReadiness(
  config: WizardReadinessConfig = DEFAULT_WIZARD_READINESS_CONFIG,
): Promise<WizardReadinessResult> {
  const health = await checkAllExternalServices();
  const reasons: string[] = [];

  for (const key of Object.keys(health) as HealthCheckKey[]) {
    const result = health[key];
    const label = SERVICE_LABELS[key];

    reasons.push(describeResult(label, result));

    if ('degradedOrDownComponents' in result) {
      reasons.push(describeComponents(label, result));
    }
  }

  const blocked =
    config.downBlocksRun.some(
      (k) => health[k].status === ServiceHealthStatus.Down,
    ) ||
    (config.degradedBlocksRun ?? []).some(
      (k) => health[k].status !== ServiceHealthStatus.Healthy,
    );

  if (blocked) {
    return { decision: WizardReadiness.No, health, reasons };
  }

  const hasWarnings = (Object.values(health) as BaseHealthResult[]).some(
    (h) => h.status !== ServiceHealthStatus.Healthy,
  );

  if (hasWarnings) {
    return { decision: WizardReadiness.YesWithWarnings, health, reasons };
  }

  return { decision: WizardReadiness.Yes, health, reasons };
}
