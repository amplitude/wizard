/**
 * DataIngestionCheckScreen — "Start your app and trigger some actions" polling screen.
 *
 * Shown after MCP setup. Polls for events every 30 seconds:
 *   1. MCP query_dataset (Bearer auth, works for all users, detects any track() call)
 *   2. Thunder activation API (autocapture events only, session-cookie auth)
 *   3. Data-API event catalog (taxonomy events as a proxy)
 *
 * Active guidance as prominent instruction with framework-aware hint.
 * BrailleSpinner while waiting. Success celebration (with event names) when events arrive.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import {
  fetchAmplitudeUser,
  fetchHasAnyEventsMcp,
  fetchProjectActivationStatus,
  fetchWorkspaceEventTypes,
} from '../../../lib/api.js';
import type { AmplitudeZone } from '../../../lib/constants.js';
import { Integration } from '../../../lib/constants.js';
import { OutroKind } from '../session-constants.js';
import { logToFile } from '../../../utils/debug.js';

const POLL_INTERVAL_MS = 30_000;
const MAX_EVENTS_SHOWN = 8;
const CELEBRATION_DELAY_MS = 3_000;

/** Framework-specific hints for what the user should do to generate events. */
const FRAMEWORK_HINTS: Partial<Record<Integration, string>> = {
  [Integration.nextjs]: 'Visit localhost:3000 and click around',
  [Integration.vue]: 'Visit localhost:5173 and interact with your app',
  [Integration.reactRouter]: 'Visit localhost:3000 and navigate between pages',
  [Integration.django]: 'Visit localhost:8000 and browse a few pages',
  [Integration.flask]: 'Visit localhost:5000 and trigger some requests',
  [Integration.fastapi]: 'Visit localhost:8000/docs and try some endpoints',
  [Integration.reactNative]:
    'Open your app on a device or emulator and tap around',
  [Integration.swift]: 'Build and run your app, then interact with it',
  [Integration.android]: 'Build and run your app, then interact with it',
  [Integration.flutter]: 'Run your app and navigate through a few screens',
};

interface DataIngestionCheckScreenProps {
  store: WizardStore;
}

export const DataIngestionCheckScreen = ({
  store,
}: DataIngestionCheckScreenProps) => {
  useWizardStore(store);

  const { session } = store;
  const { activationLevel } = session;
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Cache a lazily-resolved project ID across poll cycles.
  const resolvedProjectIdRef = useRef<string | null>(null);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [eventTypes, setEventTypes] = useState<string[] | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [celebrationReady, setCelebrationReady] = useState(false);
  const [arrivedEvents, setArrivedEvents] = useState<string[]>([]);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [secondsSince, setSecondsSince] = useState(0);
  const [pollingStartTime] = useState(() => Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  /** Confirm ingestion with a celebration, then wait for user to press Enter. */
  function confirmWithCelebration(events?: string[]) {
    if (pollingRef.current !== null) clearInterval(pollingRef.current);
    setCelebrating(true);
    if (events && events.length > 0) setArrivedEvents(events);
    celebrationTimerRef.current = setTimeout(() => {
      setCelebrationReady(true);
    }, CELEBRATION_DELAY_MS);
  }

  /**
   * Silently refresh the OAuth token.
   * Pass force=true to refresh even if the token appears locally valid
   * (e.g. after an auth error — the token may have been server-side revoked).
   */
  async function refreshToken(force = false): Promise<boolean> {
    try {
      const { getStoredToken, getStoredUser, storeToken } = await import(
        '../../../utils/ampli-settings.js'
      );
      const { refreshAccessToken } = await import('../../../utils/oauth.js');
      const user = getStoredUser();
      const stored = getStoredToken(user?.id, user?.zone);
      if (!stored || !user) return false;
      if (!force && new Date() <= new Date(stored.expiresAt)) return false;
      logToFile(`[DataIngestionCheck] refreshing token (force=${force})`);
      const refreshed = await refreshAccessToken(
        stored.refreshToken,
        user.zone,
      );
      storeToken(user, {
        accessToken: refreshed.accessToken,
        idToken: refreshed.idToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      });
      store.updateTokens(refreshed.accessToken, refreshed.idToken);
      logToFile('[DataIngestionCheck] token refreshed successfully');
      return true;
    } catch (err) {
      logToFile(
        `[DataIngestionCheck] token refresh failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  async function checkIngestion() {
    // Read from store.session at call time to avoid stale closures
    const currentSession = store.session;
    const currentCredentials = currentSession.credentials;
    const currentRegion = currentSession.region;

    if (!currentCredentials) {
      setApiUnavailable(true);
      return;
    }
    const appId =
      currentCredentials.projectId || currentSession.selectedWorkspaceId;
    if (!appId) {
      setApiUnavailable(true);
      return;
    }
    const zone = (currentRegion ?? 'us') as AmplitudeZone;
    const dataApiToken =
      currentCredentials.idToken ?? currentCredentials.accessToken;

    // Silently refresh if the token has expired before making any API calls.
    await refreshToken();

    // Re-read credentials from the store in case refresh updated them.
    let freshCredentials = store.session.credentials ?? currentCredentials;

    // Step 1: Query via MCP (Bearer auth, works for all users).
    // Uses _all event type so any custom track() calls are detected.
    // Requires the numeric analytics project ID from workspace.environments[].app.id.
    //
    // selectedProjectId may be null if the startup fire-and-forget fetchAmplitudeUser
    // failed (e.g. due to an expired token). Resolve lazily using the now-fresh token.
    let effectiveProjectId =
      currentSession.selectedProjectId ?? resolvedProjectIdRef.current;
    if (!effectiveProjectId) {
      const tryResolve = async () => {
        const userInfo = await fetchAmplitudeUser(
          freshCredentials.idToken ?? freshCredentials.accessToken,
          zone,
        );
        const org = currentSession.selectedOrgId
          ? userInfo.orgs.find((o) => o.id === currentSession.selectedOrgId)
          : userInfo.orgs[0];
        const ws =
          org && currentSession.selectedWorkspaceId
            ? org.workspaces.find(
                (w) => w.id === currentSession.selectedWorkspaceId,
              )
            : org?.workspaces[0];

        const restoredFields: Parameters<typeof store.restoreSessionIds>[0] =
          {};
        if (org && !currentSession.selectedOrgId) {
          restoredFields.orgId = org.id;
          restoredFields.orgName = org.name;
          logToFile(`[DataIngestionCheck] lazily set orgId=${org.id}`);
        }
        if (ws && !currentSession.selectedWorkspaceId) {
          restoredFields.workspaceId = ws.id;
          restoredFields.workspaceName = ws.name;
          logToFile(`[DataIngestionCheck] lazily set workspaceId=${ws.id}`);
        }

        effectiveProjectId =
          ws?.environments
            ?.slice()
            .sort((a, b) => a.rank - b.rank)
            .find((e) => e.app?.id)?.app?.id ?? null;
        if (effectiveProjectId) {
          resolvedProjectIdRef.current = effectiveProjectId;
          restoredFields.projectId = effectiveProjectId;
          logToFile(
            `[DataIngestionCheck] lazily resolved projectId=${effectiveProjectId}`,
          );
        } else {
          logToFile(
            '[DataIngestionCheck] lazy resolution: no environments with app.id',
          );
        }
        if (Object.keys(restoredFields).length > 0) {
          store.restoreSessionIds(restoredFields);
        }
      };

      try {
        await tryResolve();
      } catch (resolveErr) {
        const msg =
          resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
        logToFile(`[DataIngestionCheck] lazy resolution failed: ${msg}`);
        if (
          msg.toLowerCase().includes('auth') ||
          msg.toLowerCase().includes('401') ||
          msg.toLowerCase().includes('403')
        ) {
          const refreshed = await refreshToken(true);
          if (refreshed) {
            freshCredentials = store.session.credentials ?? freshCredentials;
            try {
              await tryResolve();
            } catch (retryErr) {
              logToFile(
                `[DataIngestionCheck] lazy resolution retry failed: ${
                  retryErr instanceof Error
                    ? retryErr.message
                    : String(retryErr)
                }`,
              );
            }
          }
        }
      }
    }

    if (effectiveProjectId) {
      const result = await fetchHasAnyEventsMcp(
        freshCredentials.accessToken,
        effectiveProjectId,
      );
      logToFile(
        `[DataIngestionCheck] MCP check: hasEvents=${result.hasEvents} projectId=${effectiveProjectId} events=${result.activeEventNames.length}`,
      );
      if (result.hasEvents) {
        confirmWithCelebration(result.activeEventNames);
        return;
      }
    } else {
      logToFile(
        '[DataIngestionCheck] MCP check skipped: no projectId resolved',
      );
    }

    // Step 2: Try activation status via Thunder (org-scoped, autocapture events only).
    if (!currentSession.selectedOrgId) {
      setApiUnavailable(true);
      return;
    }

    try {
      const status = await fetchProjectActivationStatus({
        accessToken: currentCredentials.accessToken,
        zone,
        appId,
        orgId: currentSession.selectedOrgId,
      });
      setLastChecked(Date.now());
      logToFile(
        `[DataIngestionCheck] poll result: hasAnyEvents=${status.hasAnyEvents} hasDetSource=${status.hasDetSource}`,
      );
      if (status.hasAnyEvents) {
        confirmWithCelebration();
        return;
      }

      // Activation API only checks autocapture events. Fall back to the
      // event catalog which includes all event types.
      if (currentSession.selectedOrgId && currentSession.selectedWorkspaceId) {
        const catalogEvents = await fetchWorkspaceEventTypes(
          dataApiToken,
          zone,
          currentSession.selectedOrgId,
          currentSession.selectedWorkspaceId,
        );
        logToFile(
          `[DataIngestionCheck] catalog fallback: ${catalogEvents.length} event types found`,
        );
        if (catalogEvents.length > 0) {
          confirmWithCelebration(catalogEvents);
        }
      }
    } catch (err) {
      logToFile(
        `[DataIngestionCheck] poll error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Clear the polling interval so it stops firing against the failing API
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setApiUnavailable(true);

      // Fetch cataloged event types as a proxy for "events arrived"
      if (currentSession.selectedOrgId && currentSession.selectedWorkspaceId) {
        fetchWorkspaceEventTypes(
          dataApiToken,
          zone,
          currentSession.selectedOrgId,
          currentSession.selectedWorkspaceId,
        )
          .then((names) => {
            setEventTypes(names);
          })
          .catch(() => {
            setEventTypes([]);
          });
      } else {
        setEventTypes([]);
      }
    }
  }

  useEffect(() => {
    // Already fully activated — confirm immediately and skip polling
    if (activationLevel === 'full') {
      store.setDataIngestionConfirmed();
      return;
    }

    void checkIngestion();
    pollingRef.current = setInterval(() => {
      void checkIngestion();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
      }
      if (celebrationTimerRef.current !== null) {
        clearTimeout(celebrationTimerRef.current);
      }
    };
  }, []);

  // Update seconds-since counter and elapsed timer — every 5s to reduce re-renders
  useEffect(() => {
    const id = setInterval(() => {
      if (lastChecked) {
        setSecondsSince(Math.floor((Date.now() - lastChecked) / 1000));
      }
      setElapsedSeconds(Math.floor((Date.now() - pollingStartTime) / 1000));
    }, 5000);
    return () => clearInterval(id);
  }, [lastChecked, pollingStartTime]);

  useScreenInput((_char, key) => {
    // During celebration, wait for Enter to advance
    if (celebrating) {
      if (celebrationReady && key.return) {
        store.setDataIngestionConfirmed();
      }
      return;
    }
    if (key.escape || _char === 'q') {
      if (pollingRef.current !== null) clearInterval(pollingRef.current);
      store.setOutroData({
        kind: OutroKind.Cancel,
        message:
          'Come back once your app is running and sending events. Your SDK is installed — just trigger some actions.',
      });
      return;
    }
    // Manual confirmation when API is unavailable
    if (apiUnavailable && key.return) {
      if (pollingRef.current !== null) clearInterval(pollingRef.current);
      store.setDataIngestionConfirmed();
    }
  });

  // Derive framework-specific hint
  const frameworkHint = session.integration
    ? FRAMEWORK_HINTS[session.integration]
    : undefined;

  const shown = eventTypes?.slice(0, MAX_EVENTS_SHOWN) ?? [];
  const overflow = (eventTypes?.length ?? 0) - MAX_EVENTS_SHOWN;

  // ── Celebration state ──────────────────────────────────────────────────

  if (celebrating) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <Text bold color={Colors.success}>
          {Icons.checkmark} Events detected!
        </Text>
        {arrivedEvents.length > 0 && (
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {arrivedEvents.slice(0, MAX_EVENTS_SHOWN).map((name) => (
              <Text key={name} color={Colors.success}>
                {Icons.diamond} {name}
              </Text>
            ))}
            {arrivedEvents.length > MAX_EVENTS_SHOWN && (
              <Text color={Colors.muted}>
                {Icons.ellipsis} and {arrivedEvents.length - MAX_EVENTS_SHOWN}{' '}
                more
              </Text>
            )}
          </Box>
        )}
        <Box marginTop={1}>
          {celebrationReady ? (
            <Box gap={1}>
              <Text color={Colors.muted}>[</Text>
              <Text color={Colors.body} bold>
                Enter
              </Text>
              <Text color={Colors.muted}>] Continue</Text>
            </Box>
          ) : (
            <Text color={Colors.body}>Verifying{Icons.ellipsis}</Text>
          )}
        </Box>
      </Box>
    );
  }

  // ── Waiting state ──────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      {/* Primary instruction */}
      <Box marginBottom={1}>
        <Text bold color={Colors.heading}>
          Start your app and trigger some user actions
        </Text>
      </Box>

      {/* Framework-specific hint */}
      {frameworkHint && (
        <Box marginBottom={1}>
          <Text color={Colors.accent}>
            {Icons.arrowRight} {frameworkHint}
          </Text>
        </Box>
      )}

      <Text color={Colors.body}>
        Your SDK is installed. Once you interact with your app, events will
        start flowing into Amplitude.
      </Text>

      {/* Spinner / polling indicator */}
      {!apiUnavailable && (
        <Box marginTop={1} gap={1} alignItems="center">
          <BrailleSpinner color={Colors.accent} />
          <Text color={Colors.secondary}>
            Listening for events{Icons.ellipsis}
            {lastChecked && (
              <Text color={Colors.muted}> (checked {secondsSince}s ago)</Text>
            )}
          </Text>
        </Box>
      )}

      {/* Progressive coaching tips after extended wait */}
      {!apiUnavailable && !celebrating && elapsedSeconds >= 60 && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text color={Colors.secondary}>
            {Icons.arrowRight} Make sure your dev server is running
          </Text>
          {elapsedSeconds >= 90 && (
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Try visiting your app and clicking around
            </Text>
          )}
          {elapsedSeconds >= 120 && (
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Check your terminal for errors — the SDK may
              not have initialized
            </Text>
          )}
        </Box>
      )}

      {/* API unavailable: checking catalog */}
      {apiUnavailable && eventTypes === null && (
        <Box marginTop={1} gap={1} alignItems="center">
          <BrailleSpinner color={Colors.accent} />
          <Text color={Colors.secondary}>
            Checking your event catalog{Icons.ellipsis}
          </Text>
        </Box>
      )}

      {/* API unavailable: show cataloged events */}
      {apiUnavailable && eventTypes !== null && eventTypes.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={Colors.secondary}>
            Events cataloged in your workspace:
          </Text>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {shown.map((name) => (
              <Box key={name} gap={1}>
                <Text color={Colors.success}>{Icons.diamond}</Text>
                <Text color={Colors.body}>{name}</Text>
              </Box>
            ))}
            {overflow > 0 && (
              <Text color={Colors.muted}>
                {Icons.ellipsis} and {overflow} more
              </Text>
            )}
          </Box>
        </Box>
      )}

      {/* API unavailable: no events yet */}
      {apiUnavailable && eventTypes !== null && eventTypes.length === 0 && (
        <Box marginTop={1} gap={1} alignItems="center">
          <BrailleSpinner color={Colors.accent} />
          <Text color={Colors.secondary}>
            Waiting for events{Icons.ellipsis}
          </Text>
        </Box>
      )}

      {/* Key hints — unified bracket format */}
      <Box marginTop={2} gap={2}>
        {apiUnavailable && (
          <Box>
            <Text color={Colors.muted}>[</Text>
            <Text color={Colors.body} bold>
              Enter
            </Text>
            <Text color={Colors.muted}>
              ] {eventTypes && eventTypes.length > 0 ? 'Continue' : 'Confirm'}
            </Text>
          </Box>
        )}
        <Box>
          <Text color={Colors.muted}>[</Text>
          <Text color={Colors.body} bold>
            q
          </Text>
          <Text color={Colors.muted}>] Exit and resume later</Text>
        </Box>
      </Box>
    </Box>
  );
};
