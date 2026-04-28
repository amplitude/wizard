/**
 * SettingsOverrideScreen — Modal when .claude/settings.json contains env overrides
 * that block the Wizard from reaching the Amplitude LLM Gateway (v2).
 */

import { Box, Text } from 'ink';
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

  if (!keys || keys.length === 0) {
    return null;
  }

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
        width={64}
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

        {feedback && (
          <Box marginTop={1}>
            <Text color={Colors.warning}>
              {Icons.diamond} {feedback}
            </Text>
          </Box>
        )}

        <Box marginY={1}>
          <Text color={Colors.border}>{Layout.separatorChar.repeat(56)}</Text>
        </Box>

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
            //
            // popOverlay() FIRST — without it, the router resolves to
            // this overlay so OutroScreen never mounts and wizardAbort
            // hangs on its 5-minute safety timeout. (Bugbot caught this
            // on PR 343.)
            store.popOverlay();
            void wizardAbort({
              message:
                'Wizard cancelled — the .claude/settings.json overrides block the LLM gateway. Remove or scope them and re-run.',
              exitCode: 1,
            });
          }}
        />
      </Box>
    </Box>
  );
};
