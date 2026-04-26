/**
 * SetupScreen — Generic framework disambiguation (v2).
 *
 * Iterates unresolved setup questions from the FrameworkConfig
 * and renders a PickerMenu for each. If all questions are auto-resolved,
 * this screen is skipped entirely (the router skips it via its show() predicate).
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useMemo } from 'react';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useScreenHints } from '../hooks/useScreenHints.js';
import type { KeyHint } from '../components/KeyHintBar.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import type { SetupQuestion } from '../../../lib/framework-config.js';

interface SetupScreenProps {
  store: WizardStore;
}

export const SetupScreen = ({ store }: SetupScreenProps) => {
  useWizardStore(store);

  const config = store.session.frameworkConfig;
  const questions = config?.metadata.setup?.questions ?? [];

  // Track which question index we're currently showing
  const [currentIndex, setCurrentIndex] = useState(0);
  const [resolving, setResolving] = useState(true);

  // Esc steps back: first pop the most recent user-answered question (so
  // back works between Setup questions), then if nothing's left to pop,
  // delegate to the router so we walk past Setup entirely.
  const hasUserAnswers = store.session.frameworkContextAnswerOrder.length > 0;
  const canBackOutOfSetup = store.canGoBack();
  const backAvailable = !resolving && (hasUserAnswers || canBackOutOfSetup);
  useScreenInput(
    (_input, key) => {
      if (!key.escape) return;
      if (store.popLastFrameworkContextAnswer()) {
        setCurrentIndex((i) => Math.max(0, i - 1));
        return;
      }
      store.goBack();
    },
    { isActive: backAvailable },
  );
  const hints = useMemo<readonly KeyHint[]>(
    () => (backAvailable ? [{ key: 'Esc', label: 'Back' } as KeyHint] : []),
    [backAvailable],
  );
  useScreenHints(hints);

  // On mount, run auto-detection for all questions
  useEffect(() => {
    void (async () => {
      for (const q of questions) {
        // Skip if already resolved (e.g. by CLI arg)
        if (q.key in store.session.frameworkContext) continue;

        try {
          const detected = await q.detect({
            installDir: store.session.installDir,
          });
          if (detected !== null) {
            store.setFrameworkContext(q.key, detected);
          }
        } catch {
          // Detection failed — will ask the user
        }
      }
      setResolving(false);

      // If all resolved, the router's isComplete predicate will
      // resolve past this screen on the next render cycle.
    })();
  }, []);

  if (resolving) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text color={Colors.active}>
          Detecting project configuration{Icons.ellipsis}
        </Text>
      </Box>
    );
  }

  // Get unresolved questions
  const unresolved = questions.filter(
    (q: SetupQuestion) => !(q.key in store.session.frameworkContext),
  );

  if (unresolved.length === 0) {
    // All resolved — should have already advanced
    return null;
  }

  const question = unresolved[currentIndex] ?? unresolved[0];
  if (!question) return null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Project Setup
        </Text>
        {config && (
          <Text color={Colors.secondary}>
            Configuring {config.metadata.name} integration
          </Text>
        )}
      </Box>

      <PickerMenu<string>
        message={question.message}
        options={question.options.map((o) => ({
          label: o.label,
          value: o.value,
          hint: o.hint,
        }))}
        onSelect={(value) => {
          const selected = Array.isArray(value) ? value[0] : value;
          store.setFrameworkContext(question.key, selected);

          // Check if more unresolved questions remain
          const remaining = unresolved.filter(
            (q: SetupQuestion) =>
              q.key !== question.key &&
              !(q.key in store.session.frameworkContext),
          );

          if (remaining.length > 0) {
            setCurrentIndex((i) => i + 1);
          }
          // When no remaining questions, setFrameworkContext already
          // triggered emitChange — router resolves past this screen.
        }}
      />
    </Box>
  );
};
