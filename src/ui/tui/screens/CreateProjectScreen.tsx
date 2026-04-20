/**
 * CreateProjectScreen — Inline "Create new project…" flow.
 *
 * Reached from AuthScreen when the user picks "Create new project…" from
 * either the workspace picker or the project picker, and via the
 * `/create-project` slash command.
 *
 * Flow:
 *   1. Prompt for a project name (TextInput)
 *   2. Validate locally (non-empty, ≤255 chars, no control chars)
 *   3. POST {proxyBase}/projects via createAmplitudeApp()
 *   4. On success:
 *        - Persist the returned apiKey via setCredentials() — this advances
 *          past AuthScreen the same way the regular env picker does.
 *        - Fire-and-forget refresh the org list so the new project shows
 *          up if the user navigates back.
 *   5. On error:
 *        - NAME_TAKEN: stay on screen, show inline error, let user retry.
 *        - QUOTA_REACHED: friendly message + fallback deep-link.
 *        - FORBIDDEN: "ask your admin" + cancel back to picker.
 *        - INVALID_REQUEST / INTERNAL / network: show message + retry button
 *          + fallback deep-link.
 *
 * The screen renders only when `session.createProject.pending` is true;
 * the router skips AuthScreen while in this mode.
 */

import { Box, Text, useInput } from 'ink';
import { useState, useEffect } from 'react';
import { TextInput } from '@inkjs/ui';
import opn from 'opn';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { TerminalLink } from '../primitives/index.js';
import { OUTBOUND_URLS, type AmplitudeZone } from '../../../lib/constants.js';
import { analytics } from '../../../utils/analytics.js';
import {
  createAmplitudeApp,
  validateProjectName,
  fetchAmplitudeUser,
  type CreateProjectErrorCode,
  ApiError,
} from '../../../lib/api.js';
import { getHostFromRegion } from '../../../utils/urls.js';

interface CreateProjectScreenProps {
  store: WizardStore;
}

type Phase =
  // `lastTypedName` carries the user's most recent input across a retry so
  // the idle TextInput can seed its defaultValue with it instead of
  // falling back to the (often empty) session-suggested name.
  | { kind: 'idle'; lastTypedName?: string }
  | { kind: 'submitting'; name: string }
  | {
      kind: 'error';
      name: string;
      code: CreateProjectErrorCode;
      message: string;
    };

export const CreateProjectScreen = ({ store }: CreateProjectScreenProps) => {
  useWizardStore(store);

  const { session } = store;
  // Normalize to a known zone — matches bin.ts's create-project path so an
  // unexpected value defaults safely to 'us' instead of flowing into the
  // proxy URL lookup as a cast string.
  const zone: AmplitudeZone =
    (session.region ?? session.pendingAuthCloudRegion) === 'eu' ? 'eu' : 'us';
  const orgId = session.selectedOrgId;
  const orgName = session.selectedOrgName;
  // /create-project can fire mid-SUSI (pending* tokens set, credentials
  // null) OR after the user is fully signed in (credentials set, pending*
  // may be null because bin.ts auto-selected a single environment). We need
  // BOTH tokens: the access token authenticates against the wizard-proxy
  // (Hydra introspection rejects id_tokens), and the id_token is what
  // fetchAmplitudeUser + the stored credentials use for the data-api.
  const accessToken =
    session.pendingAuthAccessToken || session.credentials?.accessToken || null;
  const idToken =
    session.pendingAuthIdToken || session.credentials?.idToken || null;

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // Uncontrolled TextInput — we only read the value on submit. We seed
  // with the suggested name so agent/CI mode can auto-fill.
  const suggestedName = session.createProject.suggestedName ?? '';

  // In agent/CI mode we must NOT prompt — if the flow got here with a name,
  // submit automatically; otherwise surface a clear error to the caller.
  // The actual agent/CI routing lives in bin.ts (see resolveNonInteractive
  // CreateProject helper) — this guard is defensive for edge cases where the
  // TUI is somehow active in a non-interactive context.
  useEffect(() => {
    if (
      phase.kind !== 'idle' ||
      !suggestedName ||
      !(session.agent || session.ci) ||
      !orgId ||
      !accessToken ||
      !idToken
    ) {
      return;
    }
    void handleSubmit(suggestedName);
    // Only fires once on mount — intentionally empty deps.
  }, []);

  // Esc cancels from any phase that isn't a live submission.
  useInput((input, key) => {
    if (key.escape && phase.kind !== 'submitting') {
      store.cancelCreateProject();
    }
  });

  const handleSubmit = async (rawValue: string) => {
    const name = rawValue.trim();
    const issue = validateProjectName(name);
    if (issue) {
      setPhase({
        kind: 'error',
        name,
        code: 'INVALID_REQUEST',
        message: issue.message,
      });
      return;
    }

    if (!orgId) {
      setPhase({
        kind: 'error',
        name,
        code: 'INVALID_REQUEST',
        message:
          'No organization selected. Cancel and pick an organization first.',
      });
      return;
    }

    if (!accessToken || !idToken) {
      setPhase({
        kind: 'error',
        name,
        code: 'FORBIDDEN',
        message:
          'You must be signed in to create a project. Press Esc to cancel and /login to sign in.',
      });
      return;
    }

    setPhase({ kind: 'submitting', name });
    analytics.wizardCapture('Create Project Submit', {
      source: session.createProject.source,
    });

    try {
      const result = await createAmplitudeApp(accessToken, zone, {
        orgId,
        name,
      });

      // Persist the apiKey + update credentials so AuthScreen's completion
      // predicate (`session.credentials !== null`) fires and the router
      // advances to the data check. The apiKey is *not* stored on
      // session.createProject — it flows through credentials like every
      // other key.
      //
      // Persist inside its own try — the project already exists on the
      // backend at this point, so a local write failure (FS permission
      // etc.) must not be treated as a create-project error.
      const { persistApiKey } = await import('../../../utils/api-key-store.js');
      try {
        persistApiKey(result.apiKey, session.installDir);
      } catch {
        // In-memory credentials below still let the flow progress; a rerun
        // will re-persist. Intentionally swallow — surfacing as a create
        // error would misrepresent the backend state to the user.
      }

      store.setSelectedEnvName(result.name);
      // Dash creates a same-named taxonomy workspace alongside the new app.
      // Setting the workspace name satisfies Auth.isComplete so the router
      // can advance past Auth; the real workspace id will appear on the
      // next fetchAmplitudeUser refresh.
      store.restoreSessionIds({ workspaceName: result.name });
      store.setCredentials({
        accessToken:
          session.pendingAuthAccessToken ??
          session.credentials?.accessToken ??
          '',
        idToken,
        projectApiKey: result.apiKey,
        host: getHostFromRegion(zone),
        // The proxy returns `appId` as a string; credentials.appId is
        // numeric. Attempt a coercion — fall back to 0 if the backend ever
        // returns a non-numeric id.
        appId: Number.parseInt(result.appId, 10) || 0,
      });
      store.setProjectHasData(false);
      store.setApiKeyNotice(null);

      // Fire-and-forget org refresh so the new project appears if the user
      // navigates back to the picker. Best-effort — never blocks the flow.
      void fetchAmplitudeUser(idToken, zone)
        .then((info) => store.setPendingOrgs(info.orgs))
        .catch(() => {
          // Swallow — we've already landed on success.
        });

      // Clear the create-project state last, after credentials are set, so
      // the router only transitions once.
      store.completeCreateProject();
    } catch (err) {
      const code: CreateProjectErrorCode =
        err instanceof ApiError && err.code
          ? (err.code as CreateProjectErrorCode)
          : 'INTERNAL';
      const message =
        err instanceof Error
          ? err.message
          : 'Could not create project. Please try again.';
      analytics.wizardCapture('Create Project Error', { code });
      setPhase({ kind: 'error', name, code, message });
    }
  };

  const handleOpenFallback = () => {
    const url = OUTBOUND_URLS.projectsSettings(zone, orgId ?? undefined);
    analytics.wizardCapture('Create Project Fallback Link Opened', {
      code: phase.kind === 'error' ? phase.code : 'unknown',
    });
    opn(url, { wait: false }).catch(() => {});
  };

  const handleRetry = () => {
    const lastTypedName = phase.kind === 'error' ? phase.name : undefined;
    setPhase({ kind: 'idle', lastTypedName });
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          Create a new Amplitude project
        </Text>
        {orgName && (
          <Text color={Colors.secondary}>
            in <Text color={Colors.body}>{orgName}</Text>
          </Text>
        )}
      </Box>

      {phase.kind === 'idle' && (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text color={Colors.body}>Project name</Text>
            <Text color={Colors.muted}>
              Letters, numbers, and spaces. You can rename it later in
              Amplitude.
            </Text>
          </Box>
          <TextInput
            defaultValue={
              (phase.kind === 'idle' && phase.lastTypedName) || suggestedName
            }
            placeholder="My new project"
            onSubmit={(value) => {
              void handleSubmit(value);
            }}
          />
          <Text color={Colors.muted}>
            {Icons.dot} Press Enter to create, Esc to go back.
          </Text>
        </Box>
      )}

      {phase.kind === 'submitting' && (
        <Box flexDirection="column" gap={1}>
          <Box gap={1}>
            <BrailleSpinner color={Colors.accent} />
            <Text color={Colors.body}>
              Creating <Text color={Colors.heading}>{phase.name}</Text>
              {Icons.ellipsis}
            </Text>
          </Box>
          <Text color={Colors.muted}>This usually takes a second or two.</Text>
        </Box>
      )}

      {phase.kind === 'error' && (
        <Box flexDirection="column" gap={1}>
          <Text color={Colors.error}>
            {Icons.warning} {phase.message}
          </Text>
          {phase.code === 'NAME_TAKEN' && (
            <Box flexDirection="column" gap={1}>
              <Text color={Colors.body}>
                That name is already in use. Try a different one.
              </Text>
              <TextInput
                defaultValue={phase.name}
                placeholder="Pick a unique name"
                onSubmit={(value) => {
                  void handleSubmit(value);
                }}
              />
            </Box>
          )}
          {phase.code === 'INVALID_REQUEST' && (
            <Box flexDirection="column" gap={1}>
              <TextInput
                defaultValue={phase.name}
                placeholder="Try a different name"
                onSubmit={(value) => {
                  void handleSubmit(value);
                }}
              />
            </Box>
          )}
          {phase.code === 'QUOTA_REACHED' && (
            <Box flexDirection="column">
              <Text color={Colors.body}>
                You've reached your org's project limit. Create one in the
                Amplitude dashboard, then come back and pick "Start over".
              </Text>
              <Box marginTop={1}>
                <TerminalLink
                  url={OUTBOUND_URLS.projectsSettings(zone, orgId ?? undefined)}
                >
                  Open Amplitude projects settings
                </TerminalLink>
              </Box>
              <Box marginTop={1}>
                <Text color={Colors.muted}>
                  Press O to open in browser, Esc to go back.
                </Text>
              </Box>
              <FallbackKeyHandler onOpen={handleOpenFallback} />
            </Box>
          )}
          {phase.code === 'FORBIDDEN' && (
            <Box flexDirection="column">
              <Text color={Colors.body}>
                You don't have permission to create projects in this org. Ask an
                admin, or pick a different org with "Start over".
              </Text>
              <Box marginTop={1}>
                <Text color={Colors.muted}>Press Esc to go back.</Text>
              </Box>
            </Box>
          )}
          {phase.code === 'INTERNAL' && (
            <Box flexDirection="column" marginTop={1}>
              <Text color={Colors.muted}>
                Press R to retry, O to open the Amplitude dashboard, Esc to
                cancel.
              </Text>
              <FallbackKeyHandler
                onOpen={handleOpenFallback}
                onRetry={handleRetry}
              />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

/**
 * Tiny key-input helper. Kept local to CreateProjectScreen because it only
 * exists to listen for `o` / `r` inside the error branch and we don't want
 * it to steal keystrokes from TextInput in the retry sub-branches.
 */
const FallbackKeyHandler = ({
  onOpen,
  onRetry,
}: {
  onOpen: () => void;
  onRetry?: () => void;
}) => {
  useInput((input) => {
    if (!input) return;
    const ch = input.toLowerCase();
    if (ch === 'o') onOpen();
    if (ch === 'r' && onRetry) onRetry();
  });
  return null;
};
