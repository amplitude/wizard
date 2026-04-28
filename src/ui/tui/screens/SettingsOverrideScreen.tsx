/**
 * SettingsOverrideScreen — Modal when .claude/settings.json contains env overrides
 * that block the Wizard from reaching the Amplitude LLM Gateway (v2).
 *
 * Two phases:
 *
 *   1. Initial: show the conflicting keys + ask to back up & continue.
 *   2. Backup-failed: show the FILE PATH and the conflicting keys, drop
 *      the (broken) Confirm action, and offer [O]pen-in-$EDITOR + [Esc]
 *      so the user can manually edit and re-run the wizard. This is the
 *      anti-dead-end branch — pressing Confirm again would do the exact
 *      same failing thing.
 */

import { Box, Text, useInput } from 'ink';
import path from 'path';
import { spawn } from 'child_process';
import { useState } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { ConfirmationInput } from '../primitives/index.js';
import { Colors, Icons, Layout } from '../styles.js';
import { wizardAbort } from '../../../utils/wizard-abort.js';

interface SettingsOverrideScreenProps {
  store: WizardStore;
}

export const SettingsOverrideScreen = ({
  store,
}: SettingsOverrideScreenProps) => {
  useWizardStore(store);

  const [feedback, setFeedback] = useState<string | null>(null);
  const keys = store.session.settingsOverrideKeys;
  const installDir = store.session.installDir;

  if (!keys || keys.length === 0) {
    return null;
  }

  // The agent-side backup helper tries `settings.json` first then `settings`,
  // and the screen has no way of knowing which existed. Show the canonical
  // settings.json path — it's the one Claude Code documents and the one users
  // recognize.
  const settingsPath = path.join(installDir, '.claude', 'settings.json');
  const editor = process.env.EDITOR ?? null;
  const failed = feedback !== null;

  const handleOpenInEditor = () => {
    if (!editor) return;
    try {
      // Detached + ignored streams so the editor is fully decoupled from the
      // wizard's TTY. Without `unref()` the wizard would refuse to exit while
      // the editor child is alive. Best-effort: any spawn failure (missing
      // binary, permission) is swallowed — the user still has the path.
      const child = spawn(editor, [settingsPath], {
        stdio: 'ignore',
        detached: true,
      });
      child.on('error', () => {
        /* swallow — fall back to "copy path manually" affordance */
      });
      child.unref();
    } catch {
      /* swallow */
    }
  };

  // [O]pen in $EDITOR is only meaningful in the failed phase — we don't want
  // it stealing keystrokes from ConfirmationInput while the user can still
  // hit Enter to retry the backup.
  useInput(
    (input) => {
      if (!failed) return;
      const ch = input.toLowerCase();
      if (ch === 'o' && editor) handleOpenInEditor();
    },
    { isActive: failed },
  );

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={Colors.error}
        paddingX={3}
        paddingY={1}
        width={72}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text color={Colors.error} bold>
            {Icons.diamond} Settings Conflict
          </Text>
        </Box>

        <Text color={Colors.body}>
          Your project&apos;s{' '}
          <Text bold color={Colors.heading}>
            .claude/settings.json
          </Text>{' '}
          sets:
        </Text>
        <Box flexDirection="column" marginY={1} paddingLeft={2}>
          {keys.map((key) => (
            <Text key={key} color={Colors.body}>
              {Icons.bullet}{' '}
              <Text color={Colors.warning} bold>
                {key}
              </Text>
            </Text>
          ))}
        </Box>
        <Text color={Colors.secondary}>
          These overrides prevent the Wizard from reaching the Amplitude LLM
          Gateway. We can back up the file and continue.
        </Text>

        {failed && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={Colors.warning}>
              {Icons.diamond} {feedback}
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={Colors.body}>File:</Text>
              <Text bold color={Colors.heading}>
                {' '}
                {settingsPath}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color={Colors.secondary}>
                Open the file, remove the keys above, then re-run the wizard.
              </Text>
            </Box>
          </Box>
        )}

        <Box marginY={1}>
          <Text color={Colors.border}>{Layout.separatorChar.repeat(64)}</Text>
        </Box>

        {failed ? (
          <Box flexDirection="column" gap={1}>
            {editor ? (
              <Text color={Colors.body}>
                <Text bold>[O]</Text> Open in {editor}
              </Text>
            ) : (
              <Text color={Colors.muted}>
                Set <Text bold>$EDITOR</Text> and re-run to enable an
                open-in-editor shortcut, or copy the path above and edit
                manually.
              </Text>
            )}
            <Text color={Colors.body}>
              <Text bold>[Esc]</Text> Exit so you can edit the file
            </Text>
            {/* In the failed phase the Confirm path is removed deliberately —
                pressing it again would hit the same failure. Esc routes
                through wizardAbort so the cancel reason is captured to
                analytics + Sentry and the standard cancel outro renders. */}
            <ExitOnEsc />
          </Box>
        ) : (
          <ConfirmationInput
            idPrefix="settings-override"
            message="Back up to .wizard-backup and continue?"
            confirmLabel="Backup & continue [Enter]"
            cancelLabel="Exit [Esc]"
            onConfirm={() => {
              const ok = store.backupAndFixSettingsOverride();
              if (!ok) {
                setFeedback('Could not back up the settings file.');
              }
            }}
            onCancel={() => {
              // User declined the backup-and-continue offer. Route
              // through wizardAbort so the cancel reason is captured to
              // analytics + Sentry instead of being a silent exit, and
              // so the standard cancel outro renders.
              void wizardAbort({
                message:
                  'Wizard cancelled — the .claude/settings.json overrides block the LLM gateway. Remove or scope them and re-run.',
                exitCode: 1,
              });
            }}
          />
        )}
      </Box>
    </Box>
  );
};

/**
 * Tiny inline component: in the failed phase the only thing Esc can do is
 * exit so the user can manually edit. Routes through wizardAbort so the
 * cancel reason is captured to analytics + Sentry and the standard cancel
 * outro renders.
 */
const ExitOnEsc = () => {
  useInput((_input, key) => {
    if (key.escape) {
      void wizardAbort({
        message:
          'Wizard cancelled — backup of .claude/settings.json failed. Edit the file manually and re-run.',
        exitCode: 1,
      });
    }
  });
  return null;
};
