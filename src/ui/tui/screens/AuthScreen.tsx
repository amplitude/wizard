/**
 * AuthScreen — Multi-step authentication and account setup (SUSI flow).
 *
 * Steps:
 *   1. OAuth waiting — spinner + login URL while browser auth happens
 *   2. Org selection — picker if the user belongs to multiple orgs
 *   3. Workspace selection — picker if the org has multiple workspaces
 *   4. Project selection — picker if the workspace has multiple environments
 *   5. API key entry — text input (only if no project key could be resolved)
 *
 * The screen drives itself from session.pendingOrgs + session.credentials.
 * When credentials are set the router resolves past this screen.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useSyncExternalStore } from 'react';
import { TextInput } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { LoadingBox, PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';
import {
  DEFAULT_HOST_URL,
  type AmplitudeZone,
} from '../../../lib/constants.js';
import { analytics } from '../../../utils/analytics.js';

interface AuthScreenProps {
  store: WizardStore;
}

type EnvironmentEntry = {
  name: string;
  rank: number;
  app: { id: string; apiKey?: string | null } | null;
};

type OrgEntry = {
  id: string;
  name: string;
  workspaces: Array<{
    id: string;
    name: string;
    environments?: EnvironmentEntry[] | null;
  }>;
};

/**
 * Returns the environments with usable API keys from a workspace, sorted by rank.
 */
function getSelectableEnvironments(
  workspace: OrgEntry['workspaces'][number] | null | undefined,
): EnvironmentEntry[] {
  if (!workspace?.environments) return [];
  return workspace.environments
    .filter((env) => env.app?.apiKey)
    .sort((a, b) => a.rank - b.rank);
}

export const AuthScreen = ({ store }: AuthScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;

  // Local step state — which org the user has selected in this render session
  const [selectedOrg, setSelectedOrg] = useState<OrgEntry | null>(null);
  // Track the selected workspace locally so we can access its environments
  const [selectedWorkspace, setSelectedWorkspace] = useState<
    OrgEntry['workspaces'][number] | null
  >(null);
  const [selectedEnv, setSelectedEnv] = useState<EnvironmentEntry | null>(null);
  const [apiKeyError, setApiKeyError] = useState('');
  const [savedKeySource, setSavedKeySource] = useState<
    'keychain' | 'env' | null
  >(null);

  const pendingOrgs = session.pendingOrgs;

  // Resolve org: user-picked > single-org auto-select > pre-populated from session
  const prePopulatedOrg =
    session.selectedOrgId && pendingOrgs
      ? pendingOrgs.find((o) => o.id === session.selectedOrgId) ?? null
      : null;
  const effectiveOrg: OrgEntry | null =
    selectedOrg ??
    (pendingOrgs?.length === 1 ? pendingOrgs[0] : null) ??
    prePopulatedOrg;

  // Resolve workspace: user-picked > single-workspace auto-select > pre-populated from session
  const singleWorkspace =
    effectiveOrg?.workspaces.length === 1 ? effectiveOrg.workspaces[0] : null;
  const prePopulatedWorkspace =
    session.selectedWorkspaceId && effectiveOrg
      ? effectiveOrg.workspaces.find(
          (ws) => ws.id === session.selectedWorkspaceId,
        ) ?? null
      : null;
  const effectiveWorkspace =
    selectedWorkspace ?? singleWorkspace ?? prePopulatedWorkspace ?? null;

  useEffect(() => {
    if (effectiveOrg && effectiveWorkspace && !session.selectedWorkspaceId) {
      store.setOrgAndWorkspace(
        effectiveOrg,
        effectiveWorkspace,
        session.installDir,
      );
    }
  }, [effectiveOrg?.id, effectiveWorkspace?.id, session.selectedWorkspaceId]);

  // workspaceChosen requires the local workspace object (effectiveWorkspace)
  // rather than just session.selectedWorkspaceId, because we need the
  // environments list to drive the project picker. When selectedWorkspaceId is
  // pre-populated from ampli.json but no workspace object exists yet,
  // selectableEnvs would be empty and the picker would be bypassed.
  const workspaceChosen = effectiveWorkspace !== null;

  // Environments available in the selected workspace
  const selectableEnvs = getSelectableEnvironments(effectiveWorkspace);
  const hasMultipleEnvs = selectableEnvs.length > 1;

  // Auto-select the environment when there's only one with an API key
  useEffect(() => {
    if (workspaceChosen && !selectedEnv && selectableEnvs.length === 1) {
      setSelectedEnv(selectableEnvs[0]);
      store.setSelectedProjectName(selectableEnvs[0].name);
    }
  }, [workspaceChosen, selectedEnv, selectableEnvs.length]);

  // True once the user has picked an environment (or it was auto-selected),
  // or there are no environments to pick from (falls through to manual key entry).
  const envResolved = selectedEnv !== null || selectableEnvs.length === 0;

  // Resolve API key from local storage, selected environment, or backend fetch.
  useEffect(() => {
    if (!workspaceChosen || !envResolved || session.credentials !== null)
      return;

    let cancelled = false;

    void (async () => {
      const s = store.session;
      if (s.credentials !== null) return;

      const { readApiKeyWithSource, persistApiKey } = await import(
        '../../../utils/api-key-store.js'
      );
      if (cancelled) return;

      // 1. Check local storage first
      const local = readApiKeyWithSource(s.installDir);
      if (local) {
        setSavedKeySource(local.source);
        analytics.wizardCapture('API Key Submitted', {
          key_source: local.source,
        });
        store.setCredentials({
          accessToken: s.pendingAuthAccessToken ?? '',
          idToken: s.pendingAuthIdToken ?? undefined,
          projectApiKey: local.key,
          host: DEFAULT_HOST_URL,
          projectId: 0,
        });
        store.setProjectHasData(false);
        store.setApiKeyNotice(null);
        return;
      }

      // 2. Use the API key from the selected environment
      if (selectedEnv?.app?.apiKey) {
        const apiKey = selectedEnv.app.apiKey;
        const zone = (s.region ??
          s.pendingAuthCloudRegion ??
          'us') as AmplitudeZone;
        const { getHostFromRegion } = await import('../../../utils/urls.js');
        if (cancelled || store.session.credentials !== null) return;

        persistApiKey(apiKey, s.installDir);
        analytics.wizardCapture('API Key Submitted', {
          key_source: 'environment_picker',
        });
        store.setCredentials({
          accessToken: s.pendingAuthAccessToken ?? '',
          idToken: s.pendingAuthIdToken ?? undefined,
          projectApiKey: apiKey,
          host: getHostFromRegion(zone),
          projectId: 0,
        });
        store.setProjectHasData(false);
        store.setApiKeyNotice(null);
        return;
      }

      // 3. Fall back to backend fetch (no environments with keys available)
      const idToken = s.pendingAuthIdToken;
      if (!idToken) return;

      const zone = (s.region ??
        s.pendingAuthCloudRegion ??
        'us') as AmplitudeZone;

      const { getAPIKey } = await import('../../../utils/get-api-key.js');
      const { getHostFromRegion } = await import('../../../utils/urls.js');

      const projectApiKey = await getAPIKey({
        installDir: s.installDir,
        idToken,
        zone,
        workspaceId: s.selectedWorkspaceId ?? undefined,
      });

      if (cancelled || store.session.credentials !== null) return;

      if (projectApiKey) {
        persistApiKey(projectApiKey, s.installDir);
        analytics.wizardCapture('API Key Submitted', {
          key_source: 'backend_fetch',
        });
        store.setCredentials({
          accessToken: s.pendingAuthAccessToken ?? '',
          idToken: s.pendingAuthIdToken ?? undefined,
          projectApiKey,
          host: getHostFromRegion(zone),
          projectId: 0,
        });
        store.setProjectHasData(false);
        store.setApiKeyNotice(null);
      } else {
        store.setApiKeyNotice(
          "Your API key couldn't be fetched automatically. " +
            'Only organization admins can access project API keys — ' +
            'if you need one, ask an admin to share it with you.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    workspaceChosen,
    envResolved,
    selectedEnv,
    session.credentials,
    session.selectedWorkspaceId,
    session.pendingAuthIdToken,
    session.region,
    session.pendingAuthCloudRegion,
    session.installDir,
  ]);

  const needsOrgPick =
    pendingOrgs !== null && pendingOrgs.length > 1 && effectiveOrg === null;
  const needsWorkspacePick =
    effectiveOrg !== null &&
    effectiveOrg.workspaces.length > 1 &&
    !selectedWorkspace;
  const needsProjectPick = workspaceChosen && hasMultipleEnvs && !selectedEnv;
  const needsApiKey =
    effectiveOrg !== null &&
    workspaceChosen &&
    envResolved &&
    session.credentials === null &&
    // Only show manual input if there's no selected env with a key
    // (either no envs available, or the env had no key)
    !selectedEnv?.app?.apiKey;

  const handleApiKeySubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setApiKeyError('API key cannot be empty');
      return;
    }
    setApiKeyError('');
    analytics.wizardCapture('API Key Submitted', {
      key_source: 'manual_entry',
    });
    store.setApiKeyNotice(null);
    store.setCredentials({
      accessToken: session.pendingAuthAccessToken ?? '',
      idToken: session.pendingAuthIdToken ?? undefined,
      projectApiKey: trimmed,
      host: DEFAULT_HOST_URL,
      projectId: 0,
    });
    // Fresh project: no existing event data — advance past DataSetup
    store.setProjectHasData(false);
    // Persist so the user doesn't have to enter it again
    void import('../../../utils/api-key-store.js').then(({ persistApiKey }) => {
      const source = persistApiKey(trimmed, session.installDir);
      setSavedKeySource(source);
    });
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Amplitude Setup Wizard
        </Text>
        {session.detectedFrameworkLabel && (
          <Text>
            <Text color="green">{'✔'} </Text>
            <Text>Framework: {session.detectedFrameworkLabel}</Text>
          </Text>
        )}
      </Box>

      {/* Step 1: waiting for OAuth browser redirect */}
      {pendingOrgs === null && (
        <>
          <LoadingBox message="Waiting for authentication..." />
          {session.loginUrl && (
            <Box marginTop={1} flexDirection="column">
              <Text color={Colors.muted}>
                If the browser didn't open, copy and paste this URL:
              </Text>
              <Text color="cyan">{session.loginUrl}</Text>
            </Box>
          )}
        </>
      )}

      {/* Step 2: org picker (multiple orgs only) */}
      {needsOrgPick && pendingOrgs && (
        <Box flexDirection="column">
          <Text color={Colors.muted}>Select your Amplitude organization:</Text>
          <PickerMenu<OrgEntry>
            options={pendingOrgs.map((org) => ({
              label: org.name,
              value: org,
            }))}
            onSelect={(value) => {
              const org = Array.isArray(value) ? value[0] : value;
              setSelectedOrg(org);
            }}
          />
        </Box>
      )}

      {/* Step 3: workspace picker (multiple workspaces only) */}
      {needsWorkspacePick && effectiveOrg && (
        <Box flexDirection="column">
          <Text color={Colors.muted}>
            Select a workspace in <Text color="white">{effectiveOrg.name}</Text>
            :
          </Text>
          <PickerMenu<OrgEntry['workspaces'][number]>
            options={effectiveOrg.workspaces.map((ws) => ({
              label: ws.name,
              value: ws,
            }))}
            onSelect={(value) => {
              const ws = Array.isArray(value) ? value[0] : value;
              setSelectedWorkspace(ws);
              store.setOrgAndWorkspace(effectiveOrg, ws, session.installDir);
            }}
          />
        </Box>
      )}

      {/* Step 4: project/environment picker (multiple environments only) */}
      {needsProjectPick && (
        <Box flexDirection="column">
          <Text color={Colors.muted}>Select a project:</Text>
          <PickerMenu<EnvironmentEntry>
            options={selectableEnvs.map((env) => ({
              label: env.name,
              value: env,
            }))}
            onSelect={(value) => {
              const env = Array.isArray(value) ? value[0] : value;
              setSelectedEnv(env);
              store.setSelectedProjectName(env.name);
            }}
          />
        </Box>
      )}

      {/* Step 5: API key input (only when no env key is available) */}
      {needsApiKey && (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text>
              Enter your Amplitude project <Text bold>API Key</Text>
            </Text>
            <Text color={Colors.muted}>
              Amplitude → Settings → Projects → [your project] → API Keys
            </Text>
            {session.apiKeyNotice && (
              <Text color="yellow">{session.apiKeyNotice}</Text>
            )}
          </Box>
          <TextInput
            placeholder="Paste API key here…"
            onSubmit={handleApiKeySubmit}
          />
          {apiKeyError && <Text color="red">{apiKeyError}</Text>}
          {savedKeySource && (
            <Text color="green">
              {'✔ '}
              {savedKeySource === 'keychain'
                ? 'API key saved to system keychain'
                : 'API key saved to .env.local'}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};
