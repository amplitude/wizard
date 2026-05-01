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
import type { McpInstaller, McpClientInfo } from '../services/mcp-installer.js';
import { analytics, captureWizardError } from '../../../utils/analytics.js';
import { wizardSuccessExit } from '../../../utils/wizard-abort.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';

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
      // Standalone /mcp slash-command run — route through
      // wizardSuccessExit so the 'MCP Install Complete' /
      // 'MCP No Clients Detected' analytics events fired moments
      // earlier flush before the process tears down. A bare
      // process.exit(0) here drops the trailing telemetry.
      void wizardSuccessExit(0);
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

  // When shown as an /mcp slash-command overlay, onComplete is provided and
  // the user explicitly asked for MCP setup. Don't hijack their request with
  // the pre-detected picker (that's meant for the main wizard flow only).
  const isOverlay = onComplete !== undefined;
  const showPreDetectedChoice = amplitudePreDetectedChoicePending && !isOverlay;

  const [phase, setPhase] = useState<Phase>(Phase.Detecting);
  const [clients, setClients] = useState<McpClientInfo[]>([]);
  const [resultClients, setResultClients] = useState<string[]>([]);

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
  }, [installer, showPreDetectedChoice]);

  const handleConfirm = () => {
    if (isRemove) {
      analytics.wizardCapture('MCP Remove Confirmed');
      void doRemove();
    } else if (clients.length === 1) {
      const names = clients.map((c) => c.name);
      analytics.wizardCapture('MCP Install Confirmed', { clients: names });
      void doInstall(names);
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

  const doInstall = async (names: string[]) => {
    setPhase(Phase.Working);
    let result: string[] = [];
    try {
      // readDisk: false — McpScreen runs after RegionSelect + Auth, so the
      // session region is the authoritative tier-1 source. The zone gets
      // baked into the URL written to each editor's MCP config and persists
      // past the wizard run; an EU user installing here without this would
      // be stuck talking to mcp.amplitude.com (US) forever.
      const zone = resolveZone(store.session, DEFAULT_AMPLITUDE_ZONE, {
        readDisk: false,
      });
      result = await installer.install(names, zone);
      setResultClients(result);
    } catch {
      setResultClients([]);
    }
    const failed = names.filter((n) => !result.includes(n));
    analytics.wizardCapture('MCP Install Complete', {
      installed: result,
      failed,
      attempted: names,
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
      {showPreDetectedChoice && !isRemove && (
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
      {!showPreDetectedChoice && (
        <>
          <Text bold color={Colors.accent}>
            {isRemove
              ? 'Remove Amplitude from your AI tools'
              : '💬 Chat with your Amplitude data'}
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
              <Box>
                <BrailleSpinner color={Colors.muted} />
                <Text color={Colors.muted}>
                  {' '}
                  Looking for supported AI tools{Icons.ellipsis}
                </Text>
              </Box>
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
              <>
                <Text color={Colors.secondary}>
                  Everything is pre-selected. Space to uncheck anything you
                  don’t want, then Enter to continue.
                </Text>
                <PickerMenu
                  message="Select AI tool to install MCP server"
                  options={clients.map((c) => ({
                    label: c.name,
                    value: c.name,
                  }))}
                  mode="multi"
                  defaultSelected={clients.map((c) => c.name)}
                  onSelect={(selected) => {
                    const names = Array.isArray(selected)
                      ? selected
                      : [selected];
                    if (names.length === 0) {
                      handleSkip();
                      return;
                    }
                    analytics.wizardCapture('MCP Clients Selected', {
                      selected_clients: names,
                      available_clients: clients.map((c) => c.name),
                    });
                    void doInstall(names);
                  }}
                />
              </>
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
                      {Icons.checkmark} MCP server{' '}
                      {isRemove ? 'removed from' : 'installed for'}:
                    </Text>
                    {resultClients.map((name, i) => (
                      <Text key={i} color={Colors.body}>
                        {' '}
                        {Icons.bullet} {name}
                      </Text>
                    ))}
                    {!isRemove && (
                      <Box flexDirection="column" marginTop={1}>
                        <Text color={Colors.muted}>
                          Next: open{' '}
                          {resultClients.length === 1
                            ? resultClients[0]
                            : 'any of the above'}
                          , sign in when prompted, then ask “show me yesterday’s
                          signups”.
                        </Text>
                      </Box>
                    )}
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
