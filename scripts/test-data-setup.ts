/**
 * E2E test for the Data Setup Complete flow.
 *
 * 1. Refreshes the OAuth token if expired (and persists the new token)
 * 2. Calls the Amplitude Data API to check connectivity + activation status
 * 3. Runs local Amplitude detection on the configured app directory
 * 4. Reports what activationLevel the wizard would assign
 *
 * Usage:
 *   pnpm tsx scripts/test-data-setup.ts [app-dir]
 *
 * Defaults to ../app-examples/with-stripe-typescript
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { z } from 'zod';

const appDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../../app-examples/with-stripe-typescript');

// ── Read OAuth tokens ─────────────────────────────────────────────────────────

const ampliSettingsPath = path.join(homedir(), '.ampli.json');
if (!existsSync(ampliSettingsPath)) {
  console.error(
    '~/.ampli.json not found — run `pnpm try` once to authenticate',
  );
  process.exit(1);
}
const ampliSettings = JSON.parse(readFileSync(ampliSettingsPath, 'utf8'));
const userKey = Object.keys(ampliSettings).find(
  (k) =>
    k.startsWith('User-') &&
    (ampliSettings[k] as Record<string, unknown>).OAuthRefreshToken,
);
if (!userKey) {
  console.error('No OAuth token found — run `pnpm try` once to authenticate');
  process.exit(1);
}
const userTokens = ampliSettings[userKey] as Record<string, string>;

// ── Read project config ───────────────────────────────────────────────────────

const appAmpliJson = path.join(appDir, 'ampli.json');
if (!existsSync(appAmpliJson)) {
  console.error(`ampli.json not found in ${appDir}`);
  process.exit(1);
}
// ampli.json migrated WorkspaceId → ProjectId; still read the legacy field as fallback
const ampliConfig = JSON.parse(readFileSync(appAmpliJson, 'utf8'));
const { OrgId, Zone } = ampliConfig;
const ProjectId: string | undefined =
  ampliConfig.ProjectId ?? ampliConfig.WorkspaceId;
const zone: 'us' | 'eu' = Zone === 'eu' ? 'eu' : 'us';

// ── Refresh token if expired (persists new tokens to ~/.ampli.json) ───────────

const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  id_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

const OAUTH_HOSTS = {
  us: 'https://auth.amplitude.com',
  eu: 'https://auth.eu.amplitude.com',
};
const OAUTH_CLIENT_IDS = {
  us: '0ac84169-c41c-4222-885b-31469c761cb0',
  eu: '110d04a1-8e60-4157-9c43-fcbe4e014a85',
};

async function getValidToken(): Promise<{
  accessToken: string;
  idToken: string;
}> {
  const expiresAt = new Date(userTokens.OAuthExpiresAt);
  if (new Date() < expiresAt) {
    return {
      accessToken: userTokens.OAuthAccessToken,
      idToken: userTokens.OAuthIdToken,
    };
  }
  process.stdout.write('Token expired, refreshing... ');
  const response = await axios.post(
    `${OAUTH_HOSTS[zone]}/oauth2/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: userTokens.OAuthRefreshToken,
      client_id: OAUTH_CLIENT_IDS[zone],
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const parsed = OAuthTokenResponseSchema.parse(response.data);
  const newExpiresAt = new Date(
    Date.now() + parsed.expires_in * 1000,
  ).toISOString();

  // Persist the new tokens so subsequent runs don't need to refresh again
  ampliSettings[userKey] = {
    ...userTokens,
    OAuthAccessToken: parsed.access_token,
    OAuthIdToken: parsed.id_token,
    OAuthRefreshToken: parsed.refresh_token,
    OAuthExpiresAt: newExpiresAt,
  };
  writeFileSync(ampliSettingsPath, JSON.stringify(ampliSettings, null, 2));
  console.log(`done (expires ${newExpiresAt})`);
  return { accessToken: parsed.access_token, idToken: parsed.id_token };
}

// ── Orgs query (verify auth + get numeric app IDs) ────────────────────────────
// NOTE: The GraphQL API still names this field `workspaces`; we alias it to
// `projects` to match the new Amplitude-website terminology throughout this
// script. The backend hasn't renamed the field yet.

const ORGS_QUERY = `
query { orgs { id name projects: workspaces { id name environments { name app { id apiKey } } } } }`;

// ── Activation status query (internal Amplitude field — may not be available) ─

const ACTIVATION_STATUS_QUERY = `
query hasAnyDefaultEventTrackingSourceAndEvents($appId: ID!) {
  hasAnyDefaultEventTrackingSourceAndEvents(appId: $appId) {
    hasDetSource
    hasPageViewedEvent
    hasSessionStartEvent
    hasSessionEndEvent
  }
}`;

const ActivationStatusSchema = z.object({
  data: z.object({
    hasAnyDefaultEventTrackingSourceAndEvents: z.object({
      hasDetSource: z.boolean(),
      hasPageViewedEvent: z.boolean(),
      hasSessionStartEvent: z.boolean(),
      hasSessionEndEvent: z.boolean(),
    }),
  }),
});

async function graphql(
  token: string,
  query: string,
  variables?: object,
  endpoint?: string,
  authPrefix?: string,
) {
  const dataApiUrl =
    endpoint ??
    (zone === 'eu'
      ? 'https://data-api.eu.amplitude.com/graphql'
      : 'https://data-api.amplitude.com/graphql');
  const authValue = authPrefix ? `${authPrefix} ${token}` : token;
  const response = await axios.post(
    dataApiUrl,
    { query, variables },
    {
      headers: { Authorization: authValue, 'Content-Type': 'application/json' },
      validateStatus: () => true,
    },
  );
  return response.data;
}

async function main() {
  console.log('Data Setup E2E Test');
  console.log('═══════════════════════════════════════');
  console.log(`App dir:     ${appDir}`);
  console.log(`OrgId:       ${OrgId}`);
  console.log(`ProjectId:   ${ProjectId}`);
  console.log(`Zone:        ${zone}`);
  console.log('');

  // ── 1. Get a valid token ────────────────────────────────────────────────────
  let idToken: string;
  let accessToken: string;
  try {
    const tokens = await getValidToken();
    idToken = tokens.idToken;
    accessToken = tokens.accessToken;
    console.log(`AccessToken: ${tokens.accessToken.slice(0, 20)}...`);
    console.log(`IdToken:     ${tokens.idToken.slice(0, 20)}...`);
    console.log('');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Token refresh failed: ${msg}`);
    console.error('');
    console.error(
      'Your OAuth refresh token may have expired or been invalidated.',
    );
    console.error(
      'Run `pnpm try` once to re-authenticate, then re-run this script.',
    );
    process.exit(1);
  }

  // ── 2. Verify auth + find numeric app IDs ──────────────────────────────────
  console.log('Checking Data API auth (orgs query)...');
  let envAppId: string | null = null;
  const orgsResult = await graphql(idToken, ORGS_QUERY);
  if (orgsResult.errors) {
    console.log(`  ✗ orgs query failed: ${orgsResult.errors[0]?.message}`);
  } else {
    const orgs = orgsResult.data?.orgs ?? [];
    type OrgShape = {
      id: string;
      name: string;
      // GraphQL field is `workspaces`; aliased to `projects` in the query
      projects?: Array<{
        id: string;
        name: string;
        environments?: Array<{
          name: string;
          app: { id: string; apiKey?: string } | null;
        }> | null;
      }>;
    };
    const targetOrg = (orgs as OrgShape[]).find(
      (o) => String(o.id) === String(OrgId),
    );
    if (targetOrg) {
      const targetProject = targetOrg.projects?.find(
        (p) => String(p.id) === String(ProjectId),
      );
      if (targetProject) {
        console.log(`  ✓ Project found: ${targetProject.name}`);
        (targetProject.environments ?? []).forEach((env) => {
          console.log(
            `    Environment: ${env.name}  AppId=${env.app?.id ?? 'n/a'}`,
          );
          if (env.app?.id) envAppId = env.app.id;
        });
      } else {
        console.log(`  ✗ Project ${ProjectId} not found in org ${OrgId}`);
      }
    } else {
      console.log(`  ✗ Org ${OrgId} not found. Accessible orgs and projects:`);
      for (const org of orgs as OrgShape[]) {
        console.log(`    Org ${org.id} (${org.name})`);
        for (const project of org.projects ?? []) {
          console.log(`      Project ${project.id} (${project.name})`);
          for (const env of project.environments ?? []) {
            console.log(
              `        env=${env.name}  appId=${env.app?.id ?? 'n/a'}`,
            );
          }
        }
      }
    }
  }
  console.log('');

  // ── 3. Activation status check ────────────────────────────────────────────
  console.log(
    'Checking activation status (hasAnyDefaultEventTrackingSourceAndEvents)...',
  );
  let activationLevel = 'none';
  let activationViaApi = false;

  const thunderUrl =
    zone === 'eu'
      ? `https://amplitude.eu/graphql/org/${OrgId}`
      : `https://amplitude.com/graphql/org/${OrgId}`;

  // Test data-api (public) and Thunder (internal, requires browser session)
  const appIdCandidates: [string, string][] = [
    ['ProjectId', String(ProjectId)],
    ...(envAppId ? [['EnvAppId', envAppId] as [string, string]] : []),
  ];
  for (const [endpointLabel, url] of [
    ['data-api', undefined as string | undefined],
    ['thunder', thunderUrl],
  ] as [string, string | undefined][]) {
    console.log(`  Endpoint: ${endpointLabel}`);
    for (const [label, appId] of appIdCandidates) {
      const result = await graphql(
        idToken,
        ACTIVATION_STATUS_QUERY,
        { appId },
        url,
      );
      if (result.errors) {
        console.log(`    appId=${label}: ✗ ${result.errors[0]?.message}`);
        continue;
      }
      const parsed = ActivationStatusSchema.safeParse(result);
      if (!parsed.success) {
        console.log(
          `    appId=${label}: ✗ Unexpected shape: ${JSON.stringify(
            result,
          ).slice(0, 100)}`,
        );
        continue;
      }
      const s = parsed.data.data.hasAnyDefaultEventTrackingSourceAndEvents;
      const hasAnyEvents =
        s.hasPageViewedEvent || s.hasSessionStartEvent || s.hasSessionEndEvent;
      const level =
        hasAnyEvents && s.hasDetSource
          ? s.hasPageViewedEvent &&
            s.hasSessionStartEvent &&
            s.hasSessionEndEvent
            ? 'full'
            : 'partial'
          : s.hasDetSource || hasAnyEvents
          ? 'partial'
          : 'none';
      console.log(
        `    appId=${label}: ✓ hasDetSource=${s.hasDetSource} hasAnyEvents=${hasAnyEvents} → ${level}`,
      );
      activationLevel = level;
      activationViaApi = true;
    }
  }
  console.log('');

  // ── 4. Local detection (fallback when API fails) ───────────────────────────
  console.log('Running local Amplitude detection...');
  const { detectAmplitudeInProject } = await import(
    '../src/lib/detect-amplitude.js'
  );
  const localDetection = detectAmplitudeInProject(appDir);
  console.log(`  confidence: ${localDetection.confidence}`);
  if (localDetection.reason)
    console.log(`  reason:     ${localDetection.reason}`);
  if (!activationViaApi) {
    activationLevel = localDetection.confidence !== 'none' ? 'partial' : 'none';
    console.log(`  (using local detection as fallback)`);
  }
  console.log('');

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  console.log('Summary');
  console.log('───────');
  console.log(`  activationLevel:  ${activationLevel}`);
  console.log(
    `  via:              ${
      activationViaApi ? 'API' : 'local detection (API unavailable)'
    }`,
  );
  console.log('');
  if (activationLevel === 'full') {
    console.log('  → Router would skip Setup+Run and go to MCP → Checklist');
  } else if (activationLevel === 'partial') {
    console.log('  → Router would show ActivationOptionsScreen');
  } else {
    console.log(
      '  → Router would show Setup → Run → MCP → DataIngestionCheck → Checklist',
    );
  }
  console.log('');
  if (!activationViaApi) {
    console.log(
      '  ⚠ The hasAnyDefaultEventTrackingSourceAndEvents GraphQL field is not available',
    );
    console.log(
      "  ⚠ in the public data-api.amplitude.com schema. The wizard's activation check",
    );
    console.log(
      '  ⚠ will always fall back to local file detection for external users.',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
