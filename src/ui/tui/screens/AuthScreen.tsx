/**
 * AuthScreen — Multi-step authentication and account setup (SUSI flow).
 *
 * Steps:
 *   1. OAuth waiting — spinner + login URL while browser auth happens
 *   2. Org selection — picker if the user belongs to multiple orgs
 *   3. Workspace selection — picker if the org has multiple workspaces
 *   4. API key entry — text input for the Amplitude analytics write key
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
import { DEFAULT_HOST_URL } from '../../../lib/constants.js';
import { analytics } from '../../../utils/analytics.js';

interface AuthScreenProps {
  store: WizardStore;
}

type OrgEntry = {
  id: string;
  name: string;
  workspaces: Array<{ id: string; name: string }>;
};

export const AuthScreen = ({ store }: AuthScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;

  // Local step state — which org the user has selected in this render session
  const [selectedOrg, setSelectedOrg] = useState<OrgEntry | null>(null);
  const [apiKeyError, setApiKeyError] = useState('');
  const [savedKeySource, setSavedKeySource] = useState<
    'keychain' | 'env' | null
  >(null);

  const pendingOrgs = session.pendingOrgs;

  // Auto-select the org when there's only one
  const effectiveOrg: OrgEntry | null =
    selectedOrg ?? (pendingOrgs?.length === 1 ? pendingOrgs[0] : null);

  // Auto-select workspace when org has only one
  const singleWorkspace =
    effectiveOrg?.workspaces.length === 1 ? effectiveOrg.workspaces[0] : null;

  useEffect(() => {
    if (effectiveOrg && singleWorkspace && !session.selectedWorkspaceId) {
      store.setOrgAndWorkspace(
        effectiveOrg,
        singleWorkspace,
        session.installDir,
      );
    }
  }, [effectiveOrg?.id, singleWorkspace?.id, session.selectedWorkspaceId]);

  const workspaceChosen =
    session.selectedWorkspaceId !== null ||
    (effectiveOrg !== null && effectiveOrg.workspaces.length === 1);

  // Auto-advance past API key step if a saved key exists for this project
  useEffect(() => {
    if (!workspaceChosen || session.credentials !== null) return;
    void import('../../../utils/api-key-store.js').then(
      ({ readApiKeyWithSource }) => {
        const result = readApiKeyWithSource(session.installDir);
        if (result) {
          setSavedKeySource(result.source);
          analytics.wizardCapture('api key submitted', {
            key_source: result.source,
          });
          store.setCredentials({
            accessToken: session.pendingAuthAccessToken ?? '',
            projectApiKey: result.key,
            host: DEFAULT_HOST_URL,
            projectId: 0,
          });
          store.setProjectHasData(false);
        }
      },
    );
  }, [workspaceChosen, session.credentials]);

  const needsOrgPick =
    pendingOrgs !== null && pendingOrgs.length > 1 && effectiveOrg === null;
  const needsWorkspacePick =
    effectiveOrg !== null &&
    effectiveOrg.workspaces.length > 1 &&
    !session.selectedWorkspaceId;
  const needsApiKey =
    effectiveOrg !== null && workspaceChosen && session.credentials === null;

  const handleApiKeySubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setApiKeyError('API key cannot be empty');
      return;
    }
    setApiKeyError('');
    analytics.wizardCapture('api key submitted', {
      key_source: 'manual_entry',
    });
    store.setCredentials({
      accessToken: session.pendingAuthAccessToken ?? '',
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
          <PickerMenu<{ id: string; name: string }>
            options={effectiveOrg.workspaces.map((ws) => ({
              label: ws.name,
              value: ws,
            }))}
            onSelect={(value) => {
              const ws = Array.isArray(value) ? value[0] : value;
              store.setOrgAndWorkspace(effectiveOrg, ws, session.installDir);
            }}
          />
        </Box>
      )}

      {/* Step 4: API key input */}
      {needsApiKey && (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text>
              Enter your Amplitude project <Text bold>API Key</Text>
            </Text>
            <Text color={Colors.muted}>
              Amplitude → Settings → Projects → [your project] → API Keys
            </Text>
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
