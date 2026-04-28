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

import { Box, Text, measureElement, type DOMElement } from 'ink';
import { useState, useEffect, useRef, type RefObject } from 'react';
import { TextInput } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { useContentArea } from '../context/ContentAreaContext.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useEscapeBack } from '../hooks/useEscapeBack.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useTimedCoaching } from '../hooks/useTimedCoaching.js';
import { PickerMenu, TerminalLink } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import {
  DEFAULT_AMPLITUDE_ZONE,
  DEFAULT_HOST_URL,
} from '../../../lib/constants.js';
import { wizardAbort } from '../../../utils/wizard-abort.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import { toCredentialAppId } from '../../../lib/wizard-session.js';
import { analytics } from '../../../utils/analytics.js';

const CREATE_ACTION = '__create__' as const;
const RESTART_ACTION = '__restart__' as const;
type PickerAction = typeof CREATE_ACTION | typeof RESTART_ACTION;

function isPickerAction(value: unknown): value is PickerAction {
  return value === CREATE_ACTION || value === RESTART_ACTION;
}

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

function useMeasuredRows(ref: RefObject<DOMElement | null>): number {
  const [rows, setRows] = useState(0);

  useEffect(() => {
    if (!ref.current) {
      if (rows !== 0) setRows(0);
      return;
    }
    const { height } = measureElement(ref.current);
    if (height !== rows) {
      setRows(height);
    }
  });

  return rows;
}

export const AuthScreen = ({ store }: AuthScreenProps) => {
  useWizardStore(store);
  // Esc → back to RegionSelect. Self-disables on the very first run
  // (no region picked yet, canGoBack=false) so it doesn't hijack the
  // OAuth-waiting phase.
  useEscapeBack(store);

  const { session } = store;
  const contentArea = useContentArea();

  // Local step state — which org the user has selected in this render session
  const [selectedOrg, setSelectedOrg] = useState<OrgEntry | null>(null);
  // When the user invokes the [M] manual fallback while the browser auth
  // hasn't completed (typically because no browser opened — SSH, codespace),
  // we surface a manual API-key input form. The router still resolves Auth
  // when credentials land via setCredentials, so this flow piggybacks on
  // the existing manual entry path (Step 5).
  const [manualFallbackOpen, setManualFallbackOpen] = useState(false);
  // Track the selected workspace locally so we can access its environments
  const [selectedWorkspace, setSelectedWorkspace] = useState<
    OrgEntry['workspaces'][number] | null
  >(null);
  const [selectedEnv, setSelectedEnv] = useState<EnvironmentEntry | null>(null);
  const [apiKeyError, setApiKeyError] = useState('');
  const [savedKeySource, setSavedKeySource] = useState<
    'keychain' | 'env' | null
  >(null);
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);
  const completedStepsRef = useRef<DOMElement>(null);
  const orgChromeRef = useRef<DOMElement>(null);
  const workspaceChromeRef = useRef<DOMElement>(null);
  const projectChromeRef = useRef<DOMElement>(null);

  const pendingOrgs = session.pendingOrgs;
  const completedStepsRows = useMeasuredRows(completedStepsRef);
  const orgChromeRows = useMeasuredRows(orgChromeRef);
  const workspaceChromeRows = useMeasuredRows(workspaceChromeRef);
  const projectChromeRows = useMeasuredRows(projectChromeRef);

  // Validate pre-populated org/workspace IDs against live data.
  // If the user's access changed (removed from org, switched accounts),
  // stale IDs from ./ampli.json could silently select the wrong project.
  useEffect(() => {
    if (!pendingOrgs || pendingOrgs.length === 0) return;
    if (
      session.selectedOrgId &&
      !pendingOrgs.some((o) => o.id === session.selectedOrgId)
    ) {
      // Stale org — clear pre-populated values so the picker shows.
      // persist: false — this effect runs automatically when pendingOrgs
      // arrive; the user's subsequent picker selection writes ampli.json
      // with fresh values.
      store.setOrgAndWorkspace(
        { id: '', name: '' },
        { id: '', name: '' },
        session.installDir,
        { persist: false },
      );
    }
  }, [pendingOrgs]);

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
    if (
      effectiveOrg &&
      effectiveWorkspace &&
      (!session.selectedWorkspaceId ||
        !session.selectedOrgName ||
        !session.selectedWorkspaceName)
    ) {
      // Persist ampli.json only when this effect is committing genuinely
      // new IDs (e.g. first-time single-org / single-workspace auto-select).
      // When the IDs already match what's in the session, this effect is
      // simply backfilling names that ampli.json doesn't store — the disk
      // already has the correct values, so we skip the redundant write.
      // That removes the render-time disk I/O the snapshot tests had to
      // work around without changing the auth flow's observable outcome.
      const idsAlreadyMatch =
        session.selectedOrgId === effectiveOrg.id &&
        session.selectedWorkspaceId === effectiveWorkspace.id;
      store.setOrgAndWorkspace(
        effectiveOrg,
        effectiveWorkspace,
        session.installDir,
        { persist: !idsAlreadyMatch },
      );
    }
  }, [
    effectiveOrg?.id,
    effectiveWorkspace?.id,
    session.selectedOrgId,
    session.selectedWorkspaceId,
    session.selectedOrgName,
    session.selectedWorkspaceName,
  ]);

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
      store.setSelectedEnvName(selectableEnvs[0].name);
    }
  }, [workspaceChosen, selectedEnv, selectableEnvs.length]);

  // True once the user has picked an environment (or it was auto-selected),
  // or there are no environments to pick from (falls through to manual key entry).
  const envResolved = selectedEnv !== null || selectableEnvs.length === 0;

  const pickerBudget = (chromeRows: number): number | undefined => {
    if (!contentArea) return undefined;
    return Math.max(5, contentArea.height - completedStepsRows - chromeRows);
  };

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
        analytics.wizardCapture('api key submitted', {
          'key source': local.source,
        });
        // Resolve env name + appId from the key when we can — the header
        // slot is informational, not required for Auth to complete.
        let matchedAppId: string | null = null;
        if (effectiveWorkspace) {
          const match = (effectiveWorkspace.environments ?? []).find(
            (e) => e.app?.apiKey === local.key,
          );
          if (match) {
            if (!s.selectedEnvName) store.setSelectedEnvName(match.name);
            matchedAppId = match.app?.id ?? null;
          }
        }
        store.setCredentials({
          accessToken: s.pendingAuthAccessToken ?? '',
          idToken: s.pendingAuthIdToken ?? undefined,
          projectApiKey: local.key,
          host: DEFAULT_HOST_URL,
          appId: toCredentialAppId(matchedAppId),
        });
        store.setProjectHasData(false);
        store.setApiKeyNotice(null);
        return;
      }

      // 2. Use the API key from the selected environment
      if (selectedEnv?.app?.apiKey) {
        const apiKey = selectedEnv.app.apiKey;
        const envAppId = selectedEnv.app.id ?? null;
        // readDisk: true — auth screen runs before the RegionSelect gate.
        const zone = resolveZone(s, DEFAULT_AMPLITUDE_ZONE, { readDisk: true });
        const { getHostFromRegion } = await import('../../../utils/urls.js');
        if (cancelled || store.session.credentials !== null) return;

        persistApiKey(apiKey, s.installDir);
        analytics.wizardCapture('api key submitted', {
          'key source': 'environment_picker',
        });
        store.setCredentials({
          accessToken: s.pendingAuthAccessToken ?? '',
          idToken: s.pendingAuthIdToken ?? undefined,
          projectApiKey: apiKey,
          host: getHostFromRegion(zone),
          appId: toCredentialAppId(envAppId),
        });
        store.setProjectHasData(false);
        store.setApiKeyNotice(null);
        return;
      }

      // 3. Fall back to backend fetch (no environments with keys available)
      const idToken = s.pendingAuthIdToken;
      if (!idToken) return;

      // readDisk: true — auth screen runs before the RegionSelect gate.
      const zone = resolveZone(s, DEFAULT_AMPLITUDE_ZONE, { readDisk: true });

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
        analytics.wizardCapture('api key submitted', {
          'key source': 'backend_fetch',
        });
        // Resolve env name + appId from the returned key when possible.
        // Not required for Auth to complete.
        let fetchedAppId: string | null = null;
        if (effectiveWorkspace) {
          const match = (effectiveWorkspace.environments ?? []).find(
            (e) => e.app?.apiKey === projectApiKey,
          );
          if (match) {
            if (!store.session.selectedEnvName) {
              store.setSelectedEnvName(match.name);
            }
            fetchedAppId = match.app?.id ?? null;
          }
        }
        store.setCredentials({
          accessToken: s.pendingAuthAccessToken ?? '',
          idToken: s.pendingAuthIdToken ?? undefined,
          projectApiKey,
          host: getHostFromRegion(zone),
          appId: toCredentialAppId(fetchedAppId),
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
    session.installDir,
  ]);

  const needsOrgPick =
    pendingOrgs !== null && pendingOrgs.length > 1 && effectiveOrg === null;
  const needsWorkspacePick =
    effectiveOrg !== null &&
    effectiveOrg.workspaces.length > 1 &&
    !selectedWorkspace;
  const needsProjectPick =
    workspaceChosen && hasMultipleEnvs && !selectedEnv && !needsWorkspacePick;
  const needsApiKey =
    effectiveOrg !== null &&
    workspaceChosen &&
    envResolved &&
    session.credentials === null &&
    // Only show manual input if there's no selected env with a key
    // (either no envs available, or the env had no key)
    !selectedEnv?.app?.apiKey;

  const handleCreateProject = (fromScreen: 'workspace' | 'project') => {
    // Pre-resolve the org: during the workspace picker, session.selectedOrgId
    // may still be null even though effectiveOrg is known. Commit it now so
    // CreateProjectScreen has the orgId it needs to POST /projects.
    if (effectiveOrg && !session.selectedOrgId) {
      store.setOrgAndWorkspace(
        effectiveOrg,
        effectiveWorkspace ?? { id: '', name: '' },
        session.installDir,
      );
    }
    analytics.wizardCapture('create project link opened', {
      'from screen': fromScreen,
    });
    setPickerNotice(null);
    store.startCreateProject(fromScreen);
  };

  const handleStartOver = (fromScreen: 'workspace' | 'project') => {
    analytics.wizardCapture('picker start over', { 'from screen': fromScreen });
    setSelectedOrg(null);
    setSelectedWorkspace(null);
    setSelectedEnv(null);
    setPickerNotice(null);
    store.setOrgAndWorkspace(
      { id: '', name: '' },
      { id: '', name: '' },
      session.installDir,
    );
    // Clear stale project name — setOrgAndWorkspace doesn't touch it.
    store.setSelectedEnvName(null);

    // Re-fetch the org list so newly-created projects show up in the picker.
    // Best-effort: silently ignore failures and fall back to the cached list.
    const idToken = session.pendingAuthIdToken;
    // readDisk: true — auth screen runs before the RegionSelect gate.
    const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
      readDisk: true,
    });
    if (idToken) {
      void import('../../../lib/api.js').then(({ fetchAmplitudeUser }) =>
        fetchAmplitudeUser(idToken, zone)
          .then((info) => store.setPendingOrgs(info.orgs))
          .catch(() => {
            // Keep the cached list — Start Over still resets local selection.
          }),
      );
    }
  };

  const handleApiKeySubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setApiKeyError('API key cannot be empty');
      return;
    }
    setApiKeyError('');
    analytics.wizardCapture('api key submitted', {
      'key source': 'manual_entry',
    });
    store.setApiKeyNotice(null);
    // Env name stays null for manually-entered keys — we can't determine
    // which environment the key belongs to without an extra backend call.
    // The header will render org / workspace only, which is acceptable.
    store.setCredentials({
      accessToken: session.pendingAuthAccessToken ?? '',
      idToken: session.pendingAuthIdToken ?? undefined,
      projectApiKey: trimmed,
      host: DEFAULT_HOST_URL,
      appId: 0,
    });
    // Fresh project: no existing event data — advance past DataSetup
    store.setProjectHasData(false);
    // Persist so the user doesn't have to enter it again
    void import('../../../utils/api-key-store.js').then(({ persistApiKey }) => {
      const source = persistApiKey(trimmed, session.installDir);
      setSavedKeySource(source);
    });
  };

  // ─── OAuth wait-state coaching ────────────────────────────────────────
  // While step 1 is rendering (pendingOrgs === null), the user is waiting
  // for the browser callback. On SSH / codespace / locked-down envs the
  // browser may never open — without coaching the spinner ticks until the
  // 120s OAuth timeout. After 60s we surface [R]/[M]/[Esc] actions inline
  // so the user can self-rescue.
  const oauthWaiting = pendingOrgs === null && !manualFallbackOpen;
  const { tier: oauthCoachingTier } = useTimedCoaching({
    thresholds: [60],
    progressSignal: oauthWaiting ? 'waiting' : 'resolved',
  });
  const showOauthFallbackHints = oauthWaiting && oauthCoachingTier >= 1;

  // [R] retry browser launch while waiting for OAuth callback. Re-invokes
  // opn() against the cached login URL — useful when the user accidentally
  // closed the browser tab or the first launch silently failed. The wait
  // timer is implicitly reset because the action triggers a re-render
  // cycle and the user sees activity.
  const retryBrowser = async () => {
    const url = session.loginUrl;
    if (!url) return;
    analytics.wizardCapture('auth retry browser launch');
    try {
      const opn = (await import('opn')).default;
      void opn(url, { wait: false }).catch(() => {
        // No browser — user already sees the URL on screen for paste.
      });
    } catch {
      // import failed — nothing to do; the URL is still on screen.
    }
  };

  useScreenInput(
    (input, key) => {
      if (!showOauthFallbackHints) return;
      const ch = input.toLowerCase();
      if (ch === 'r') {
        void retryBrowser();
        return;
      }
      if (ch === 'm') {
        analytics.wizardCapture('auth manual fallback opened');
        setManualFallbackOpen(true);
        return;
      }
      if (key.escape) {
        analytics.wizardCapture('auth cancelled by user');
        void wizardAbort({
          message: 'Authentication cancelled.',
          exitCode: 0,
        });
      }
    },
    { isActive: showOauthFallbackHints },
  );

  // Completed-step indicators shown above the active step
  const completedSteps: Array<{ label: string }> = [];
  if (session.detectedFrameworkLabel) {
    completedSteps.push({
      label: `Framework: ${session.detectedFrameworkLabel}`,
    });
  }
  if (effectiveOrg && !needsOrgPick) {
    completedSteps.push({ label: `Organization: ${effectiveOrg.name}` });
  }
  if (effectiveWorkspace && !needsWorkspacePick) {
    completedSteps.push({ label: `Workspace: ${effectiveWorkspace.name}` });
  }
  if (selectedEnv && !needsProjectPick) {
    completedSteps.push({ label: `Project: ${selectedEnv.name}` });
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Completed steps */}
      {completedSteps.length > 0 && (
        <Box ref={completedStepsRef} flexDirection="column">
          {completedSteps.map((step, i) => (
            <Text key={i}>
              <Text color={Colors.success}>{Icons.checkmark} </Text>
              <Text color={Colors.body}>{step.label}</Text>
            </Text>
          ))}
          <Box height={1} />
        </Box>
      )}

      {/* Step 1: waiting for OAuth browser redirect */}
      {pendingOrgs === null && !manualFallbackOpen && (
        <Box flexDirection="column">
          <Box gap={1}>
            <BrailleSpinner color={Colors.accent} />
            <Text color={Colors.body}>
              Waiting for authentication{Icons.ellipsis}
            </Text>
          </Box>
          {session.loginUrl && (
            <Box marginTop={1} flexDirection="column">
              <Text color={Colors.muted}>
                If the browser didn't open, copy and paste this URL:
              </Text>
              <TerminalLink url={session.loginUrl}>
                {session.loginUrl}
              </TerminalLink>
            </Box>
          )}
          {/* Tier-1 coaching: at 60s the browser likely didn't open. Surface
              actionable single-key fallbacks. The login URL above stays
              visible so [M] and [R] both work without a flash of empty
              chrome. */}
          {showOauthFallbackHints && (
            <Box marginTop={1} flexDirection="column">
              <Text color={Colors.muted}>
                Still waiting{Icons.ellipsis} If the browser didn't open, you
                can:
              </Text>
              <Box marginTop={1} gap={2}>
                <Box>
                  <Text color={Colors.muted}>[</Text>
                  <Text bold color={Colors.body}>
                    R
                  </Text>
                  <Text color={Colors.muted}>] Retry browser launch</Text>
                </Box>
                <Box>
                  <Text color={Colors.muted}>[</Text>
                  <Text bold color={Colors.body}>
                    M
                  </Text>
                  <Text color={Colors.muted}>] Enter API key manually</Text>
                </Box>
                <Box>
                  <Text color={Colors.muted}>[</Text>
                  <Text bold color={Colors.body}>
                    Esc
                  </Text>
                  <Text color={Colors.muted}>] Cancel</Text>
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Manual fallback: user pressed [M] before OAuth resolved. Same
          input UX as Step 5 but reachable without finishing OAuth. The
          loginUrl stays visible so the user can still complete browser
          auth if they change their mind. */}
      {pendingOrgs === null && manualFallbackOpen && (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold color={Colors.heading}>
              Enter your project API key
            </Text>
            <Text color={Colors.muted}>
              Amplitude {Icons.arrowRight} Settings {Icons.arrowRight} Projects{' '}
              {Icons.arrowRight} [your project] {Icons.arrowRight} API Keys
            </Text>
            {session.loginUrl && (
              <Box marginTop={1} flexDirection="column">
                <Text color={Colors.muted}>Or finish browser sign-in at:</Text>
                <TerminalLink url={session.loginUrl}>
                  {session.loginUrl}
                </TerminalLink>
              </Box>
            )}
          </Box>
          <TextInput
            placeholder="Paste API key here..."
            onSubmit={handleApiKeySubmit}
          />
          {apiKeyError && <Text color={Colors.error}>{apiKeyError}</Text>}
        </Box>
      )}

      {/* Step 2: org picker (multiple orgs only) */}
      {needsOrgPick && pendingOrgs && (
        <Box flexDirection="column">
          <Box ref={orgChromeRef} flexDirection="column">
            <Text bold color={Colors.heading}>
              Select your organization
            </Text>
            <Box marginTop={1} />
          </Box>
          <Box>
            <PickerMenu<OrgEntry>
              availableRows={pickerBudget(orgChromeRows)}
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
        </Box>
      )}

      {/* Step 3: workspace picker (multiple workspaces only) */}
      {needsWorkspacePick && effectiveOrg && (
        <Box flexDirection="column">
          <Box ref={workspaceChromeRef} flexDirection="column">
            <Text bold color={Colors.heading}>
              Select a workspace
            </Text>
            <Text color={Colors.secondary}>
              in <Text color={Colors.body}>{effectiveOrg.name}</Text>
            </Text>
            {pickerNotice && (
              <Box marginTop={1}>
                <Text color={Colors.warning}>{pickerNotice}</Text>
              </Box>
            )}
            <Box marginTop={1} />
          </Box>
          <Box>
            <PickerMenu<OrgEntry['workspaces'][number] | PickerAction>
              availableRows={pickerBudget(workspaceChromeRows)}
              options={[
                ...effectiveOrg.workspaces.map((ws) => ({
                  label: ws.name,
                  value: ws as OrgEntry['workspaces'][number] | PickerAction,
                })),
                {
                  label: 'Create new project\u2026',
                  value: CREATE_ACTION as PickerAction,
                },
                ...(pendingOrgs && pendingOrgs.length > 1
                  ? [
                      {
                        label: 'Start over',
                        value: RESTART_ACTION as PickerAction,
                      },
                    ]
                  : []),
              ]}
              onSelect={(value) => {
                const picked = Array.isArray(value) ? value[0] : value;
                if (picked === CREATE_ACTION) {
                  handleCreateProject('workspace');
                  return;
                }
                if (picked === RESTART_ACTION) {
                  handleStartOver('workspace');
                  return;
                }
                if (isPickerAction(picked)) return;
                setPickerNotice(null);
                setSelectedWorkspace(picked);
                store.setOrgAndWorkspace(
                  effectiveOrg,
                  picked,
                  session.installDir,
                );
              }}
            />
          </Box>
        </Box>
      )}

      {/* Step 4: project/environment picker (multiple environments only) */}
      {needsProjectPick && (
        <Box flexDirection="column">
          <Box ref={projectChromeRef} flexDirection="column">
            <Text bold color={Colors.heading}>
              Select a project
            </Text>
            {pickerNotice && (
              <Box marginTop={1}>
                <Text color={Colors.warning}>{pickerNotice}</Text>
              </Box>
            )}
            <Box marginTop={1} />
          </Box>
          <Box>
            <PickerMenu<EnvironmentEntry | PickerAction>
              availableRows={pickerBudget(projectChromeRows)}
              options={[
                ...selectableEnvs.map((env) => ({
                  label: env.name,
                  value: env as EnvironmentEntry | PickerAction,
                })),
                {
                  label: 'Create new project\u2026',
                  value: CREATE_ACTION as PickerAction,
                },
                {
                  label: 'Start over',
                  value: RESTART_ACTION as PickerAction,
                },
              ]}
              onSelect={(value) => {
                const picked = Array.isArray(value) ? value[0] : value;
                if (picked === CREATE_ACTION) {
                  handleCreateProject('project');
                  return;
                }
                if (picked === RESTART_ACTION) {
                  handleStartOver('project');
                  return;
                }
                if (isPickerAction(picked)) return;
                setPickerNotice(null);
                setSelectedEnv(picked);
                store.setSelectedEnvName(picked.name);
              }}
            />
          </Box>
        </Box>
      )}

      {/* Step 5: API key input (only when no env key is available) */}
      {needsApiKey && (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold color={Colors.heading}>
              Enter your project API key
            </Text>
            <Text color={Colors.muted}>
              Amplitude {Icons.arrowRight} Settings {Icons.arrowRight} Projects{' '}
              {Icons.arrowRight} [your project] {Icons.arrowRight} API Keys
            </Text>
            {session.apiKeyNotice && (
              <Box marginTop={1}>
                <Text color={Colors.warning}>{session.apiKeyNotice}</Text>
              </Box>
            )}
          </Box>
          <TextInput
            placeholder="Paste API key here..."
            onSubmit={handleApiKeySubmit}
          />
          {apiKeyError && <Text color={Colors.error}>{apiKeyError}</Text>}
          {savedKeySource && (
            <Text color={Colors.success}>
              {Icons.checkmark}{' '}
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
