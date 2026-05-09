/**
 * ChoiceCheckpointBanner — render a typed `Choice` record as a durable
 * TUI banner.
 *
 * PR 3 introduces this primitive so any screen can render a pending
 * orchestration `Choice` with the full UX contract: why-asking,
 * recommended option, safe default, "skipping is/isn't safe", "what
 * happens next", reversibility.
 *
 * Today the only active wiring is read-only — screens render the banner
 * AND keep their existing inline answer UI. When the user picks,
 * the screen-side handler ALSO calls `store.answerChoice(...)` (or the
 * existing equivalent) so the durable record stays in sync. PR 4 will
 * widen the rollout — this primitive is the substrate.
 *
 * Pure / no store subscription — re-renders only when its props change.
 * Callers that need to listen to store changes wrap it in a
 * `useWizardStore(store)` hook.
 */
import { Box, Text } from 'ink';
import type { Choice } from '../../../lib/orchestration/checkpoints/choices.js';
import { Colors, Icons } from '../styles.js';

export interface ChoiceCheckpointBannerProps {
  choice: Choice;
  /** Optional — show the user's pick once answered, instead of options. */
  showAnswered?: boolean;
}

export const ChoiceCheckpointBanner = ({
  choice,
  showAnswered = false,
}: ChoiceCheckpointBannerProps) => {
  const recommended = choice.options.find(
    (o) => o.id === choice.recommendedOptionId,
  );
  const safeDefault = choice.options.find(
    (o) => o.id === choice.safeDefaultOptionId,
  );
  const isSafeToSkip =
    choice.safeDefaultOptionId !== null &&
    !choice.requiresHuman &&
    choice.reversible;

  const skipPhrase = isSafeToSkip
    ? 'skipping is safe — falls back to the safe default'
    : "skipping isn't safe — see consequence below";

  return (
    <Box flexDirection="column">
      <Text color={Colors.accent} bold>
        {Icons.diamond} {choice.message}
      </Text>
      <Text color={Colors.muted}>
        {' '}
        why we're asking: {choice.whyAsking}
      </Text>
      {!showAnswered && (
        <Box flexDirection="column" marginTop={1}>
          {choice.options.map((o) => {
            const tags: string[] = [];
            if (o.id === choice.recommendedOptionId) tags.push('recommended');
            if (o.id === choice.safeDefaultOptionId) tags.push('safe-default');
            return (
              <Box key={o.id}>
                <Text color={Colors.body}>
                  {Icons.bullet}{' '}
                  <Text bold color={Colors.heading}>
                    {o.label}
                  </Text>
                  {tags.length > 0 ? (
                    <Text color={Colors.muted}> ({tags.join(', ')})</Text>
                  ) : null}
                  {o.description ? (
                    <Text color={Colors.muted}> — {o.description}</Text>
                  ) : null}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      {showAnswered && choice.answeredOptionId && (
        <Text color={Colors.success}>
          {Icons.checkmark} answered: {choice.answeredOptionId}
        </Text>
      )}
      <Text color={Colors.muted}>
        {' '}
        if skipped: {choice.consequenceIfSkipped}
      </Text>
      <Text color={Colors.muted}>
        {' '}
        reversible: {choice.reversible ? 'yes' : 'no'} · {skipPhrase}
      </Text>
      {recommended && safeDefault && recommended.id !== safeDefault.id && (
        <Text color={Colors.muted}>
          {' '}
          (recommended ≠ safe-default — pick deliberately)
        </Text>
      )}
    </Box>
  );
};
