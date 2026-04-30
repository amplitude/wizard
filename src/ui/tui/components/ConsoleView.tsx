/**
 * ConsoleView — Full-screen wrapper without outer border.
 *
 * Layout: content area + separator + console input with ❯ prompt.
 * Handles slash commands, AI queries, pending prompts, and error banners.
 * KeyHintBar integrated above the input line.
 */

import { Box, Text, useInput } from 'ink';
import type { ReactNode } from 'react';
import { useState, useEffect, useRef } from 'react';
import { Spinner } from '@inkjs/ui';
import type { WizardStore } from '../store.js';
import { OutroKind } from '../session-constants.js';
import { SlashCommandInput } from '../primitives/index.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons, Layout } from '../styles.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { linkify, renderMarkdown } from '../utils/terminal-rendering.js';
import { Overlay } from '../router.js';
import {
  queryConsole,
  resolveConsoleCredentials,
  buildSessionContext,
  type ConversationTurn,
} from '../../../lib/console-query.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import { getLogFile, getRunDir } from '../../../utils/storage-paths.js';
import {
  COMMANDS,
  checkCommandBlockedByRun,
  getWhoamiText,
  getDiagnosticsText,
  isKnownCommand,
  parseFeedbackSlashInput,
  parseCreateProjectSlashInput,
} from '../console-commands.js';
import { analytics } from '../../../utils/analytics.js';
import { trackWizardFeedback } from '../../../utils/track-wizard-feedback.js';
import { collectDiagnostics } from '../../../lib/diagnostics-collector.js';
import { KeyHintBar, type KeyHint } from './KeyHintBar.js';
import { useScreenHintsValue } from '../hooks/useScreenHints.js';

async function submitFeedbackWithConsent(
  message: string,
  store: WizardStore,
): Promise<void> {
  try {
    const includeDiagnostics = await store.promptConfirm(
      'Share diagnostics about your framework and OS to help us improve?',
    );
    analytics.wizardCapture('feedback diagnostics consent', {
      consented: includeDiagnostics,
    });
    const diagnostics = includeDiagnostics
      ? await collectDiagnostics({
          session: store.session,
          wizardVersion: store.version,
          detectedFrameworks: store.session.detectionResults ?? undefined,
        }).catch((err: unknown) => {
          analytics.wizardCapture('feedback diagnostics failed', {
            'error message': err instanceof Error ? err.message : String(err),
          });
          return undefined;
        })
      : undefined;
    await trackWizardFeedback(message, diagnostics);
    store.setCommandFeedback(
      diagnostics
        ? 'Thanks — your feedback and diagnostics were sent.'
        : 'Thanks — your feedback was sent.',
    );
  } catch (err: unknown) {
    store.setCommandFeedback(
      `Could not send feedback: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function executeCommand(raw: string, store: WizardStore): string | void {
  const [cmd] = raw.trim().split(/\s+/);

  // Guard: commands flagged `requiresIdle` would mutate session credentials,
  // region, or org/project selection out from under an in-flight agent run.
  // Surface a tailored message and bail before dispatching.
  if (cmd) {
    const blockedMessage = checkCommandBlockedByRun(
      cmd,
      store.session.runPhase,
    );
    if (blockedMessage) {
      store.setCommandFeedback(blockedMessage, 6000);
      return;
    }
  }

  switch (cmd) {
    case '/region':
      store.setRegionForced();
      break;
    case '/login':
      store.showLoginOverlay();
      break;
    case '/logout':
      store.showLogoutOverlay();
      break;
    case '/whoami':
      // Show current data immediately, then refresh from API
      store.setCommandFeedback(getWhoamiText(store.session), 30_000);
      if (store.session.credentials?.idToken) {
        // readDisk: true — /whoami may fire at any point in the session,
        // including before RegionSelect is reached.
        const zone = resolveZone(store.session, DEFAULT_AMPLITUDE_ZONE, {
          readDisk: true,
        });
        void import('../../../lib/api.js').then(({ fetchAmplitudeUser }) => {
          fetchAmplitudeUser(store.session.credentials!.idToken!, zone)
            .then((userInfo) => {
              if (userInfo.email) {
                store.session.userEmail = userInfo.email;
                analytics.setDistinctId(userInfo.email);
                analytics.identifyUser({
                  email: userInfo.email,
                  org_id: store.session.selectedOrgId ?? undefined,
                  org_name: store.session.selectedOrgName ?? undefined,
                  project_id: store.session.selectedProjectId ?? undefined,
                  project_name: store.session.selectedProjectName ?? undefined,
                  app_id: store.session.selectedAppId,
                  env_name: store.session.selectedEnvName,
                  region: zone,
                  integration: store.session.integration,
                });
              }
              const orgId = store.session.selectedOrgId;
              if (orgId) {
                const org = userInfo.orgs.find((o) => o.id === orgId);
                if (org) store.session.selectedOrgName = org.name;
              }
              store.setCommandFeedback(getWhoamiText(store.session), 30_000);
            })
            .catch(() => {
              // Non-fatal — keep showing what we have
            });
        });
      }
      break;
    case '/slack':
      store.showSlackOverlay();
      break;
    case '/feedback': {
      const message = parseFeedbackSlashInput(raw);
      if (!message) {
        store.setCommandFeedback('Usage: /feedback <your message>');
        break;
      }
      void submitFeedbackWithConsent(message, store);
      break;
    }
    case '/mcp':
      store.showMcpOverlay();
      break;
    case '/create-project': {
      // Requires an authenticated session with a selected org so the proxy
      // call has an orgId. Surface a friendly message otherwise.
      const hasAuth = Boolean(
        store.session.pendingAuthIdToken || store.session.credentials?.idToken,
      );
      const hasOrg = Boolean(store.session.selectedOrgId);
      if (!hasAuth) {
        store.setCommandFeedback(
          'Sign in first (/login) before creating a project.',
        );
        break;
      }
      if (!hasOrg) {
        store.setCommandFeedback(
          'Pick an organization first (the Auth screen) before creating a project.',
        );
        break;
      }
      const suggested = parseCreateProjectSlashInput(raw);
      store.startCreateProject('slash', suggested || null);
      break;
    }
    case '/snake':
      store.showSnakeOverlay();
      break;
    case '/debug': {
      // Write a redacted diagnostic snapshot to a file the user can read
      // AFTER the wizard exits. Earlier versions wrote to stderr while
      // Ink owned the terminal — Ink's diff-based redraw doesn't account
      // for stderr writes, so the JSON either got painted over or
      // interleaved with the live frame. The file approach is boring,
      // robust, and gives the user something they can copy directly into
      // a bug report.
      void import('../utils/diagnostics.js')
        .then(async ({ createDiagnosticSnapshot }) => {
          const snapshot = createDiagnosticSnapshot(
            store,
            store.version || 'unknown',
          ) as {
            current_screen?: string | null;
            active_flow?: string | null;
            session?: {
              integration?: string | null;
              region?: string | null;
            };
            tasks_count?: number;
          };
          const summary =
            `flow: ${snapshot.active_flow ?? 'n/a'} | screen: ${
              snapshot.current_screen ?? 'n/a'
            } | ` +
            `integration: ${snapshot.session?.integration ?? 'n/a'} | ` +
            `zone: ${snapshot.session?.region ?? 'n/a'} | tasks: ${
              snapshot.tasks_count ?? 0
            }`;
          try {
            const fs = await import('node:fs');
            const path = await import('node:path');
            const runDir = getRunDir(store.session.installDir);
            fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
            const snapshotPath = path.join(runDir, 'debug-snapshot.json');
            fs.writeFileSync(
              snapshotPath,
              JSON.stringify(snapshot, null, 2),
              'utf8',
            );
            store.setCommandFeedback(
              `${summary} · saved to ${snapshotPath}`,
              30_000,
            );
          } catch {
            // Filesystem write failed (read-only fs, permissions, etc.)
            // — fall back to surfacing the summary alone. Don't write to
            // stderr; corrupting the TUI mid-render is the original bug.
            store.setCommandFeedback(
              `${summary} · (could not save full snapshot to disk)`,
              30_000,
            );
          }
        })
        .catch(() => {
          // Surface the actual per-project log path. Two parallel runs land
          // their logs in different directories — pointing at /tmp here
          // would send users to the wrong (or shared) file.
          store.setCommandFeedback(
            `Diagnostics unavailable. See ${getLogFile(
              store.session.installDir,
            )}.`,
          );
        });
      break;
    }
    case '/diagnostics': {
      // Print the wizard's storage layout to a file so the user can read
      // it AFTER the wizard exits. Same rationale as /debug: writing to
      // stderr while Ink owns the terminal corrupts the live frame.
      const text = getDiagnosticsText(store.session.installDir);
      void (async () => {
        try {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const runDir = getRunDir(store.session.installDir);
          fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
          const diagPath = path.join(runDir, 'diagnostics.txt');
          fs.writeFileSync(diagPath, text + '\n', 'utf8');
          store.setCommandFeedback(
            `Storage paths saved to ${diagPath} · log file: ${getLogFile(
              store.session.installDir,
            )}`,
            30_000,
          );
        } catch {
          store.setCommandFeedback(
            `Could not write diagnostics file. Log file: ${getLogFile(
              store.session.installDir,
            )}`,
            30_000,
          );
        }
      })();
      break;
    }
    case '/exit':
      store.setOutroData({ kind: OutroKind.Cancel, message: 'Exited.' });
      break;
    default:
      if (cmd)
        store.setCommandFeedback(
          `Unknown command: ${cmd}. Type / to see available commands.`,
        );
  }
}

interface ConsoleViewProps {
  store: WizardStore;
  width: number;
  height: number;
  /** Extra key hints from the active screen. */
  screenHints?: KeyHint[];
  children?: ReactNode;
}

export const ConsoleView = ({
  store,
  width,
  height,
  screenHints,
  children,
}: ConsoleViewProps) => {
  // Per-screen hints registered via useScreenHints() take precedence over
  // the legacy `screenHints` prop (still accepted for back-compat).
  const registeredHints = useScreenHintsValue();
  const effectiveHints =
    registeredHints.length > 0 ? registeredHints : screenHints;
  const [inputActive, setInputActive] = useState(false);
  const [initialValue, setInitialValue] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  // Conversation Q&A turns. Rendered inline in the live region (above the
  // separator/input) so answers stay visible inside the TUI. We previously
  // used Ink's <Static>, but in a full-screen Ink app those entries get
  // pushed above the rendered region into terminal scrollback the user can't
  // easily reach.
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  // Local "dismissed" flag so the user can hide the Q&A panel without
  // wiping history. Auto-resets when a new turn arrives so a fresh answer
  // is always visible.
  const [qaDismissed, setQaDismissed] = useState(false);
  const prevHistoryLengthRef = useRef(0);
  useEffect(() => {
    if (history.length > prevHistoryLengthRef.current) {
      setQaDismissed(false);
    }
    prevHistoryLengthRef.current = history.length;
  }, [history.length]);

  // Event plan prompt local state
  const [planInputMode, setPlanInputMode] = useState<'options' | 'feedback'>(
    'options',
  );
  const [planFeedbackText, setPlanFeedbackText] = useState('');
  const [planCursorVisible, setPlanCursorVisible] = useState(true);

  useWizardStore(store);

  const activate = (seed = '') => {
    setInitialValue(seed);
    setInputKey((k) => k + 1);
    setInputActive(true);
    store.setCommandMode(true);
  };

  const deactivate = () => {
    setInputActive(false);
    store.setCommandMode(false);
  };

  const feedback = store.commandFeedback;
  const screenError = store.screenError;
  const showFeedback = !loading && !!feedback;
  const innerWidth = width;
  const separator = Layout.separatorChar.repeat(Math.max(0, innerWidth - 2));
  const pendingPrompt = store.pendingPrompt;

  const showConsoleChrome = store.session.introConcluded;

  // Watch for activation keys while the input is dormant.
  //
  // The event-plan feedback box has its own text-input handler below; if we
  // also activated the slash console on `/` while the user is typing
  // free-text feedback, every "/" mid-sentence would pop the command palette
  // (e.g. "press / for help" or "use the doc/text together" would trigger
  // it). Skip activation when the event-plan feedback prompt is the active
  // text-entry surface so its own handler can take the keystroke verbatim.
  const eventPlanFeedbackActive =
    !!pendingPrompt &&
    pendingPrompt.kind === 'event-plan' &&
    planInputMode === 'feedback';

  useInput(
    (char, key) => {
      if (key.escape || char === 'q' || char === 'Q') {
        if (pendingPrompt && pendingPrompt.kind !== 'event-plan') {
          store.resolvePrompt(pendingPrompt.kind === 'confirm' ? false : '');
          return;
        }
        // Esc with no pending prompt dismisses the Q&A panel so it stops
        // hogging vertical space. History is preserved — a new question or
        // /clear will resurface it.
        //
        // The `!pendingPrompt` guard is critical: an event-plan prompt
        // falls through the previous `if` (kind === 'event-plan') AND has
        // its own useInput handler below that also fires on Esc. Without
        // this guard, Esc during an event-plan prompt would dismiss the
        // Q&A panel as a side effect of exiting the prompt feedback. The
        // comment above documented the intent; this restores it.
        if (
          key.escape &&
          !pendingPrompt &&
          history.length > 0 &&
          !qaDismissed
        ) {
          setQaDismissed(true);
          return;
        }
      }
      if (screenError && (char === 'r' || char === 'R')) {
        store.clearScreenError();
        return;
      }
      if (!showConsoleChrome) return;
      if (char === '/') {
        activate('/');
      } else if (
        key.tab &&
        store.session.credentials !== null &&
        store.session.introConcluded
      ) {
        activate('');
      }
    },
    { isActive: !inputActive && !eventPlanFeedbackActive },
  );

  const handleSubmit = (value: string) => {
    const isSlashCommand = isKnownCommand(value);
    analytics.wizardCapture('agent message sent', {
      'message length': value.length,
      'is slash command': isSlashCommand,
    });
    if (isSlashCommand) {
      // /clear is owned by ConsoleView (it lives in component state, not the
      // store), so handle it here before delegating to executeCommand.
      const cmd = value.trim().split(/\s+/)[0];
      if (cmd === '/clear') {
        setHistory([]);
        setQaDismissed(false);
        store.setCommandFeedback('Conversation cleared.');
        return;
      }
      const query = executeCommand(value, store);
      if (query) {
        handleSubmit(query);
      }
      return;
    }

    setLoading(true);
    const creds = resolveConsoleCredentials(store.session);
    const context = buildSessionContext(store.session);

    // Pass at most the last 8 turns to the model for context (token budget).
    // The local `history` state keeps the full conversation; only the most
    // recent turns are rendered inline (see visibleHistory below).
    const modelHistory = history.slice(-8);

    queryConsole(value, context, creds, modelHistory)
      .then((text) => {
        setHistory((h) => [
          ...h,
          { role: 'user', content: value },
          { role: 'assistant', content: text },
        ]);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setHistory((h) => [
          ...h,
          { role: 'user', content: value },
          { role: 'assistant', content: `Error: ${msg}` },
        ]);
      })
      .finally(() => setLoading(false));
  };

  // Blinking cursor for event-plan feedback input
  useEffect(() => {
    if (planInputMode !== 'feedback') return;
    const id = setInterval(() => setPlanCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [planInputMode]);

  // Reset plan input state when the prompt clears
  useEffect(() => {
    if (!pendingPrompt) {
      setPlanInputMode('options');
      setPlanFeedbackText('');
    }
  }, [pendingPrompt]);

  // Keyboard handling for event-plan prompt
  useInput(
    (char, key) => {
      if (!pendingPrompt || pendingPrompt.kind !== 'event-plan') return;

      if (planInputMode === 'feedback') {
        if (key.return) {
          const text = planFeedbackText.trim();
          if (text) {
            store.resolveEventPlan({ decision: 'revised', feedback: text });
            setPlanFeedbackText('');
            setPlanInputMode('options');
          }
          return;
        }
        if (key.escape) {
          setPlanInputMode('options');
          setPlanFeedbackText('');
          return;
        }
        if (key.backspace || key.delete) {
          setPlanFeedbackText((v) => v.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && !key.tab && char) {
          setPlanFeedbackText((v) => v + char);
        }
        return;
      }

      // options mode — require explicit Y to approve (Enter alone is too easy
      // to hit accidentally while the plan is pending in the background)
      const lc = char.toLowerCase();
      if (lc === 'y') {
        store.resolveEventPlan({ decision: 'approved' });
      } else if (lc === 's') {
        store.resolveEventPlan({ decision: 'skipped' });
      } else if (lc === 'f') {
        setPlanInputMode('feedback');
      }
    },
    {
      isActive:
        !inputActive && !!pendingPrompt && pendingPrompt.kind === 'event-plan',
    },
  );

  // Show the latest status message when an overlay is active
  const overlayValues: string[] = Object.values(Overlay);
  const isOverlay = overlayValues.includes(store.currentScreen);
  const lastStatus =
    isOverlay && store.statusMessages.length > 0
      ? store.statusMessages[store.statusMessages.length - 1]
      : null;

  // Show only the most recent turn pair (1 user + 1 assistant). Older turns
  // would otherwise stack vertically and push the actual screen content
  // (Tasks, Progress, etc.) off-frame. Use /clear to wipe history entirely
  // or Esc to temporarily hide the panel.
  const visibleHistory = qaDismissed ? [] : history.slice(-2);

  return (
    <Box width={width} height={height} flexDirection="column">
      {/* Content area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {pendingPrompt ? (
          <Box
            flexDirection="column"
            flexGrow={1}
            paddingX={Layout.paddingX}
            paddingY={1}
          >
            {pendingPrompt.kind === 'confirm' ? (
              <PickerMenu
                message={pendingPrompt.message}
                options={[
                  { label: 'Yes', value: 'yes' },
                  { label: 'No', value: 'no' },
                ]}
                onSelect={(v) => store.resolvePrompt(v === 'yes')}
              />
            ) : pendingPrompt.kind === 'choice' ? (
              <PickerMenu
                message={pendingPrompt.message}
                options={pendingPrompt.options.map((o) => ({
                  label: o,
                  value: o,
                }))}
                onSelect={(v) => store.resolvePrompt(v as string)}
              />
            ) : (
              <Box flexDirection="column" gap={1}>
                <Text color={Colors.muted}>Suggested events for your app:</Text>
                <Text color={Colors.heading} bold>
                  Instrumentation Plan
                </Text>
                {pendingPrompt.events.map((e, i) => (
                  <Text key={e.name || i} wrap="wrap">
                    <Text color={Colors.accent} bold>
                      {Icons.bullet} {e.name}
                    </Text>
                    {e.description ? (
                      <Text color={Colors.secondary}> — {e.description}</Text>
                    ) : null}
                  </Text>
                ))}
                {planInputMode === 'feedback' ? (
                  <Box gap={1}>
                    <Text color={Colors.muted}>Feedback: </Text>
                    <Text>
                      {planFeedbackText}
                      {planCursorVisible ? '▎' : ' '}
                    </Text>
                    <Text color={Colors.muted}>[Enter] send [Esc] cancel</Text>
                  </Box>
                ) : (
                  <Text color={Colors.muted}>
                    [Y] approve [S] skip [F] give feedback
                  </Text>
                )}
              </Box>
            )}
            {pendingPrompt.kind !== 'event-plan' && (
              <Text color={Colors.muted}> [Q / Esc] skip</Text>
            )}
          </Box>
        ) : (
          children
        )}
      </Box>

      {/* Status ticker — shown when an overlay is active */}
      {lastStatus && (
        <Box paddingX={Layout.paddingX} overflow="hidden">
          <Text color={Colors.subtle}>{Icons.diamondOpen} </Text>
          <Text color={Colors.muted} wrap="truncate-end">
            {linkify(lastStatus)}
          </Text>
        </Box>
      )}

      {/* Error banner */}
      {screenError && (
        <Box paddingX={Layout.paddingX} gap={1}>
          <Text color={Colors.error} bold>
            {Icons.cross}
          </Text>
          <Box flexGrow={1} overflow="hidden">
            <Text color={Colors.error} wrap="truncate-end">
              {screenError.message}
            </Text>
          </Box>
          <Text color={Colors.muted}>[R] retry</Text>
        </Box>
      )}

      {/* Q&A history — rendered inline in the live region so answers stay
        visible. (Previously rendered via <Static>, which pushed content above
        the visible TUI in fullscreen mode.)
        Capped to the most recent turn pair; flexShrink + overflow="hidden"
        let the panel give back rows when the rest of the chrome needs them
        so long answers can't crowd out the screen content above. */}
      {visibleHistory.length > 0 && (
        <Box
          flexDirection="column"
          paddingX={Layout.paddingX}
          flexShrink={1}
          overflow="hidden"
        >
          {history.length > visibleHistory.length && (
            <Text color={Colors.subtle}>
              … {history.length - visibleHistory.length} earlier message
              {history.length - visibleHistory.length === 1 ? '' : 's'} hidden —
              /clear to wipe
            </Text>
          )}
          {visibleHistory.map((turn, idx) =>
            turn.role === 'user' ? (
              <Box key={`turn-${history.length - visibleHistory.length + idx}`}>
                <Text color={Colors.muted}>{Icons.prompt} </Text>
                <Text color={Colors.secondary}>{turn.content}</Text>
              </Box>
            ) : (
              <Box
                key={`turn-${history.length - visibleHistory.length + idx}`}
                paddingY={1}
                flexDirection="column"
              >
                {/* No `color` prop here — `renderMarkdown` returns ANSI-styled
                  text with its own resets. Wrapping it in a parent color
                  causes Ink to re-emit the parent color at every wrap point,
                  bleeding blue into wrapped continuation lines (e.g. "time
                  as it runs." showing up blue after "...in real" wraps). */}
                <Text>{renderMarkdown(turn.content).trimEnd()}</Text>
              </Box>
            ),
          )}
        </Box>
      )}

      {/* Separator */}
      <Box paddingX={1}>
        <Text color={Colors.border}>{separator}</Text>
      </Box>

      {/* Feedback line */}
      {showFeedback && (
        <Box paddingX={Layout.paddingX}>
          <Text color={Colors.accent}>{Icons.prompt} </Text>
          <Text color={Colors.secondary}>{feedback}</Text>
        </Box>
      )}

      {/* Loading spinner — shown only while a query is in flight. Completed
        turns are rendered inline above the separator. */}
      {loading && (
        <Box paddingX={Layout.paddingX}>
          <Spinner />
        </Box>
      )}

      {/* Key hints + console input — hidden on Intro to keep focus on the
          framework picker. Render a fixed-height placeholder so the content
          area doesn't jump when Continue transitions to the next screen. */}
      {showConsoleChrome ? (
        <>
          <KeyHintBar
            hints={effectiveHints as KeyHint[] | undefined}
            width={innerWidth}
            showAskHint={
              store.session.credentials !== null && store.session.introConcluded
            }
          />
          <Box paddingX={Layout.paddingX}>
            <Text color={inputActive ? Colors.accent : Colors.muted}>
              {Icons.prompt}{' '}
            </Text>
            {inputActive ? (
              <SlashCommandInput
                key={inputKey}
                commands={COMMANDS}
                isActive={inputActive}
                initialValue={initialValue}
                onSubmit={handleSubmit}
                onDeactivate={deactivate}
              />
            ) : (
              <Text color={Colors.disabled}>
                {store.session.credentials !== null &&
                store.session.introConcluded
                  ? visibleHistory.length > 0
                    ? 'Press / for commands · Tab to ask · Esc to hide answer'
                    : 'Press / for commands or Tab to ask a question'
                  : 'Press / for commands'}
              </Text>
            )}
          </Box>
        </>
      ) : (
        <Box height={2} />
      )}
    </Box>
  );
};
