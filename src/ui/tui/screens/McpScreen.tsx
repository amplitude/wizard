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
import type { McpInstaller, McpClientInfo } from '../services/mcp-installer.js';
import type { ClaudeCodeInstallMode } from '../../../steps/add-mcp-server-to-clients/index.js';
import { CLAUDE_PLUGIN_ENABLED } from '../../../lib/constants.js';
import { analytics, captureWizardError } from '../../../utils/analytics.js';

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
  ChooseClaudeCodeMode = 'chooseClaudeCodeMode',
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
  const [pendingInstallNames, setPendingInstallNames] = useState<string[]>([]);
  const [claudeCodeMode, setClaudeCodeMode] =
    useState<ClaudeCodeInstallMode>('plugin');

  useEffect(() => {
    if (amplitudePreDetectedChoicePending) {
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
          setPhase(Phase.Ask);
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
  }, [installer, amplitudePreDetectedChoicePending]);

  const proceedWithNames = (names: string[]) => {
    if (CLAUDE_PLUGIN_ENABLED && names.includes(CLAUDE_CODE_CLIENT_NAME)) {
      analytics.wizardCapture('MCP Claude Code Mode Picker Shown', {
        clients: names,
      });
      setPendingInstallNames(names);
      setPhase(Phase.ChooseClaudeCodeMode);
      return;
    }
    void doInstall(names, 'mcp');
  };

  const handleConfirm = () => {
    if (isRemove) {
      analytics.wizardCapture('MCP Remove Confirmed');
      void doRemove();
    } else if (clients.length === 1) {
      const names = clients.map((c) => c.name);
      analytics.wizardCapture('MCP Install Confirmed', { clients: names });
      proceedWithNames(names);
    } else {
      analytics.wizardCapture('MCP Client Picker Shown', {
        available_clients: clients.map((c) => c.name),
      });
      setPhase(Phase.Pick);
    }
  };

  const handleSkip = () => {
    analytics.wizardCapture('MCP Skipped', { mode });
    markDone(store, McpOutcome.Skipped, [], standalone, onComplete);
  };

  const doInstall = async (names: string[], ccMode: ClaudeCodeInstallMode) => {
    setClaudeCodeMode(ccMode);
    setPhase(Phase.Working);
    let result: string[] = [];
    try {
      result = await installer.install(names, { claudeCodeMode: ccMode });
      setResultClients(result);
    } catch {
      setResultClients([]);
    }
    const failed = names.filter((n) => !result.includes(n));
    analytics.wizardCapture('MCP Install Complete', {
      installed: result,
      failed,
      attempted: names,
      claude_code_mode: ccMode,
    });
    setPhase(Phase.Done);
    const outcome =
      result.length > 0 ? McpOutcome.Installed : McpOutcome.Failed;
    timerRef.current = setTimeout(
      () => markDone(store, outcome, result, standalone, onComplete),
      2000,
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
      {amplitudePreDetectedChoicePending && !isRemove && (
        <Box marginBottom={1} flexDirection="column">
          <Text color={Colors.secondary}>
            The installer skipped the automated setup step because Amplitude is
            already present. You can continue to editor MCP setup, or run the
            full setup wizard if you want to review or change the integration.
          </Text>
          <Box marginTop={1}>
            <PickerMenu
              message="How would you like to proceed?"
              options={[
                { label: 'Continue to MCP setup', value: 'continue' as const },
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
      {!amplitudePreDetectedChoicePending && (
        <>
          <Text bold color={Colors.accent}>
            MCP Server {isRemove ? 'Removal' : 'Setup'}
          </Text>

          <Box marginTop={1} flexDirection="column">
            {phase === Phase.Detecting && (
              <Text color={Colors.muted}>
                Detecting supported editors{Icons.ellipsis}
              </Text>
            )}

            {phase === Phase.None && (
              <Text color={Colors.muted}>
                No {isRemove ? 'installed' : 'supported'} MCP clients detected.
                Skipping{Icons.ellipsis}
              </Text>
            )}

            {phase === Phase.Ask && (
              <>
                <Text color={Colors.secondary}>
                  Detected: {clients.map((c) => c.name).join(', ')}
                </Text>
                <Box marginTop={1}>
                  <ConfirmationInput
                    message={
                      isRemove
                        ? 'Remove the Amplitude MCP server from your editor?'
                        : 'Install the Amplitude MCP server to your editor?'
                    }
                    confirmLabel={isRemove ? 'Remove MCP' : 'Install MCP'}
                    cancelLabel="No thanks"
                    onConfirm={handleConfirm}
                    onCancel={handleSkip}
                  />
                </Box>
              </>
            )}

            {phase === Phase.Pick && (
              <PickerMenu
                message="Select editor to install MCP server"
                options={clients.map((c) => ({
                  label: c.name,
                  value: c.name,
                }))}
                mode="multi"
                onSelect={(selected) => {
                  const names = Array.isArray(selected) ? selected : [selected];
                  if (names.length === 0) return;
                  analytics.wizardCapture('MCP Clients Selected', {
                    selected_clients: names,
                    available_clients: clients.map((c) => c.name),
                  });
                  proceedWithNames(names);
                }}
              />
            )}

            {phase === Phase.ChooseClaudeCodeMode && (
              <Box flexDirection="column">
                <Text color={Colors.secondary}>
                  Claude Code supports a richer install: the Amplitude plugin
                  bundles the MCP server plus slash commands like{' '}
                  <Text color={Colors.body}>/amplitude:create-chart</Text> and{' '}
                  <Text color={Colors.body}>/amplitude:weekly-brief</Text>.
                </Text>
                <Box marginTop={1}>
                  <PickerMenu
                    message="How would you like to set up Claude Code?"
                    options={[
                      {
                        label:
                          'Amplitude plugin — slash commands + MCP (recommended)',
                        value: 'plugin' as const,
                      },
                      {
                        label: 'MCP server only',
                        value: 'mcp' as const,
                      },
                    ]}
                    onSelect={(value) => {
                      const chosen = (
                        Array.isArray(value) ? value[0] : value
                      ) as ClaudeCodeInstallMode;
                      analytics.wizardCapture('MCP Claude Code Mode Selected', {
                        claude_code_mode: chosen,
                      });
                      void doInstall(pendingInstallNames, chosen);
                    }}
                  />
                </Box>
              </Box>
            )}

            {phase === Phase.Working && (
              <Text color={Colors.active}>
                {isRemove ? 'Removing' : 'Installing'} MCP server
                {Icons.ellipsis}
              </Text>
            )}

            {phase === Phase.Done && (
              <Box flexDirection="column">
                {resultClients.length > 0 ? (
                  <>
                    <Text color={Colors.success} bold>
                      {Icons.checkmark}{' '}
                      {isRemove
                        ? 'MCP server removed from:'
                        : claudeCodeMode === 'plugin' &&
                          resultClients.includes(CLAUDE_CODE_CLIENT_NAME)
                        ? 'Amplitude installed for:'
                        : 'MCP server installed for:'}
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
                  </>
                ) : (
                  <Text color={Colors.muted}>
                    {isRemove ? 'Removal' : 'Installation'} skipped.
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
