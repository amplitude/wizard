#!/usr/bin/env node
/**
 * Pre-register wizard CLI TitleCase event names in the Amplitude taxonomy.
 *
 * Why: the wizard recently renamed all events from lowercase to `wizard cli:
 * <Title Case Name>`. Most TitleCase variants don't exist in the project yet
 * because no customer has run the new version. Registering them here lets
 * charts and dashboards reference them before data flows.
 *
 * Usage:
 *   AMPLITUDE_API_KEY=xxx AMPLITUDE_SECRET_KEY=yyy \
 *     node scripts/register-wizard-events.mjs
 *
 * Optional env:
 *   AMPLITUDE_API_BASE  — defaults to https://amplitude.com
 *                         (use https://analytics.eu.amplitude.com for EU)
 *   DRY_RUN=1           — log the plan without making any requests
 *
 * Credentials come from the admin API key + secret pair for the project
 * (Settings → Organization → Projects → API Keys). NOT the ingestion key
 * baked into the CLI and NOT the OAuth tokens in ~/.ampli.json.
 */

const API_BASE = process.env.AMPLITUDE_API_BASE ?? 'https://amplitude.com';
const API_KEY = process.env.AMPLITUDE_API_KEY;
const SECRET_KEY = process.env.AMPLITUDE_SECRET_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!DRY_RUN && (!API_KEY || !SECRET_KEY)) {
  console.error(
    'Missing AMPLITUDE_API_KEY or AMPLITUDE_SECRET_KEY. Set both and retry, ' +
      'or run with DRY_RUN=1 to preview the plan.',
  );
  process.exit(1);
}

/**
 * Every TitleCase event the wizard emits (with the `wizard cli: ` prefix).
 * Keep this list in sync with `wizardCapture()` call sites — see
 * CLAUDE.md § "Analytics conventions" for the naming rule.
 */
const EVENTS = [
  'Session Started',
  'Session Ended',
  'Framework Detection Complete',
  'Framework Manually Selected',
  'Setup Confirmed',
  'Auth Complete',
  'Region Selected',
  'API Key Submitted',
  'Picker Start Over',
  'Create Project Started',
  'Create Project Submit',
  'Create Project Error',
  'Create Project Cancelled',
  'Create Project Fallback Link Opened',
  'Create Project Link Opened',
  'Project Created',
  'Checkpoint Resume Action',
  'Intro Action',
  'Agent Started',
  'Agent Completed',
  'Agent Stall Detected',
  'Agent Stall Retry',
  'Agent API Error Retry',
  'Agent SDK Error Retry',
  'Agent Message Sent',
  'Wizard Remark',
  'Wizard Screen Entered',
  'Wizard Link Opened',
  'Prompt Response',
  'Data Ingestion Confirmed',
  'Feature Enabled',
  'MCP Complete',
  'MCP No Clients Detected',
  'MCP Clients Detected',
  'MCP Clients Selected',
  'MCP Install Confirmed',
  'MCP Install Complete',
  'MCP Remove Confirmed',
  'MCP Remove Complete',
  'MCP Skipped',
  'MCP Post-Install Launch',
  'MCP Servers Added',
  'MCP Servers Removed',
  'MCP No Servers To Remove',
  'Amplitude Pre-Detected Choice',
  'Slack Complete',
  'Outro Reached',
  'Outro Action',
  'Feedback Submitted',
  'Error Encountered',
  'Environment Variables Added',
  'Env Uploaded',
  'Env Upload Skipped',
  'Vercel Detection',
  'Package Installed',
  'Prettier Ran',
  'Claude Settings Backed Up',
  'Claude Settings Restored',
].map((name) => `wizard cli: ${name}`);

const authHeader = () =>
  'Basic ' + Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');

async function registerEvent(eventType) {
  if (DRY_RUN) {
    return { ok: true, status: 'dry-run' };
  }

  const body = new URLSearchParams({
    event_type: eventType,
    description:
      'Wizard CLI telemetry event. Registered ahead of code rollout to ' +
      'unblock charts/dashboards that reference the TitleCase event names.',
  });

  const res = await fetch(`${API_BASE}/api/2/taxonomy/event`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  // 409 = already exists, treat as success (idempotent for our purposes)
  if (res.status === 409) {
    return { ok: true, status: 'exists' };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    return { ok: false, status: `${res.status} ${text.slice(0, 200)}` };
  }

  return { ok: true, status: 'created' };
}

async function main() {
  console.log(
    `Registering ${EVENTS.length} events against ${API_BASE}` +
      (DRY_RUN ? ' (DRY RUN)' : ''),
  );

  let created = 0;
  let existed = 0;
  let failed = 0;

  for (const eventType of EVENTS) {
    const result = await registerEvent(eventType);
    const label =
      result.ok && result.status === 'created'
        ? '+ created  '
        : result.ok && result.status === 'exists'
          ? '= exists   '
          : result.ok && result.status === 'dry-run'
            ? '? dry-run  '
            : '! failed   ';
    console.log(`${label} ${eventType}${result.ok ? '' : ` — ${result.status}`}`);

    if (!result.ok) failed += 1;
    else if (result.status === 'created') created += 1;
    else if (result.status === 'exists') existed += 1;
  }

  console.log(
    `\nDone. created=${created} existed=${existed} failed=${failed} total=${EVENTS.length}`,
  );
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
