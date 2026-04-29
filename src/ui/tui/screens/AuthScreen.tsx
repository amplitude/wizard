/**
 * AuthScreen — Multi-step authentication and account setup (SUSI flow).
 *
 * Steps:
 *   1. OAuth waiting — spinner + login URL while browser auth happens
 *   2. Org selection — picker if the user belongs to multiple orgs
 *   3. Project selection — picker if the org has multiple projects
 *   4. Environment selection — picker if the project has multiple environments
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
  projects: Array<{
    id: string;
    name: string;
    environments?: EnvironmentEntry[] | null;
  }>;
};

/**
 * Returns the environments with usable API keys from a project, sorted by rank.
 */
function getSelectableEnvironments(
  project: OrgEntry['projects'][number] | null | undefined,
): EnvironmentEntry[] {
  if (!project?.environments) return [];
  return project.environments
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
  // Track the selected project locally so we can access its environments
  const [selectedProject, setSelectedProject] = useState<
    OrgEntry['projects'][number] | null
  >(null);
  const [selectedEnv, setSelectedEnv] = useState<EnvironmentEntry | null>(null);
  const [apiKeyError, setApiKeyError] = useState('');
  const [savedKeySource, setSavedKeySource] = useState<
    'keychain' | 'env' | null
  >(null);
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);
  const completedStepsRef = useRef<DOMElement>(null);
  const orgChromeRef = useRef<DOMElement>(null);
  const projectChromeRef = useRef<DOMElement>(null);
  const envChromeRef = useRef<DOMElement>(null);

  const pendingOrgs = session.pendingOrgs;
  const completedStepsRows = useMeasuredRows(completedStepsRef);
  const orgChromeRows = useMeasuredRows(orgChromeRef);
  const projectChromeRows = useMeasuredRows(projectChromeRef);
  const envChromeRows = useMeasuredRows(envChromeRef);

  // Validate pre-populated org/project IDs against live data.
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
      store.setOrgAndProject(
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

  // Resolve project: user-picked > single-project auto-select > pre-populated from session
  const singleProject =
    effectiveOrg?.projects.length === 1 ? effectiveOrg.projects[0] : null;
  const prePopulatedProject =
    session.selectedProjectId && effectiveOrg
      ? effectiveOrg.projects.find(
          (project) => project.id === session.selectedProjectId,
        ) ?? null
      : null;
  const effectiveProject =
    selectedProject ?? singleProject ?? prePopulatedProject ?? null;

  useEffect(() => {
    if (
      effectiveOrg &&
      effectiveProject &&
      (!session.selectedProjectId ||
        !session.selectedOrgName ||
        !session.selectedProjectName)
    ) {
      // Persist ampli.json only when this effect is committing genuinely
      // new IDs (e.g. first-time single-org / single-project auto-select).
      // When the IDs already match what's in the session, this effect is
      // simply backfilling names that ampli.json doesn't store — the disk
      // already has the correct values, so we skip the redundant write.
      // That removes the render-time disk I/O the snapshot tests had to
      // work around without changing the auth flow's observable outcome.
      const idsAlreadyMatch =
        session.selectedOrgId === effectiveOrg.id &&
        session.selectedProjectId === effectiveProject.id;
      store.setOrgAndProject(
        effectiveOrg,
        effectiveProject,
        session.installDir,
        { persist: !idsAlreadyMatch },
      );
    }
  }, [
    effectiveOrg?.id,
    effectiveProject?.id,
    session.selectedOrgId,
    session.selectedProjectId,
    session.selectedOrgName,
    session.selectedProjectName,
  ]);

  // projectChosen requires the local project object (effectiveProject)
  // rather than just session.selectedProjectId, because we need the
  // environments list to drive the environment picker. When selectedProjectId is
  // pre-populated from ampli.json but no project object exists yet,
  // selectableEnvs would be empty and the picker would be bypassed.
  const projectChosen = effectiveProject !== null;

  // Environments available in the selected project
  const selectableEnvs = getSelectableEnvironments(effectiveProject);
  const hasMultipleEnvs = selectableEnvs.length > 1;

  // Auto-select the environment when there's only one with an API key
  useEffect(() => {
    if (projectChosen && !selectedEnv && selectableEnvs.length === 1) {
      setSelectedEnv(selectableEnvs[0]);
      store.setSelectedEnvName(selectableEnvs[0].name);
    }
  }, [projectChosen, selectedEnv, selectableEnvs.length]);

  // True once the user has picked an environment (or it was auto-selected),
  // or there are no environments to pick from (falls through to manual key entry).
  const envResolved = selectedEnv !== null || selectableEnvs.length === 0;

  const pickerBudget = (chromeRows: number): number | undefined => {
    if (!contentArea) return undefined;
    return Math.max(5, contentArea.height - completedStepsRows - chromeRows);
  };

  // Resolve API key from local storage, selected environment, or backend fetch.
  useEffect(() => {
    if (!projectChosen || !envResolved || session.credentials !== null) return;

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
        if (effectiveProject) {
          const match = (effectiveProject.environments ?? []).find(
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
        projectId: s.selectedProjectId ?? undefined,
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
        if (effectiveProject) {
          const match = (effectiveProject.environments ?? []).find(
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
    projectChosen,
    envResolved,
    selectedEnv,
    session.credentials,
    session.selectedProjectId,
    session.pendingAuthIdToken,
    session.region,
    session.installDir,
  ]);

  const needsOrgPick =
    pendingOrgs !== null && pendingOrgs.length > 1 && effectiveOrg === null;
  const needsProjectPick =
    effectiveOrg !== null &&
    effectiveOrg.projects.length > 1 &&
    !selectedProject;
  const needsEnvPick =
    projectChosen && hasMultipleEnvs && !selectedEnv && !needsProjectPick;
  const needsApiKey =
    effectiveOrg !== null &&
    projectChosen &&
    envResolved &&
    session.credentials === null &&
    // Only show manual input if there's no selected env with a key
    // (either no envs available, or the env had no key)
    !selectedEnv?.app?.apiKey;

  const handleCreateProject = (fromScreen: 'project' | 'environment') => {
    // Pre-resolve the org: during the project picker, session.selectedOrgId
    // may still be null even though effectiveOrg is known. Commit it now so
    // CreateProjectScreen has the orgId it needs to POST /projects.
    if (effectiveOrg && !session.selectedOrgId) {
      store.setOrgAndProject(
        effectiveOrg,
        effectiveProject ?? { id: '', name: '' },
        session.installDir,
      );
    }
    analytics.wizardCapture('create project link opened', {
      'from screen': fromScreen,
    });
    setPickerNotice(null);
    store.startCreateProject(fromScreen);
  };

  const handleStartOver = (fromScreen: 'project' | 'environment') => {
    analytics.wizardCapture('picker start over', { 'from screen': fromScreen });
    setSelectedOrg(null);
    setSelectedProject(null);
    setSelectedEnv(null);
    setPickerNotice(null);
    store.setOrgAndProject(
      { id: '', name: '' },
      { id: '', name: '' },
      session.installDir,
    );
    // Clear stale env name — setOrgAndProject doesn't touch it.
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
    // The header will render org / project only, which is acceptable.
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
        // Cancel auth — gracefully exit. The OAuth callback server is
        // owned by the outer oauth.ts; unwinding requires SIGINT-style
        // exit. process.exit(0) matches the convention used elsewhere
        // (OutageScreen onCancel) and produces a clean shutdown.
        analytics.wizardCapture('auth cancelled by user');
        process.exit(0);
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
  if (effectiveProject && !needsProjectPick) {
    completedSteps.push({ label: `Project: ${effectiveProject.name}` });
  }
  if (selectedEnv && !needsEnvPick) {
    completedSteps.push({ label: `Environment: ${selectedEnv.name}` });
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

      {/* Step 3: project picker (multiple projects only) */}
      {needsProjectPick && effectiveOrg && (
        <Box flexDirection="column">
          <Box ref={projectChromeRef} flexDirection="column">
            <Text bold color={Colors.heading}>
              Select a project
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
            <PickerMenu<OrgEntry['projects'][number] | PickerAction>
              availableRows={pickerBudget(projectChromeRows)}
              options={[
                ...effectiveOrg.projects.map((project) => ({
                  label: project.name,
                  value: project as OrgEntry['projects'][number] | PickerAction,
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
                  handleCreateProject('project');
                  return;
                }
                if (picked === RESTART_ACTION) {
                  handleStartOver('project');
                  return;
                }
                if (isPickerAction(picked)) return;
                setPickerNotice(null);
                setSelectedProject(picked);
                store.setOrgAndProject(
                  effectiveOrg,
                  picked,
                  session.installDir,
                );
              }}
            />
          </Box>
        </Box>
      )}

      {/* Step 4: environment picker (multiple environments only) */}
      {needsEnvPick && (
        <Box flexDirection="column">
          <Box ref={envChromeRef} flexDirection="column">
            <Text bold color={Colors.heading}>
              Select an environment
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
              availableRows={pickerBudget(envChromeRows)}
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
                  handleCreateProject('environment');
                  return;
                }
                if (picked === RESTART_ACTION) {
                  handleStartOver('environment');
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
