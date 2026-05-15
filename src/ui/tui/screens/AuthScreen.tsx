/**
 * AuthScreen — Multi-step authentication and account setup (SUSI flow).
 *
 * Steps:
 *   1. Browser sign-in wait — spinner + login URL until OAuth completes
 *   2. Org selection — picker if the user belongs to multiple orgs
 *   3. Project selection — picker if the org has multiple projects
 *   4. Environment selection — picker if the project has multiple environments
 *   5. API key entry — text input (only if no project key could be resolved)
 *
 * The screen drives itself from session.pendingOrgs + session.credentials.
 * When credentials are set the router resolves past this screen.
 */

import { Box, Text, measureElement, type DOMElement } from 'ink';
import {
  useState,
  useEffect,
  useRef,
  type RefObject,
  type ReactElement,
} from 'react';
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
  ProjectPicker,
  type ProjectPickerEntry,
} from '../components/ProjectPicker.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';
import { isCreateAccountOnboarding } from '../../../lib/wizard-session.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import { toCredentialAppId } from '../../../lib/wizard-session.js';
import { analytics } from '../../../utils/analytics.js';
import { getHostFromRegion } from '../../../utils/urls.js';
import { wizardSuccessExit } from '../../../utils/wizard-abort.js';
import { ExitCode } from '../../../lib/exit-codes.js';

// PR 7 (timeline-ux): opt-in gate for the redesigned Auth UX. The new branch
// changes the OAuth-wait layout (URL on its own line, [k] hotkey rail entry
// for an inline masked API-key input), but the legacy rendering stays
// untouched byte-for-byte when the flag is unset. PR 10 will sweep the gate.
//
// Read lazily so tests that toggle the env var inside `beforeEach` get the
// updated value — a module-level constant would be frozen at import time
// and the gate would always read whatever `process.env.WIZARD_NEW_UX` was
// when vitest first loaded the file.
const isNewUxEnabled = (): boolean => process.env.WIZARD_NEW_UX === '1';

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

/**
 * Read an optional pairing-phrase field off the session without
 * trip-wiring a real schema change. When the Amplitude OAuth response
 * starts returning a pairing phrase, add a typed `loginPairingPhrase`
 * field on `WizardSession` and drop this helper.
 */
function readPairingPhrase(session: unknown): string | null {
  if (typeof session !== 'object' || session === null) return null;
  const candidate = (session as Record<string, unknown>).loginPairingPhrase;
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : null;
}

/**
 * NewUxManualKeyForm — gated by WIZARD_NEW_UX=1, rendered only by the new-UX
 * branch of AuthScreen's manual-key fallback. Shows a masked `●`-padded
 * preview of the typed key plus a `[v]` reveal toggle in the hotkey rail.
 *
 * Implementation notes:
 *  - The raw value lives inside @inkjs/ui TextInput (controlled via
 *    onChange + defaultValue). We mirror it into the parent's apiKeyDraft
 *    purely so the [v] reveal toggle's re-render keeps the value stable.
 *  - The masked preview is purely a presentation layer — the underlying
 *    TextInput still owns keystrokes; we just render a sibling Text node
 *    that summarizes the length. We never call console.log on the key, so
 *    nothing leaks to terminal stdout.
 *  - `useScreenInput` is scoped to this subtree so the [v] handler only
 *    fires while the manual form is mounted.
 */
function NewUxManualKeyForm({
  apiKeyDraft,
  setApiKeyDraft,
  revealApiKey,
  setRevealApiKey,
  loginUrl,
  apiKeyError,
  onSubmit,
}: {
  apiKeyDraft: string;
  setApiKeyDraft: (next: string) => void;
  revealApiKey: boolean;
  setRevealApiKey: (next: boolean) => void;
  loginUrl: string | null;
  apiKeyError: string;
  onSubmit: (value: string) => void;
}): ReactElement {
  // [v] toggles the reveal flag. The input itself swallows alphanumeric
  // keys, so we register the handler at the screen level — the `v`
  // appears as a CTRL-prefixed event when typed in the input box, so we
  // gate on the meta key. To keep typing the letter "v" inside the key
  // valid, treat [v] as a toggle ONLY when the input field is empty OR
  // followed by Tab; otherwise the user might be typing a literal "v".
  // Practical balance: we always allow toggling via `Ctrl+v` (paste is
  // platform-handled by the terminal). This keeps the AC's `[v]`
  // reveal/un-reveal contract while avoiding hostile interference.
  useScreenInput((input, key) => {
    if ((key.ctrl && input === 'v') || (apiKeyDraft.length === 0 && input === 'v')) {
      setRevealApiKey(!revealApiKey);
    }
  });

  const maskedPreview =
    apiKeyDraft.length > 0 ? '●'.repeat(apiKeyDraft.length) : '';

  return (
    <Box flexDirection="column" gap={1} overflow="hidden">
      <Box flexDirection="column">
        <Text bold color={Colors.heading}>
          Enter your project API key
        </Text>
        <Text color={Colors.muted}>
          Amplitude {Icons.arrowRight} Settings {Icons.arrowRight} Projects{' '}
          {Icons.arrowRight} [your project] {Icons.arrowRight} API Keys
        </Text>
        {loginUrl && (
          <Box marginTop={1} flexDirection="column">
            <Text color={Colors.muted}>Or finish browser sign-in at:</Text>
            <Box>
              <TerminalLink url={loginUrl}>{loginUrl}</TerminalLink>
            </Box>
          </Box>
        )}
      </Box>
      <Box flexDirection="column">
        <TextInput
          placeholder="Paste API key here..."
          onChange={setApiKeyDraft}
          onSubmit={onSubmit}
        />
        {!revealApiKey && apiKeyDraft.length > 0 && (
          <Text color={Colors.muted}>
            masked: <Text color={Colors.body}>{maskedPreview}</Text>
          </Text>
        )}
        {revealApiKey && apiKeyDraft.length > 0 && (
          <Text color={Colors.muted}>
            revealed: <Text color={Colors.body}>{apiKeyDraft}</Text>
          </Text>
        )}
      </Box>
      <Box gap={2}>
        <Box>
          <Text color={Colors.muted}>[</Text>
          <Text bold color={Colors.body}>
            v
          </Text>
          <Text color={Colors.muted}>
            ] {revealApiKey ? 'hide key' : 'reveal key'}
          </Text>
        </Box>
        <Box>
          <Text color={Colors.muted}>[</Text>
          <Text bold color={Colors.body}>
            Enter
          </Text>
          <Text color={Colors.muted}>] submit</Text>
        </Box>
      </Box>
      {apiKeyError && <Text color={Colors.error}>{apiKeyError}</Text>}
    </Box>
  );
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
  // New-UX only: reveal/un-reveal toggle for the masked API-key entry.
  // Lives at the component scope so the [v] hotkey handler (registered
  // alongside [k]) can flip it independently of the input itself.
  const [revealApiKey, setRevealApiKey] = useState(false);
  // New-UX only: draft for the masked API-key input. Tracked here so the
  // mask-vs-reveal toggle can re-render the same in-flight value without
  // the user re-typing. NEVER echoed to stdout or analytics.
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  // Track the selected project locally so we can access its environments
  const [selectedProject, setSelectedProject] = useState<
    OrgEntry['projects'][number] | null
  >(null);
  const [selectedEnv, setSelectedEnv] = useState<EnvironmentEntry | null>(null);
  const [apiKeyError, setApiKeyError] = useState('');
  const [savedKeySource, setSavedKeySource] = useState<'cache' | 'env' | null>(
    null,
  );
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
        // Region-aware host so EU users don't get their credentials.host
        // pinned to api2.amplitude.com (US). readDisk: true matches the
        // sibling branches below — Auth runs before RegionSelect commits.
        const zone = resolveZone(s, DEFAULT_AMPLITUDE_ZONE, { readDisk: true });
        if (cancelled || store.session.credentials !== null) return;
        store.setCredentials({
          accessToken: s.pendingAuthAccessToken ?? '',
          idToken: s.pendingAuthIdToken ?? undefined,
          projectApiKey: local.key,
          host: getHostFromRegion(zone),
          appId: toCredentialAppId(matchedAppId),
        });
        store.setProjectHasData(false);
        store.setApiKeyNotice(null);
        // Clear the env-picker deferral now that credentials landed — see
        // `applyEnvSelectionDeferral` in src/commands/helpers.ts.
        store.setPendingEnvSelection(false);
        return;
      }

      // 2. Use the API key from the selected environment
      if (selectedEnv?.app?.apiKey) {
        const apiKey = selectedEnv.app.apiKey;
        const envAppId = selectedEnv.app.id ?? null;
        // readDisk: true — auth screen runs before the RegionSelect gate.
        const zone = resolveZone(s, DEFAULT_AMPLITUDE_ZONE, { readDisk: true });
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
        // Clear the env-picker deferral now that the user has resolved the
        // env pick by selecting an env with a known API key — see
        // `applyEnvSelectionDeferral` in src/commands/helpers.ts.
        store.setPendingEnvSelection(false);
        return;
      }

      // 3. Fall back to backend fetch (no environments with keys available)
      const idToken = s.pendingAuthIdToken;
      if (!idToken) return;

      // readDisk: true — auth screen runs before the RegionSelect gate.
      const zone = resolveZone(s, DEFAULT_AMPLITUDE_ZONE, { readDisk: true });

      const { getAPIKey } = await import('../../../utils/get-api-key.js');

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
        // Clear the env-picker deferral — credentials are now resolved
        // via the backend fetch path. See `applyEnvSelectionDeferral`.
        store.setPendingEnvSelection(false);
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
    //
    // persist:false is critical when the user hasn't picked a project yet —
    // writeAmpliConfig now refuses partial bindings (org without project, or
    // vice-versa) so a persisting call here would silently no-op, but the
    // explicit flag documents the intent and avoids relying on the guard.
    if (effectiveOrg && !session.selectedOrgId) {
      const persist = Boolean(effectiveProject);
      store.setOrgAndProject(
        effectiveOrg,
        effectiveProject ?? { id: '', name: '' },
        session.installDir,
        { persist },
      );
    }
    analytics.wizardCapture('create project link opened', {
      'from screen': fromScreen,
    });
    store.startCreateProject(fromScreen);
  };

  const handleStartOver = (fromScreen: 'project' | 'environment') => {
    analytics.wizardCapture('picker start over', { 'from screen': fromScreen });
    setSelectedOrg(null);
    setSelectedProject(null);
    setSelectedEnv(null);
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
    // Region-aware host so EU users on the manual path don't get their
    // credentials.host pinned to api2.amplitude.com (US), which would
    // route LLM traffic through the US gateway.
    const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
      readDisk: true,
    });
    store.setCredentials({
      accessToken: session.pendingAuthAccessToken ?? '',
      idToken: session.pendingAuthIdToken ?? undefined,
      projectApiKey: trimmed,
      host: getHostFromRegion(zone),
      appId: 0,
    });
    // Fresh project: no existing event data — advance past DataSetup
    store.setProjectHasData(false);
    // Manual API key entry resolves any pending env-picker deferral too —
    // the user just supplied a key, so the flow should proceed forward.
    store.setPendingEnvSelection(false);
    // Persist so the user doesn't have to enter it again
    void import('../../../utils/api-key-store.js').then(({ persistApiKey }) => {
      const source = persistApiKey(trimmed, session.installDir);
      setSavedKeySource(source);
    });
  };

  // ─── OAuth wait-state coaching ────────────────────────────────────────
  // While step 1 is rendering (pendingOrgs === null), the user is waiting
  // for the browser callback. On SSH / codespace / locked-down envs the
  // browser may never open — and even on local machines a stale stored
  // token can leave the wizard probing the API for several seconds before
  // it falls through to opening the browser. Without coaching the user
  // sees a blank spinner with no actions and assumes the wizard is broken.
  //
  // Two-tier strategy:
  //   - Always-on: [M] manual API key + [Esc] cancel are surfaced from t=0
  //     so the user is never stuck on a screen with no exit. Cheap UI cost,
  //     huge resilience win.
  //   - Tier-1 (15s): emphatic "Still waiting…" coaching with [R] retry
  //     surfaces if we still don't have a login URL or org list. The old
  //     60s threshold was longer than the user reported putting up with
  //     before quitting and re-running.
  const oauthWaiting = pendingOrgs === null && !manualFallbackOpen;
  // After email capture + ToS, "authentication" sounds like we're still
  // waiting on the user; the real wait is browser OAuth completing.
  const oauthWaitHeadline = isCreateAccountOnboarding(session)
    ? 'Complete sign-in in your browser'
    : 'Signing you in';
  // Choose the placeholder message based on what the auth task is actually
  // doing right now. Showing "Preparing your sign-in link…" while the
  // wizard is reusing a stored OAuth token (no browser opening, no URL
  // coming) was the P0 symptom that looked like a hang. The auth task
  // signals 'verifying-session' before performAmplitudeAuth and switches
  // to 'opening-browser' once a fresh OAuth flow is actually starting.
  //
  // `idle` covers the brief window between AuthScreen mounting and the
  // authTask waking up from its gate (`introConcluded` + `region` set).
  // For users with a stored token + region, that window resolves into
  // 'verifying-session' within milliseconds — but if the gate is parked
  // (e.g. region just got cleared by `/region`, or the user is mid-
  // signup), the screen used to fall through to "Preparing your sign-in
  // link" with no browser actually being prepared, repeating the same
  // misleading-copy hang #611 fixed. Treat `idle` like `verifying-session`
  // because that's the most likely next phase for any returning user.
  const oauthWaitPreparingLine = isCreateAccountOnboarding(session)
    ? 'Opening your Amplitude sign-in page'
    : session.authPhase === 'verifying-session' || session.authPhase === 'idle'
    ? 'Verifying your session'
    : 'Preparing your sign-in link';
  const { tier: oauthCoachingTier } = useTimedCoaching({
    thresholds: [15],
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
      if (!oauthWaiting) return;
      const ch = input.toLowerCase();
      // [R] only does something once we have a URL to relaunch — gate it
      // on that, not on the coaching tier, so the same key works whether
      // the user notices the URL at t=2s or at t=20s.
      if (ch === 'r' && session.loginUrl) {
        void retryBrowser();
        return;
      }
      if (ch === 'm') {
        analytics.wizardCapture('auth manual fallback opened');
        setManualFallbackOpen(true);
        return;
      }
      // New-UX alias: [k] is the canonical "paste an api key instead"
      // hotkey for the redesigned auth screen. We accept it alongside
      // the legacy [m] so the new label in the hotkey rail matches an
      // actual key event without churning analytics or muscle memory.
      if (isNewUxEnabled() && ch === 'k') {
        analytics.wizardCapture('auth manual fallback opened');
        setManualFallbackOpen(true);
        return;
      }
      if (key.escape) {
        // Cancel auth — gracefully exit. The OAuth callback server is
        // owned by the outer oauth.ts; unwinding requires SIGINT-style
        // exit. Route through `wizardSuccessExit` (see the
        // account-confirm Esc handler below for the same pattern) so
        // the analytics SDK has a chance to flush — a bare
        // `process.exit(0)` silently dropped the
        // 'auth cancelled by user' event because the SDK queues on a
        // timer and the queue dies with the process.
        analytics.wizardCapture('auth cancelled by user');
        void wizardSuccessExit(ExitCode.USER_CANCELLED);
      }
    },
    { isActive: oauthWaiting },
  );

  // ─── Account confirmation (returning user) ────────────────────────────
  // When the wizard resolves credentials silently from disk on a returning
  // run, the user gets a one-shot confirm step before we route them to a
  // project they didn't explicitly choose. Renders as the only Auth-screen
  // content while active — every other step is suppressed below.
  const accountConfirm = session.requiresAccountConfirmation;
  useScreenInput(
    (input, key) => {
      if (!accountConfirm) return;
      const ch = input.toLowerCase();
      if (key.return || ch === 'y') {
        store.confirmAccount();
        return;
      }
      if (ch === 'c') {
        store.rejectStoredAccount();
        return;
      }
      if (ch === 'n') {
        // Keep credentials + org + project intact; only flip off the
        // confirmation gate so CreateProjectScreen can render. The
        // create success path overwrites project fields; cancel restores
        // the confirm screen so the original project stays visible.
        store.dismissAccountConfirmForNewProject();
        store.startCreateProject('account-confirm');
        return;
      }
      if (key.escape) {
        analytics.wizardCapture('auth cancelled by user', {
          'from screen': 'account-confirm',
        });
        // Route through wizardSuccessExit so the analytics SDK gets a
        // chance to flush before the process tears down — a bare
        // process.exit(0) silently dropped the 'auth cancelled by user'
        // event (the SDK queues on a timer and the queue dies with the
        // process).
        void wizardSuccessExit(ExitCode.USER_CANCELLED);
      }
    },
    { isActive: accountConfirm },
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

  // While the confirm step is active, render ONLY that — all other steps
  // are suppressed below by short-circuiting on `accountConfirm`.
  if (accountConfirm) {
    const orgLabel = session.selectedOrgName ?? session.selectedOrgId ?? '—';
    const projectLabel =
      session.selectedProjectName ?? session.selectedProjectId ?? '—';
    const envLabel = session.selectedEnvName ?? null;
    return (
      <Box flexDirection="column" flexGrow={1} gap={1}>
        <Box flexDirection="column">
          <Text bold color={Colors.heading}>
            Continue with this Amplitude project?
          </Text>
          <Text color={Colors.muted}>
            We picked up your previous selection from this machine. Confirm it's
            still right before we run the wizard against it.
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text>
            <Text color={Colors.muted}>Organization: </Text>
            <Text color={Colors.body}>{orgLabel}</Text>
          </Text>
          <Text>
            <Text color={Colors.muted}>Project: </Text>
            <Text color={Colors.body}>{projectLabel}</Text>
          </Text>
          {envLabel && (
            <Text>
              <Text color={Colors.muted}>Environment: </Text>
              <Text color={Colors.body}>{envLabel}</Text>
            </Text>
          )}
          {session.userEmail && (
            <Text>
              <Text color={Colors.muted}>Signed in as: </Text>
              <Text color={Colors.body}>{session.userEmail}</Text>
            </Text>
          )}
        </Box>
        <Box gap={2}>
          <Box>
            <Text color={Colors.muted}>[</Text>
            <Text bold color={Colors.body}>
              Enter
            </Text>
            <Text color={Colors.muted}>] Continue</Text>
          </Box>
          <Box>
            <Text color={Colors.muted}>[</Text>
            <Text bold color={Colors.body}>
              C
            </Text>
            <Text color={Colors.muted}>] Change project</Text>
          </Box>
          <Box>
            <Text color={Colors.muted}>[</Text>
            <Text bold color={Colors.body}>
              N
            </Text>
            <Text color={Colors.muted}>] New project</Text>
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
    );
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      overflow={isNewUxEnabled() ? 'hidden' : undefined}
    >
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

      {/* Step 1: waiting for OAuth browser redirect.
          The URL slot is rendered unconditionally — when loginUrl isn't ready
          yet we show a placeholder so the screen is never just a spinner with
          nothing actionable. Always-on hints surface [M]anual key entry and
          [Esc]ape from t=0 so a returning user with a stale token never lands
          on a dead-end screen while we fall through to fresh OAuth.

          PR 7 redesign: under WIZARD_NEW_UX=1, the URL goes on its own line
          with no prose-prefix, an additional [K] alias surfaces in the hint
          rail, and the structured auth_required payload renders inline when
          an apiKeyNotice is present so users on dumb terminals can copy the
          loginCommand / resumeCommand. The legacy branch below is the
          byte-for-byte fallback when the flag is unset. */}
      {pendingOrgs === null &&
        !manualFallbackOpen &&
        (isNewUxEnabled() ? (
          <Box flexDirection="column" overflow="hidden">
            <Box gap={1}>
              <BrailleSpinner color={Colors.accent} />
              <Text color={Colors.body}>
                {oauthWaitHeadline}
                {Icons.ellipsis}
              </Text>
            </Box>
            {/* Pairing-phrase slot: today the Amplitude OAuth response
                doesn't return one, so this is a placeholder. When the
                backend starts emitting `session.loginPairingPhrase` (or
                similar) the renderer below picks it up automatically.
                Deferred per PR 7 brief. Read via a typed escape hatch
                so the lint warnings stay quiet — adding a real session
                field would silently make the placeholder render. */}
            {readPairingPhrase(session) !== null && (
              <Box marginTop={1} flexDirection="column">
                <Text color={Colors.muted}>Pairing phrase:</Text>
                <Text bold color={Colors.accent}>
                  {readPairingPhrase(session)}
                </Text>
              </Box>
            )}
            <Box marginTop={1} flexDirection="column">
              {session.loginUrl ? (
                <>
                  <Text color={Colors.muted}>
                    If the browser didn't open, copy this URL:
                  </Text>
                  {/* Full URL on its OWN line so dumb terminals + screen
                      readers can copy it without prose adjacency. */}
                  <Box>
                    <TerminalLink url={session.loginUrl}>
                      {session.loginUrl}
                    </TerminalLink>
                  </Box>
                </>
              ) : (
                <Text color={Colors.muted}>
                  {oauthWaitPreparingLine}
                  {Icons.ellipsis} (this normally takes a few seconds)
                </Text>
              )}
            </Box>
            {/* Always-visible hotkey rail. [k] is the canonical key for
                "paste an api key instead" in the new UX; [M] still works
                as a legacy alias from useScreenInput so existing muscle
                memory keeps working without a re-bind. */}
            <Box marginTop={1} gap={2}>
              {session.loginUrl && (
                <Box>
                  <Text color={Colors.muted}>[</Text>
                  <Text bold color={Colors.body}>
                    r
                  </Text>
                  <Text color={Colors.muted}>] retry browser</Text>
                </Box>
              )}
              <Box>
                <Text color={Colors.muted}>[</Text>
                <Text bold color={Colors.body}>
                  k
                </Text>
                <Text color={Colors.muted}>] paste an api key instead</Text>
              </Box>
              <Box>
                <Text color={Colors.muted}>[</Text>
                <Text bold color={Colors.body}>
                  Esc
                </Text>
                <Text color={Colors.muted}>] cancel</Text>
              </Box>
            </Box>
            {/* Structured auth_required payload — surfaces when an
                apiKeyNotice is set so the user has a copy-paste-able
                resume hint instead of the bare warning string. */}
            {session.apiKeyNotice && (
              <Box marginTop={1} flexDirection="column">
                <Text color={Colors.warning}>{session.apiKeyNotice}</Text>
                <Box marginTop={1} flexDirection="column">
                  <Text color={Colors.muted}>auth_required:</Text>
                  <Text color={Colors.body}>
                    {'  '}loginCommand: amplitude-wizard login
                  </Text>
                  <Text color={Colors.body}>
                    {'  '}resumeCommand: amplitude-wizard
                  </Text>
                </Box>
              </Box>
            )}
            {showOauthFallbackHints && (
              <Box marginTop={1}>
                <Text color={Colors.warning}>
                  Still waiting{Icons.ellipsis} If your browser didn't open or
                  you'd rather not wait, use one of the actions above.
                </Text>
              </Box>
            )}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box gap={1}>
              <BrailleSpinner color={Colors.accent} />
              <Text color={Colors.body}>
                {oauthWaitHeadline}
                {Icons.ellipsis}
              </Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
              {session.loginUrl ? (
                <>
                  <Text color={Colors.muted}>
                    If the browser didn't open, copy and paste this URL:
                  </Text>
                  <TerminalLink url={session.loginUrl}>
                    {session.loginUrl}
                  </TerminalLink>
                </>
              ) : (
                <Text color={Colors.muted}>
                  {oauthWaitPreparingLine}
                  {Icons.ellipsis} (this normally takes a few seconds)
                </Text>
              )}
            </Box>
            {/* Always-on quick exits: [M] manual key entry, [Esc] cancel.
                [R] only renders once we have a URL to retry. Single muted
                line so the happy path stays uncluttered. */}
            <Box marginTop={1} gap={2}>
              {session.loginUrl && (
                <Box>
                  <Text color={Colors.muted}>[</Text>
                  <Text bold color={Colors.body}>
                    R
                  </Text>
                  <Text color={Colors.muted}>] Retry browser</Text>
                </Box>
              )}
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
            {/* Tier-1 coaching at 15s: the wizard is taking longer than
                expected. Surface an explicit "Still waiting…" line above
                the always-on hints so the user knows we noticed. */}
            {showOauthFallbackHints && (
              <Box marginTop={1}>
                <Text color={Colors.warning}>
                  Still waiting{Icons.ellipsis} If your browser didn't open or
                  you'd rather not wait, use one of the actions above.
                </Text>
              </Box>
            )}
          </Box>
        ))}

      {/* Manual fallback: user pressed [M]/[K] before OAuth resolved. Same
          input UX as Step 5 but reachable without finishing OAuth. The
          loginUrl stays visible so the user can still complete browser
          auth if they change their mind.

          PR 7 redesign: under WIZARD_NEW_UX=1, the input is masked with
          `●` and a [v] reveal toggle is offered. The masked rendering is
          a pure presentation overlay — the actual TextInput still owns
          the raw value, we just hide what's rendered into the frame. The
          key value is never echoed to terminal stdout (no console.log of
          the key happens anywhere in this handler). */}
      {pendingOrgs === null &&
        manualFallbackOpen &&
        (isNewUxEnabled() ? (
          <NewUxManualKeyForm
            apiKeyDraft={apiKeyDraft}
            setApiKeyDraft={setApiKeyDraft}
            revealApiKey={revealApiKey}
            setRevealApiKey={setRevealApiKey}
            loginUrl={session.loginUrl}
            apiKeyError={apiKeyError}
            onSubmit={handleApiKeySubmit}
          />
        ) : (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Text bold color={Colors.heading}>
                Enter your project API key
              </Text>
              <Text color={Colors.muted}>
                Amplitude {Icons.arrowRight} Settings {Icons.arrowRight}{' '}
                Projects {Icons.arrowRight} [your project] {Icons.arrowRight}{' '}
                API Keys
              </Text>
              {session.loginUrl && (
                <Box marginTop={1} flexDirection="column">
                  <Text color={Colors.muted}>
                    Or finish browser sign-in at:
                  </Text>
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
        ))}

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

      {/* Step 3: project picker (multiple projects only).
          Gated swap \u2014 when WIZARD_NEW_UX=1, render the new fuzzy +
          column-scoped picker. Legacy PickerMenu path untouched. */}
      {needsProjectPick &&
        effectiveOrg &&
        process.env.WIZARD_NEW_UX === '1' && (
          <Box flexDirection="column">
            <Box ref={projectChromeRef} flexDirection="column">
              <Text bold color={Colors.heading}>
                Select a project
              </Text>
              <Text color={Colors.secondary}>
                in <Text color={Colors.body}>{effectiveOrg.name}</Text>
              </Text>
              <Box marginTop={1} />
            </Box>
            <ProjectPicker
              projects={effectiveOrg.projects.map(
                (p): ProjectPickerEntry => ({
                  id: p.id,
                  name: p.name,
                  orgName: effectiveOrg.name,
                  orgId: effectiveOrg.id,
                  envName: p.environments?.[0]?.name ?? null,
                }),
              )}
              onSelect={(picked) => {
                const projectObj = effectiveOrg.projects.find(
                  (p) => p.id === picked.id,
                );
                if (!projectObj) return;
                setSelectedProject(projectObj);
                store.setOrgAndProject(
                  effectiveOrg,
                  projectObj,
                  session.installDir,
                );
              }}
              onCreate={() => handleCreateProject('project')}
            />
          </Box>
        )}
      {needsProjectPick &&
        effectiveOrg &&
        process.env.WIZARD_NEW_UX !== '1' && (
          <Box flexDirection="column">
            <Box ref={projectChromeRef} flexDirection="column">
              <Text bold color={Colors.heading}>
                Select a project
              </Text>
              <Text color={Colors.secondary}>
                in <Text color={Colors.body}>{effectiveOrg.name}</Text>
              </Text>
              <Box marginTop={1} />
            </Box>
            <Box>
              <PickerMenu<OrgEntry['projects'][number] | PickerAction>
                availableRows={pickerBudget(projectChromeRows)}
                options={[
                  ...effectiveOrg.projects.map((project) => ({
                    label: project.name,
                    value: project as
                      | OrgEntry['projects'][number]
                      | PickerAction,
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
              {savedKeySource === 'cache'
                ? 'API key saved'
                : 'API key saved to .env.local'}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};
