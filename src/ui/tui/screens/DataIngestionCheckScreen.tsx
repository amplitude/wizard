/**
 * DataIngestionCheckScreen — "Start your app and trigger some actions" polling screen.
 *
 * Shown after MCP setup. Polls for events every 30 seconds:
 *   1. MCP query_dataset (Bearer auth, works for all users, detects any track() call)
 *   2. App API activation endpoint (autocapture events only, session-cookie auth)
 *   3. Data-API event catalog (taxonomy events as a proxy)
 *
 * Active guidance as prominent instruction with framework-aware hint.
 * BrailleSpinner while waiting. Success celebration (with event names) when events arrive.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useEscapeBack } from '../hooks/useEscapeBack.js';
import { withTimeout } from '../utils/with-timeout.js';
import {
  extractAppId,
  fetchAmplitudeUser,
  fetchHasAnyEventsMcp,
  fetchProjectActivationStatus,
  fetchProjectEventTypes,
} from '../../../lib/api.js';
import { DEFAULT_AMPLITUDE_ZONE, Integration } from '../../../lib/constants.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import { useResolvedZone } from '../hooks/useResolvedZone.js';
import { FRAMEWORK_REGISTRY } from '../../../lib/registry.js';
import { OutroKind } from '../session-constants.js';
import { logToFile } from '../../../utils/debug.js';
import { detectBoundPort } from '../../../utils/port-detection.js';
import { makeLink } from '../utils/terminal-rendering.js';
import type { KeyHint } from '../components/KeyHintBar.js';

const POLL_INTERVAL_MS = 30_000;
const MAX_EVENTS_SHOWN = 8;
const CELEBRATION_DELAY_MS = 3_000;

// Stable identities so useScreenHints' effect doesn't re-fire every render.
const SKIP_HINT: readonly KeyHint[] = Object.freeze([
  { key: 'q', label: 'Skip for now' },
]);
const NO_HINTS: readonly KeyHint[] = Object.freeze([]);

/**
 * Framework-specific hints. For web frameworks we probe `ports` in order with
 * `lsof` and build the message around the one that's actually bound — so the
 * user sees the URL of their running dev server, not a default we guessed.
 * Native frameworks have no port; `idle` is used verbatim.
 */
interface WebFrameworkHint {
  kind: 'web';
  ports: readonly number[];
  pathSuffix?: string;
  running: (url: string) => ReactNode;
  idle: string;
}
interface NativeFrameworkHint {
  kind: 'native';
  idle: string;
}
type FrameworkHint = WebFrameworkHint | NativeFrameworkHint;

const FRAMEWORK_HINTS: Partial<Record<Integration, FrameworkHint>> = {
  [Integration.nextjs]: {
    kind: 'web',
    ports: [3000, 3001, 3002, 8080],
    running: (url) => <>Visit {url} and click around</>,
    idle: 'Start your dev server, then visit it and click around',
  },
  [Integration.vue]: {
    kind: 'web',
    ports: [5173, 5174, 4173, 3000, 8080],
    running: (url) => <>Visit {url} and interact with your app</>,
    idle: 'Start your dev server, then visit it and interact with your app',
  },
  [Integration.reactRouter]: {
    kind: 'web',
    ports: [3000, 3001, 5173, 8080],
    running: (url) => <>Visit {url} and navigate between pages</>,
    idle: 'Start your dev server, then visit it and navigate between pages',
  },
  [Integration.django]: {
    kind: 'web',
    ports: [8000, 8080, 5000],
    running: (url) => <>Visit {url} and browse a few pages</>,
    idle: 'Start your dev server, then visit it and browse a few pages',
  },
  [Integration.flask]: {
    kind: 'web',
    ports: [5000, 5001, 8000, 8080],
    running: (url) => <>Visit {url} and trigger some requests</>,
    idle: 'Start your dev server, then visit it and trigger some requests',
  },
  [Integration.fastapi]: {
    kind: 'web',
    ports: [8000, 8080, 5000],
    pathSuffix: '/docs',
    running: (url) => <>Visit {url} and try some endpoints</>,
    idle: 'Start your dev server, then visit /docs and try some endpoints',
  },
  [Integration.reactNative]: {
    kind: 'native',
    idle: 'Open your app on a device or emulator and tap around',
  },
  [Integration.swift]: {
    kind: 'native',
    idle: 'Build and run your app, then interact with it',
  },
  [Integration.android]: {
    kind: 'native',
    idle: 'Build and run your app, then interact with it',
  },
  [Integration.flutter]: {
    kind: 'native',
    idle: 'Run your app and navigate through a few screens',
  },
};

/**
 * Frameworks whose runtime is a browser, derived from each framework
 * config's `metadata.targetsBrowser` flag. Used to gate browser-specific
 * coaching tips (Network tab, console) that don't apply to native mobile,
 * server-side, or game-engine runtimes.
 */
const BROWSER_FRAMEWORKS = new Set<Integration>(
  Object.values(FRAMEWORK_REGISTRY)
    .filter((config) => config.metadata.targetsBrowser)
    .map((config) => config.metadata.integration),
);

/**
 * Backend / server-side SDKs. For these integrations the App API
 * activation endpoint is unreliable as a success signal — autocapture is
 * irrelevant and the user has no browser tab to "click around" in. We
 * fall back to the data-API event catalog (taxonomy entries), which is
 * a strong proxy for "ingestion is working" in a backend context where
 * events are typically registered as the SDK initializes.
 *
 * Browser SDKs (nextjs/vue/react-router/javascript_web) intentionally
 * do NOT get this fallback — schema registrations there can predate
 * real ingestion and would falsely celebrate. Mobile / native / game
 * engine integrations are excluded too: the PR's coaching tips are the
 * primary unblock path for them and we don't want to over-trigger.
 */
export const BACKEND_SDK_INTEGRATIONS: ReadonlySet<Integration> = new Set([
  Integration.django,
  Integration.flask,
  Integration.fastapi,
  Integration.go,
  Integration.java,
  Integration.javascriptNode,
  Integration.python,
]);

interface DataIngestionCheckScreenProps {
  store: WizardStore;
}

export const DataIngestionCheckScreen = ({
  store,
}: DataIngestionCheckScreenProps) => {
  useWizardStore(store);

  const { session } = store;
  const { activationLevel } = session;
  const zone = useResolvedZone(session);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Cache a lazily-resolved project ID across poll cycles.
  const resolvedAppIdRef = useRef<string | null>(null);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [eventTypes, setEventTypes] = useState<string[] | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [celebrationReady, setCelebrationReady] = useState(false);
  const [arrivedEvents, setArrivedEvents] = useState<string[]>([]);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [secondsSince, setSecondsSince] = useState(0);
  const [pollingStartTime] = useState(() => Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [detectedPort, setDetectedPort] = useState<number | null>(null);

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
      const { EXPIRY_BUFFER_MS } = await import(
        '../../../utils/token-refresh.js'
      );
      const user = getStoredUser();
      const stored = getStoredToken(user?.id, user?.zone);
      if (!stored || !user) return false;
      // Apply the same 5-minute skew buffer that `tryRefreshToken` uses.
      // Prior to this, the comparison was a raw `now <= expiresAt`, which
      // meant a laptop clock even a few seconds behind would skip refresh
      // and the immediately-following App API call would 401 without retry.
      if (
        !force &&
        new Date(stored.expiresAt).getTime() - Date.now() > EXPIRY_BUFFER_MS
      ) {
        return false;
      }
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

    if (!currentCredentials) {
      setApiUnavailable(true);
      return;
    }
    // Bail early only if we have no way to identify either the project
    // (via numeric Amplitude app ID — required by both the MCP and App
    // API checks below) OR its org (so the lazy-resolution path below
    // can populate one from /user). Without either, nothing can succeed.
    //
    // CRITICAL: do NOT fall back to selectedProjectId. selectedProjectId
    // is a project UUID, not an app ID; passing a UUID where the App API
    // expects a numeric app ID produces a query that never matches a
    // real app and silently returns zero events forever — leaving users
    // on freshly-typed API keys (where credentials.appId === 0) stuck on
    // this screen until the polling cap. (Pre-fix this was the dominant
    // failure mode for manual key entry.)
    if (
      !currentCredentials.appId &&
      !currentSession.selectedAppId &&
      !resolvedAppIdRef.current &&
      !currentSession.selectedOrgId
    ) {
      setApiUnavailable(true);
      return;
    }
    // readDisk: false — region is populated on the session by the time this
    // screen renders (flow is gated on region !== null). Skipping Tier 2/3
    // avoids synchronous readAmpliConfig + getStoredUser disk reads every
    // 30s poll.
    const zone = resolveZone(currentSession, DEFAULT_AMPLITUDE_ZONE, {
      readDisk: false,
    });
    const dataApiToken =
      currentCredentials.idToken ?? currentCredentials.accessToken;

    // Silently refresh if the token has expired before making any API calls.
    await refreshToken();

    // Re-read credentials from the store in case refresh updated them.
    let freshCredentials = store.session.credentials ?? currentCredentials;

    // Step 1: Query via MCP (Bearer auth, works for all users).
    // Uses _all event type so any custom track() calls are detected.
    // Requires the numeric analytics project ID from project.environments[].app.id.
    //
    // selectedAppId may be null if the startup fire-and-forget fetchAmplitudeUser
    // failed (e.g. due to an expired token). Resolve lazily using the now-fresh token.
    //
    // `currentCredentials.appId` is the third source: the `--api-key`
    // + `--app-id` CLI path stamps the numeric app ID directly into
    // credentials and short-circuits OAuth-based resolution, so neither
    // `selectedAppId` nor the lazy `fetchAmplitudeUser` path will populate
    // it. Without this fallback, those users would always hit
    // `setApiUnavailable(true)` despite passing a valid app ID. The
    // bail-out condition above (`!credentials.appId && !selectedAppId
    // && !resolvedAppIdRef.current && !selectedOrgId`) already mirrors
    // this set; keep them in sync so what gets us past the bail-out is
    // the same thing the API call below uses.
    //
    // `credentials.appId` is `AppId | 0` (0 = sentinel for "unknown"),
    // so explicitly check truthiness before stringifying.
    const credentialsAppId = currentCredentials.appId
      ? String(currentCredentials.appId)
      : null;
    let effectiveAppId =
      currentSession.selectedAppId ??
      resolvedAppIdRef.current ??
      credentialsAppId;
    if (!effectiveAppId) {
      const tryResolve = async () => {
        const userInfo = await fetchAmplitudeUser(
          freshCredentials.idToken ?? freshCredentials.accessToken,
          zone,
        );
        // Fall back to the first org if the stored ID doesn't match (stale checkpoint).
        const org = currentSession.selectedOrgId
          ? userInfo.orgs.find((o) => o.id === currentSession.selectedOrgId) ??
            userInfo.orgs[0]
          : userInfo.orgs[0];
        // Fall back to the first project if the stored ID doesn't match.
        const project =
          org && currentSession.selectedProjectId
            ? org.projects.find(
                (p) => p.id === currentSession.selectedProjectId,
              ) ?? org.projects[0]
            : org?.projects[0];

        const restoredFields: Parameters<typeof store.restoreSessionIds>[0] =
          {};
        if (org && !currentSession.selectedOrgId) {
          restoredFields.orgId = org.id;
          restoredFields.orgName = org.name;
          logToFile(`[DataIngestionCheck] lazily set orgId=${org.id}`);
        }
        if (project && !currentSession.selectedProjectId) {
          restoredFields.projectId = project.id;
          restoredFields.projectName = project.name;
          logToFile(`[DataIngestionCheck] lazily set projectId=${project.id}`);
        }

        effectiveAppId = project ? extractAppId(project) : null;
        if (effectiveAppId) {
          resolvedAppIdRef.current = effectiveAppId;
          restoredFields.appId = effectiveAppId;
          logToFile(
            `[DataIngestionCheck] lazily resolved appId=${effectiveAppId}`,
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

    if (effectiveAppId) {
      const result = await fetchHasAnyEventsMcp(
        freshCredentials.accessToken,
        effectiveAppId,
      );
      logToFile(
        `[DataIngestionCheck] MCP check: hasEvents=${result.hasEvents} appId=${effectiveAppId} events=${result.activeEventNames.length}`,
      );
      if (result.hasEvents) {
        setApiUnavailable(false);
        confirmWithCelebration(result.activeEventNames);
        return;
      }
    } else {
      logToFile('[DataIngestionCheck] MCP check skipped: no appId resolved');
    }

    // Step 2: Try activation status via App API (org-scoped, autocapture events only).
    // Both an orgId and a numeric app ID are required — without the app ID,
    // the call would either 400 or, worse, "succeed" against a wrong identifier
    // and silently return zero events (the pre-fix UUID-as-appId failure mode).
    if (!currentSession.selectedOrgId || !effectiveAppId) {
      setApiUnavailable(true);
      return;
    }

    try {
      const status = await fetchProjectActivationStatus({
        accessToken: currentCredentials.accessToken,
        zone,
        appId: effectiveAppId,
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

      // Do NOT treat the event catalog as a success signal for browser /
      // mobile / engine SDKs — it reflects schema registrations, not real
      // ingestion, and would falsely celebrate.
      //
      // Backend SDKs are different: the activation endpoint is autocapture-
      // only, so a Node/Django/Flask/FastAPI/Go/Java/Python user who's
      // ingesting custom events will look like "no events" forever even
      // when their server is firing. The cataloged event types are a
      // reasonable proxy in that case — if any taxonomy entries exist for
      // their workspace, treat that as the success signal so they aren't
      // stuck on this screen until the outer timeout.
      const integration = currentSession.integration;
      if (
        integration &&
        BACKEND_SDK_INTEGRATIONS.has(integration) &&
        currentSession.selectedOrgId &&
        currentSession.selectedProjectId
      ) {
        try {
          const names = await fetchProjectEventTypes(
            dataApiToken,
            zone,
            currentSession.selectedOrgId,
            currentSession.selectedProjectId,
          );
          if (names.length > 0) {
            logToFile(
              `[DataIngestionCheck] backend SDK catalog fallback: ${names.length} event types found, confirming`,
            );
            confirmWithCelebration(names);
            return;
          }
        } catch (catalogErr) {
          logToFile(
            `[DataIngestionCheck] backend SDK catalog fallback errored: ${
              catalogErr instanceof Error
                ? catalogErr.message
                : String(catalogErr)
            }`,
          );
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

      // Fetch cataloged event types as a proxy for "events arrived". Wrap
      // in a 15s timeout so a hanging data-api request can't leave the user
      // staring at "Checking your event catalog…" forever — on timeout we
      // treat the catalog as empty, which still unblocks the screen
      // (Enter/q hints render the moment apiUnavailable=true).
      if (currentSession.selectedOrgId && currentSession.selectedProjectId) {
        withTimeout(
          fetchProjectEventTypes(
            dataApiToken,
            zone,
            currentSession.selectedOrgId,
            currentSession.selectedProjectId,
          ),
          15_000,
          'event catalog fetch',
        )
          .then((names) => {
            setEventTypes(names);
          })
          .catch((catalogErr) => {
            logToFile(
              `[DataIngestionCheck] catalog fetch failed: ${
                catalogErr instanceof Error
                  ? catalogErr.message
                  : String(catalogErr)
              }`,
            );
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

  // Detect a bound dev-server port for web frameworks, then poll every 10s
  // so the hint switches to the live URL as soon as the user starts their app.
  // Only match ports whose listener is running out of the install dir — a
  // raw :3000 scan would also catch unrelated Docker/other-project services.
  useEffect(() => {
    const hint = session.integration
      ? FRAMEWORK_HINTS[session.integration]
      : undefined;
    if (!hint || hint.kind !== 'web') return;
    const installDir = session.installDir;
    let cancelled = false;
    const probe = async () => {
      const port = await detectBoundPort(hint.ports, { cwd: installDir });
      if (!cancelled) setDetectedPort(port);
    };
    void probe();
    const id = setInterval(() => void probe(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session.integration, session.installDir]);

  // Esc → step back to MCP install. q → "I'll come back later" exit.
  // Both are hidden during the celebration phase: at that point the user
  // wants to advance forward, not rewind past a successful run, and an
  // accidental Esc should not undo the agent's work.
  useEscapeBack(store, {
    enabled: !celebrating,
    extraHints: celebrating ? NO_HINTS : SKIP_HINT,
  });

  useScreenInput((_char, key) => {
    // During celebration, wait for Enter to advance
    if (celebrating) {
      if (celebrationReady && key.return) {
        store.setDataIngestionConfirmed();
      }
      return;
    }
    // q → "I'll come back later" exit. Esc is owned by useEscapeBack
    // above (back-nav), keeping the Esc=back convention consistent across
    // the wizard.
    if (_char === 'q') {
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

  // Derive framework-specific hint. For web frameworks, if `lsof` found a
  // bound port we render a clickable URL; otherwise show the idle message.
  const hintConfig = session.integration
    ? FRAMEWORK_HINTS[session.integration]
    : undefined;
  const frameworkHint: ReactNode = (() => {
    if (!hintConfig) return null;
    if (hintConfig.kind === 'native') return hintConfig.idle;
    if (detectedPort === null) return hintConfig.idle;
    const url = `http://localhost:${detectedPort}${
      hintConfig.pathSuffix ?? ''
    }`;
    return hintConfig.running(makeLink(url, url));
  })();

  // Gate browser-specific coaching tips — suppressed for mobile / server /
  // engine frameworks whose runtime has no browser devtools. A Swift /
  // Django / Go user can't "check the Network tab."
  const isBrowserFramework = session.integration
    ? BROWSER_FRAMEWORKS.has(session.integration)
    : false;

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

      {/* 0s restart reminder — suppressed in agent/NDJSON mode where there's
          no human dev server to restart. Phrased conservatively: we don't
          know the user's exact command, so we don't name one. The longer
          explanation is on the status line emitted by agent-runner; this
          on-screen copy is deliberately terse. */}
      {!session.agent && (
        <Box marginTop={1} marginLeft={2}>
          <Text color={Colors.secondary}>
            {Icons.arrowRight} If your dev server or build was already running,
            restart it so the new env values load.
          </Text>
        </Box>
      )}

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

      {/* Progressive coaching tips after extended wait.
          Wording rules: hedged ("look for", "check for", "usually") rather
          than definitive claims. We don't know the cause; we suggest where
          to look. */}
      {!apiUnavailable && !celebrating && elapsedSeconds >= 60 && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text color={Colors.secondary}>
            {Icons.arrowRight} Make sure your dev server is running and
            you&apos;ve clicked around the app
          </Text>
          {elapsedSeconds >= 120 && isBrowserFramework && (
            <Text color={Colors.secondary}>
              {Icons.arrowRight} In browser devtools, check the Network tab for
              requests to{' '}
              {zone === 'eu' ? 'api.eu.amplitude.com' : 'api2.amplitude.com'} —
              a 4xx response or a blocked request usually means the SDK
              isn&apos;t sending
            </Text>
          )}
          {elapsedSeconds >= 180 && isBrowserFramework && (
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Look in the browser console for errors from{' '}
              @amplitude/* — a silent init failure blocks all events
            </Text>
          )}
          {elapsedSeconds >= 120 && !isBrowserFramework && (
            <Text color={Colors.secondary}>
              {Icons.arrowRight} Check your app&apos;s logs for SDK init errors
              or failed network calls to{' '}
              {zone === 'eu' ? 'api.eu.amplitude.com' : 'api2.amplitude.com'} —
              a silent failure there blocks events
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
            Events cataloged in your project:
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
