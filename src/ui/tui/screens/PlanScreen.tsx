/**
 * PlanScreen — Instrumentation plan review before the agent runs.
 *
 * Flow:
 *   1. Generating — kicks off plan generation on mount, shows spinner
 *   2. Ready      — shows plan text with three options:
 *                     (y) Proceed  (s) Skip  (f) Give feedback
 *   3. Feedback   — inline text input; on submit regenerates the plan
 *   4. Re-generating — same spinner, shows prior feedback was incorporated
 *
 * The screen loops until the user approves or skips.
 * Feedback history is accumulated in session.planFeedback.
 */

import { Box, Text, useInput } from 'ink';
import { useState, useEffect, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { LoadingBox } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import { generateInstrumentationPlan } from '../../../lib/plan-generator.js';
import { useScreenInput } from '../hooks/useScreenInput.js';

interface PlanScreenProps {
  store: WizardStore;
}

type InputMode = 'options' | 'feedback';

const OPTION_KEYS = ['y', 's', 'f'] as const;
type OptionKey = (typeof OPTION_KEYS)[number];

const OPTIONS: Array<{ key: OptionKey; label: string }> = [
  { key: 'y', label: 'Proceed' },
  { key: 's', label: 'Skip' },
  { key: 'f', label: 'Give feedback' },
];

export const PlanScreen = ({ store }: PlanScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const { planStatus, instrumentationPlan, planFeedback, frameworkConfig } =
    session;

  const [inputMode, setInputMode] = useState<InputMode>('options');
  const [focusedOption, setFocusedOption] = useState<OptionKey>('y');
  const [feedbackText, setFeedbackText] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);

  // Kick off plan generation whenever status is 'pending' or 'generating'
  useEffect(() => {
    if (planStatus !== 'pending' && planStatus !== 'generating') return;
    if (!session.credentials || !frameworkConfig) return;

    // Mark as generating (no-op if already set, but normalises 'pending')
    if (planStatus === 'pending') {
      store.startPlanGeneration();
    }

    void generateInstrumentationPlan({
      config: frameworkConfig,
      session,
      priorFeedback: planFeedback.length > 0 ? planFeedback : undefined,
    })
      .then((plan) => {
        store.setInstrumentationPlan(plan);
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : 'Plan generation failed';
        store.setPlanError(
          `⚠ Could not generate a plan: ${msg}\n\nYou can proceed anyway — the agent will instrument your project.`,
        );
      });
  }, [planStatus]);

  // Blinking cursor in feedback input
  useEffect(() => {
    if (inputMode !== 'feedback') return;
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [inputMode]);

  // Reset input mode when plan is regenerated
  useEffect(() => {
    if (planStatus === 'ready') {
      setInputMode('options');
      setFeedbackText('');
    }
  }, [planStatus]);

  // Keyboard handling for options mode
  useScreenInput(
    (_char, key) => {
      if (inputMode !== 'options' || planStatus !== 'ready') return;

      if (key.leftArrow || key.rightArrow) {
        setFocusedOption((prev) => {
          const idx = OPTIONS.findIndex((o) => o.key === prev);
          const next = key.rightArrow
            ? OPTIONS[(idx + 1) % OPTIONS.length]
            : OPTIONS[(idx - 1 + OPTIONS.length) % OPTIONS.length];
          return next.key;
        });
        return;
      }

      if (key.return) {
        handleOptionSelect(focusedOption);
        return;
      }

      // Shortcut keys
      const lc = _char.toLowerCase() as OptionKey;
      if (OPTION_KEYS.includes(lc)) {
        handleOptionSelect(lc);
      }
    },
    { isActive: inputMode === 'options' && planStatus === 'ready' },
  );

  // Keyboard handling for feedback text input
  useInput(
    (char, key) => {
      if (inputMode !== 'feedback') return;

      if (key.return) {
        const text = feedbackText.trim();
        if (text) {
          store.addPlanFeedback(text);
        }
        setFeedbackText('');
        return;
      }
      if (key.escape) {
        setInputMode('options');
        setFeedbackText('');
        return;
      }
      if (key.backspace || key.delete) {
        setFeedbackText((v) => v.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta || key.tab) return;
      if (char) {
        setFeedbackText((v) => v + char);
      }
    },
    { isActive: inputMode === 'feedback' },
  );

  function handleOptionSelect(key: OptionKey) {
    if (key === 'y') {
      store.approvePlan();
    } else if (key === 's') {
      store.skipPlan();
    } else if (key === 'f') {
      setInputMode('feedback');
    }
  }

  const isGenerating = planStatus === 'pending' || planStatus === 'generating';
  const hasRefinements = planFeedback.length > 0;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={Colors.accent}>
          Instrumentation Plan
        </Text>
        {hasRefinements && (
          <Text color={Colors.muted}> (revision {planFeedback.length})</Text>
        )}
      </Box>

      {/* Generating state */}
      {isGenerating && (
        <LoadingBox
          message={
            hasRefinements
              ? 'Updating plan with your feedback...'
              : 'Analyzing your project...'
          }
        />
      )}

      {/* Plan text */}
      {!isGenerating && instrumentationPlan && (
        <Box flexDirection="column" marginBottom={1}>
          <PlanText text={instrumentationPlan} />
        </Box>
      )}

      {/* Options or feedback input */}
      {!isGenerating && planStatus === 'ready' && (
        <Box flexDirection="column" marginTop={1}>
          {inputMode === 'options' && (
            <OptionsBar
              options={OPTIONS}
              focused={focusedOption}
              onFocus={setFocusedOption}
            />
          )}

          {inputMode === 'feedback' && (
            <FeedbackInput value={feedbackText} cursorVisible={cursorVisible} />
          )}
        </Box>
      )}
    </Box>
  );
};

/** Renders plan text line-by-line, styling markdown headers. */
const PlanText = ({ text }: { text: string }) => {
  const lines = text.split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <Box key={i} marginTop={i === 0 ? 0 : 1}>
              <Text bold>{line.slice(3)}</Text>
            </Box>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <Box key={i} marginTop={i === 0 ? 0 : 1}>
              <Text bold color={Colors.accent}>
                {line.slice(2)}
              </Text>
            </Box>
          );
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <Box key={i}>
              <Text color={Colors.muted}>{Icons.bullet} </Text>
              <Text>{line.slice(2)}</Text>
            </Box>
          );
        }
        if (line.trim() === '') {
          return <Box key={i} height={1} />;
        }
        return (
          <Box key={i}>
            <Text>{line}</Text>
          </Box>
        );
      })}
    </Box>
  );
};

interface OptionsBarProps {
  options: typeof OPTIONS;
  focused: OptionKey;
  onFocus: (key: OptionKey) => void;
}

const OptionsBar = ({ options, focused }: OptionsBarProps) => (
  <Box flexDirection="column">
    <Text color={Colors.muted}>
      Use arrow keys or shortcuts, then press Enter
    </Text>
    <Box gap={3} marginTop={1}>
      {options.map(({ key, label }) => {
        const isFocused = key === focused;
        return (
          <Box key={key}>
            <Text
              bold={isFocused}
              color={isFocused ? Colors.accent : Colors.muted}
            >
              {isFocused ? Icons.triangleSmallRight : ' '} ({key}) {label}
            </Text>
          </Box>
        );
      })}
    </Box>
  </Box>
);

const FeedbackInput = ({
  value,
  cursorVisible,
}: {
  value: string;
  cursorVisible: boolean;
}) => (
  <Box flexDirection="column">
    <Text color={Colors.muted}>
      Describe what to change (Enter to submit, Esc to go back):
    </Text>
    <Box marginTop={1} gap={1}>
      <Text color={Colors.muted}>{'>'}</Text>
      <Text>
        {value}
        {cursorVisible ? <Text inverse> </Text> : <Text> </Text>}
      </Text>
    </Box>
  </Box>
);
