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

  // Re-run detection whenever the user-answer order shrinks (i.e. an
  // answer was popped via back-nav). Without this, popping a question
  // that originally had an auto-detected value wouldn't re-detect on
  // re-entry — the user would be re-prompted even when detection still
  // succeeds.
  const answerOrderLength = store.session.frameworkContextAnswerOrder.length;

  // Esc steps back: first pop the most recent user-answered question (so
  // back works between Setup questions), then if nothing's left to pop,
  // delegate to the router so we walk past Setup entirely.
  const hasUserAnswers = answerOrderLength > 0;
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

  // Run auto-detection on mount AND whenever the answer order shrinks
  // (popLastFrameworkContextAnswer fired). Detection skips keys already
  // in frameworkContext, so questions the user just answered aren't
  // re-detected — only the ones missing after a pop get a fresh attempt.
  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    void (async () => {
      for (const q of questions) {
        // Skip if already resolved (e.g. by CLI arg, prior detection, or
        // a still-present user answer that wasn't popped).
        if (q.key in store.session.frameworkContext) continue;

        try {
          const detected = await q.detect({
            installDir: store.session.installDir,
          });
          if (cancelled) return;
          if (detected !== null) {
            store.setFrameworkContext(q.key, detected, true);
          }
        } catch {
          // Detection failed — will ask the user
        }
      }
      if (!cancelled) setResolving(false);

      // If all resolved, the router's isComplete predicate will
      // resolve past this screen on the next render cycle.
    })();
    return () => {
      cancelled = true;
    };
  }, [answerOrderLength]);

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
