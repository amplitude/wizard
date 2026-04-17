/**
 * McpScreen — MCP server install/remove flow (v2).
 *
 * Uses an McpInstaller service (passed via props) instead of
 * importing business logic directly. Testable, no dynamic imports.
 *
 * Supports two modes via the `mode` prop:
 *   - 'install': detect clients -> confirm -> install
 *   - 'remove': detect installed clients -> confirm -> remove
 *
 * When done, calls store.setMcpComplete(). The router resolves to outro.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef } from 'react';
import type { WizardStore } from '../store.js';
import { McpOutcome, RunPhase } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { ConfirmationInput, PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from '../components/BrailleSpinner.js';
import type {
  McpInstaller,
  McpClientInfo,
  McpInstallFailure,
} from '../services/mcp-installer.js';
import type { ClaudeCodeInstallMode } from '../../../steps/add-mcp-server-to-clients/index.js';
import { OUTBOUND_URLS } from '../../../lib/constants.js';
import { analytics, captureWizardError } from '../../../utils/analytics.js';

type ClientStatus = 'pending' | 'working' | 'done' | 'failed';

const CLAUDE_CODE_CLIENT_NAME = 'Claude Code';

export type McpMode = 'install' | 'remove';

interface McpScreenProps {
  store: WizardStore;
  installer: McpInstaller;
  mode?: McpMode;
  /** When true, exit the process after completion instead of routing to outro. */
  standalone?: boolean;
  /** When provided, called on completion instead of setMcpComplete (overlay mode). */
  onComplete?: () => void;
}

enum Phase {
  Detecting = 'detecting',
  Ask = 'ask',
  Pick = 'pick',
  Working = 'working',
  Done = 'done',
  None = 'none',
}

const markDone = (
  store: WizardStore,
  outcome: McpOutcome,
  clients: string[] = [],
  standalone = false,
  onComplete?: () => void,
) => {
  if (onComplete) {
    onComplete();
  } else {
    store.setMcpComplete(outcome, clients);
    if (standalone) {
      process.exit(0);
    }
  }
};

export const McpScreen = ({
  store,
  installer,
  mode = 'install',
  standalone = false,
  onComplete,
}: McpScreenProps) => {
  useWizardStore(store);

  const isRemove = mode === 'remove';
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);
  const { runPhase, amplitudePreDetected, amplitudePreDetectedChoicePending } =
    store.session;
  const dataSetupComplete = runPhase === RunPhase.Completed;

  const [phase, setPhase] = useState<Phase>(Phase.Detecting);
  const [clients, setClients] = useState<McpClientInfo[]>([]);
  const [resultClients, setResultClients] = useState<string[]>([]);
  const [failures, setFailures] = useState<McpInstallFailure[]>([]);
  const [claudeCodeMode, setClaudeCodeMode] =
    useState<ClaudeCodeInstallMode>('plugin');
  /** Per-client progress shown during the Working phase. */
  const [progress, setProgress] = useState<
    Array<{ name: string; status: ClientStatus }>
  >([]);

  // Sentinel values used in the multi-picker to split Claude Code into two
  // mutually-exclusive rows ("plugin" / "MCP server only").
  const CC_PLUGIN_VALUE = '__claude-code:plugin__';
  const CC_MCP_VALUE = '__claude-code:mcp__';

  // When shown as an /mcp slash-command overlay, onComplete is provided and
  // the user explicitly asked for MCP setup. Don't hijack their request with
  // the pre-detected picker (that's meant for the main wizard flow only).
  const isOverlay = onComplete !== undefined;
  const showPreDetectedChoice = amplitudePreDetectedChoicePending && !isOverlay;

  /** True when any escape hatch is forcing raw MCP on Claude Code. */
  const forcedMcpOnly =
    store.session.localMcp || process.env.AMPLITUDE_WIZARD_MCP_ONLY === '1';
  const claudeCodeDetected = clients.some(
    (c) => c.name === CLAUDE_CODE_CLIENT_NAME,
  );
  /** Claude Code should be split into two picker rows when plugin is an option. */
  const splitClaudeCode = !isRemove && claudeCodeDetected && !forcedMcpOnly;

  /**
   * Build the options for the multi-picker. Claude Code gets two rows when
   * it's installable as a plugin, so users can pick their flavor explicitly
   * instead of having to find a hidden `[m]` keybind.
   */
  const buildPickerOptions = (): Array<{ label: string; value: string }> => {
    const options: Array<{ label: string; value: string }> = [];
    for (const c of clients) {
      if (c.name === CLAUDE_CODE_CLIENT_NAME && splitClaudeCode) {
        options.push({
          label: 'Claude Code (Amplitude plugin — slash commands + MCP)',
          value: CC_PLUGIN_VALUE,
        });
        options.push({
          label: 'Claude Code (MCP server only, no slash commands)',
          value: CC_MCP_VALUE,
        });
      } else if (c.name === CLAUDE_CODE_CLIENT_NAME) {
        options.push({ label: 'Claude Code (MCP server)', value: c.name });
      } else {
        options.push({ label: `${c.name} (MCP server)`, value: c.name });
      }
    }
    return options;
  };

  /** Pre-check plugin row for Claude Code + every other tool. */
  const buildDefaultSelected = (): string[] => {
    return clients.map((c) =>
      c.name === CLAUDE_CODE_CLIENT_NAME && splitClaudeCode
        ? CC_PLUGIN_VALUE
        : c.name,
    );
  };

  /**
   * Turn the set of selected sentinels/names into the (names, ccMode)
   * pair the installer needs. If a user somehow checks both Claude Code
   * rows we default to plugin; if neither is checked, Claude Code is
   * silently omitted from the install.
   */
  const resolveSelection = (
    selected: string[],
  ): { names: string[]; ccMode: ClaudeCodeInstallMode } => {
    const wantsPlugin = selected.includes(CC_PLUGIN_VALUE);
    const wantsMcp = selected.includes(CC_MCP_VALUE);
    const others = selected.filter(
      (v) => v !== CC_PLUGIN_VALUE && v !== CC_MCP_VALUE,
    );
    const ccMode: ClaudeCodeInstallMode =
      wantsPlugin || !wantsMcp ? 'plugin' : 'mcp';
    const names =
      wantsPlugin || wantsMcp ? [...others, CLAUDE_CODE_CLIENT_NAME] : others;
    return { names, ccMode };
  };

  useEffect(() => {
    if (showPreDetectedChoice) {
      return;
    }
    void (async () => {
      try {
        const detected = await installer.detectClients();
        if (detected.length === 0) {
          analytics.wizardCapture('MCP No Clients Detected', { mode });
          setPhase(Phase.None);
          timerRef.current = setTimeout(
            () =>
              markDone(store, McpOutcome.NoClients, [], standalone, onComplete),
            1500,
          );
        } else {
          analytics.wizardCapture('MCP Clients Detected', {
            mode,
            clients: detected.map((c) => c.name),
            count: detected.length,
          });
          setClients(detected);
          // Single tool: simple yes/no confirm (nothing meaningful to pick
          // between). 2+ tools: jump straight to the multi-select so users
          // can uncheck anything they don't want in this install.
          setPhase(detected.length === 1 || isRemove ? Phase.Ask : Phase.Pick);
        }
      } catch {
        captureWizardError(
          'MCP Client Detection',
          'Editor client detection failed',
          'McpScreen',
          { mode },
        );
        setPhase(Phase.None);
        timerRef.current = setTimeout(
          () => markDone(store, McpOutcome.Failed, [], standalone, onComplete),
          1500,
        );
      }
    })();
  }, [installer, showPreDetectedChoice]);

  const proceedWithNames = (
    names: string[],
    ccMode: ClaudeCodeInstallMode = 'plugin',
  ) => {
    // Environment escape hatches always win over the user's selection
    // (prod plugin can't talk to localhost, and AMPLITUDE_WIZARD_MCP_ONLY
    // is an explicit opt-out).
    const finalMode: ClaudeCodeInstallMode =
      forcedMcpOnly || !names.includes(CLAUDE_CODE_CLIENT_NAME)
        ? 'mcp'
        : ccMode;
    void doInstall(names, finalMode);
  };

  const handleConfirm = () => {
    if (isRemove) {
      analytics.wizardCapture('MCP Remove Confirmed');
      void doRemove();
      return;
    }
    // Single-tool confirm path only — multi-tool detection routes straight
    // to the Pick phase (see the detection useEffect).
    const names = clients.map((c) => c.name);
    analytics.wizardCapture('MCP Install Confirmed', { clients: names });
    proceedWithNames(names);
  };

  const handleSkip = () => {
    analytics.wizardCapture('MCP Skipped', { mode });
    markDone(store, McpOutcome.Skipped, [], standalone, onComplete);
  };

  const doInstall = async (names: string[], ccMode: ClaudeCodeInstallMode) => {
    setClaudeCodeMode(ccMode);
    setPhase(Phase.Working);
    setProgress(names.map((name) => ({ name, status: 'pending' as const })));
    let installed: string[] = [];
    let installFailures: McpInstallFailure[];
    try {
      const result = await installer.install(names, {
        claudeCodeMode: ccMode,
        onClientStart: (name) => {
          setProgress((prev) =>
            prev.map((p) =>
              p.name === name ? { ...p, status: 'working' } : p,
            ),
          );
        },
        onClientComplete: ({ name, success }) => {
          setProgress((prev) =>
            prev.map((p) =>
              p.name === name
                ? { ...p, status: success ? 'done' : 'failed' }
                : p,
            ),
          );
        },
      });
      installed = result.installed;
      installFailures = result.failures;
    } catch (err) {
      installFailures = names.map((n) => ({
        name: n,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    setResultClients(installed);
    setFailures(installFailures);
    analytics.wizardCapture('MCP Install Complete', {
      installed,
      failed: installFailures.map((f) => f.name),
      attempted: names,
      claude_code_mode: ccMode,
    });
    setPhase(Phase.Done);
    const outcome =
      installed.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    // Every successful install now shows follow-up copy + docs links, and
    // failure rows show stderr. Give readers time; snappy only when there's
    // literally nothing interesting to read.
    const hasExtraCopy = installFailures.length > 0 || installed.length > 0;
    const dwell = hasExtraCopy ? 5000 : 2000;
    timerRef.current = setTimeout(
      () => markDone(store, outcome, installed, standalone, onComplete),
      dwell,
    );
  };

  const doRemove = async () => {
    setPhase(Phase.Working);
    let result: string[] = [];
    try {
      result = await installer.remove();
      setResultClients(result);
    } catch {
      setResultClients([]);
    }
    analytics.wizardCapture('MCP Remove Complete', { removed: result });
    setPhase(Phase.Done);
    const outcome =
      result.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    timerRef.current = setTimeout(
      () => markDone(store, outcome, result, standalone, onComplete),
      2000,
    );
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      {dataSetupComplete && (
        <Box marginBottom={1}>
          <Text color={Colors.success} bold>
            {Icons.checkmark}{' '}
            {amplitudePreDetected
              ? 'Amplitude is already configured in this project!'
              : 'Data setup complete!'}
          </Text>
        </Box>
      )}
      {showPreDetectedChoice && !isRemove && (
        <Box marginBottom={1} flexDirection="column">
          <Text color={Colors.secondary}>
            Amplitude is already set up in this project, so we skipped the
            automated setup step. You can continue and connect Amplitude to your
            AI tools, or run the full setup wizard if you want to review or
            change the integration.
          </Text>
          <Box marginTop={1}>
            <PickerMenu
              message="How would you like to proceed?"
              options={[
                {
                  label: 'Connect Amplitude to AI tools',
                  value: 'continue' as const,
                },
                {
                  label: 'Run setup wizard anyway',
                  value: 'wizard' as const,
                },
              ]}
              onSelect={(value) => {
                const runWizard = value === 'wizard';
                analytics.wizardCapture('Amplitude Pre-Detected Choice', {
                  run_wizard_anyway: runWizard,
                });
                store.resolvePreDetectedChoice(runWizard);
              }}
            />
          </Box>
        </Box>
      )}
      {!showPreDetectedChoice && (
        <>
          <Text bold color={Colors.accent}>
            {isRemove
              ? 'Remove Amplitude from your AI tools'
              : 'Chat with your Amplitude data'}
          </Text>
          {!isRemove && (
            <Text color={Colors.muted}>
              We’ll wire the Amplitude MCP into Claude Code, Cursor, Claude
              Desktop, and other AI tools you have installed. You can then ask
              questions, build charts, and check metrics from chat (e.g. “show
              me yesterday’s signups”).
            </Text>
          )}

          <Box marginTop={1} flexDirection="column">
            {phase === Phase.Detecting && (
              <Text color={Colors.muted}>
                Looking for supported AI tools{Icons.ellipsis}
              </Text>
            )}

            {phase === Phase.None && (
              <Text color={Colors.muted}>
                {isRemove
                  ? 'Amplitude isn’t installed in any detected AI tool. Skipping'
                  : 'No supported AI tools found on this machine. Skipping'}
                {Icons.ellipsis}
              </Text>
            )}

            {phase === Phase.Ask && (
              <>
                <Text color={Colors.secondary}>
                  {isRemove ? 'Found:' : 'We’ll install in:'}
                </Text>
                {clients.map((c, i) => (
                  <Text key={i} color={Colors.body}>
                    {'  '}
                    {Icons.bullet} {c.name}
                  </Text>
                ))}
                <Box marginTop={1}>
                  <ConfirmationInput
                    message={
                      isRemove
                        ? 'Remove Amplitude from these tools?'
                        : 'Connect Amplitude to these tools?'
                    }
                    confirmLabel={isRemove ? 'Remove' : 'Connect'}
                    cancelLabel="Skip for now"
                    onConfirm={handleConfirm}
                    onCancel={handleSkip}
                  />
                </Box>
              </>
            )}

            {phase === Phase.Pick && (
              <>
                <Text color={Colors.secondary}>
                  Everything is pre-selected. Space to uncheck anything you
                  don’t want, then Enter to continue.
                </Text>
                <PickerMenu
                  message="Connect Amplitude to:"
                  options={buildPickerOptions()}
                  mode="multi"
                  defaultSelected={buildDefaultSelected()}
                  onSelect={(selected) => {
                    const raw = Array.isArray(selected) ? selected : [selected];
                    const { names, ccMode } = resolveSelection(raw);
                    analytics.wizardCapture('MCP Clients Selected', {
                      selected_clients: names,
                      available_clients: clients.map((c) => c.name),
                      claude_code_mode: ccMode,
                    });
                    if (names.length === 0) {
                      handleSkip();
                      return;
                    }
                    proceedWithNames(names, ccMode);
                  }}
                />
              </>
            )}

            {phase === Phase.Working && (
              <Box flexDirection="column">
                <Box>
                  <BrailleSpinner color={Colors.active} />
                  <Text color={Colors.active}>
                    {' '}
                    {isRemove ? 'Removing' : 'Installing'} Amplitude
                    {Icons.ellipsis}
                  </Text>
                </Box>
                {progress.length > 0 && (
                  <Box flexDirection="column" marginTop={1}>
                    {progress.map((p, i) => (
                      <Box key={i}>
                        <Text
                          color={
                            p.status === 'done'
                              ? Colors.success
                              : p.status === 'failed'
                              ? Colors.error
                              : p.status === 'working'
                              ? Colors.active
                              : Colors.muted
                          }
                        >
                          {p.status === 'done'
                            ? `  ${Icons.checkmark} `
                            : p.status === 'failed'
                            ? `  ${Icons.cross} `
                            : p.status === 'working'
                            ? '  › '
                            : '  · '}
                          {p.name}
                          {p.name === CLAUDE_CODE_CLIENT_NAME &&
                          claudeCodeMode === 'plugin'
                            ? ' (plugin)'
                            : ''}
                          {p.status === 'working' ? '…' : ''}
                        </Text>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            )}

            {phase === Phase.Done && (
              <Box flexDirection="column">
                {resultClients.length > 0 && (
                  <>
                    <Text color={Colors.success} bold>
                      {Icons.checkmark}{' '}
                      {isRemove
                        ? 'Amplitude removed from:'
                        : 'Amplitude connected to:'}
                    </Text>
                    {resultClients.map((name, i) => (
                      <Text key={i} color={Colors.body}>
                        {' '}
                        {Icons.bullet} {name}
                        {!isRemove &&
                        name === CLAUDE_CODE_CLIENT_NAME &&
                        claudeCodeMode === 'plugin'
                          ? ' (plugin)'
                          : ''}
                      </Text>
                    ))}
                    {!isRemove &&
                      claudeCodeMode === 'plugin' &&
                      resultClients.includes(CLAUDE_CODE_CLIENT_NAME) && (
                        <Box flexDirection="column" marginTop={1}>
                          <Text color={Colors.muted}>
                            Next: open Claude Code and run{' '}
                            <Text color={Colors.body}>/mcp</Text> to sign in,
                            then ask “show me yesterday’s signups”.
                          </Text>
                          <Text color={Colors.muted}>
                            Already have a session open? Run{' '}
                            <Text color={Colors.body}>/reload-plugins</Text>{' '}
                            first to pick up the new slash commands.
                          </Text>
                          <Text color={Colors.muted}>
                            Plugin docs: {OUTBOUND_URLS.claudePluginDocs}
                          </Text>
                          <Text color={Colors.muted}>
                            MCP docs: {OUTBOUND_URLS.mcpDocs}
                          </Text>
                        </Box>
                      )}
                    {!isRemove &&
                      !(
                        claudeCodeMode === 'plugin' &&
                        resultClients.includes(CLAUDE_CODE_CLIENT_NAME)
                      ) && (
                        <Box flexDirection="column" marginTop={1}>
                          <Text color={Colors.muted}>
                            Next: open your AI tool and sign in when prompted,
                            then ask “show me yesterday’s signups”.
                          </Text>
                          <Text color={Colors.muted}>
                            MCP docs: {OUTBOUND_URLS.mcpDocs}
                          </Text>
                        </Box>
                      )}
                  </>
                )}
                {failures.length > 0 && (
                  <Box
                    flexDirection="column"
                    marginTop={resultClients.length > 0 ? 1 : 0}
                  >
                    <Text color={Colors.error} bold>
                      {Icons.cross}{' '}
                      {isRemove
                        ? 'Could not remove from:'
                        : 'Could not connect:'}
                    </Text>
                    {failures.map((f, i) => (
                      <Box key={i} flexDirection="column">
                        <Text color={Colors.body}>
                          {' '}
                          {Icons.bullet} {f.name}
                        </Text>
                        {f.error && (
                          <Text color={Colors.muted}> {f.error}</Text>
                        )}
                      </Box>
                    ))}
                    <Text color={Colors.muted}>
                      Retry any time with `npx @amplitude/wizard mcp`.
                    </Text>
                  </Box>
                )}
                {resultClients.length === 0 && failures.length === 0 && (
                  <Text color={Colors.muted}>
                    {isRemove ? 'Removal' : 'Setup'} skipped.
                  </Text>
                )}
              </Box>
            )}
          </Box>
        </>
      )}
    </Box>
  );
};
