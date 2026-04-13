export type StatusCheckResult =
  | { status: 'operational' }
  | { status: 'degraded'; description: string }
  | { status: 'down'; description: string }
  | { status: 'unknown'; error: string };

/**
 * Model provider health check.
 *
 * The wizard uses Vertex AI via a Thunder proxy — Claude/Anthropic status
 * is irrelevant. Rather than parsing Google Cloud's complex incident feeds
 * and risking false-positive outage warnings, this always returns
 * operational and lets actual API errors surface during the agent run.
 */
export function checkAnthropicStatus(): StatusCheckResult {
  return { status: 'operational' };
}
