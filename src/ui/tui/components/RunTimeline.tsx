/**
 * RunTimeline — composer for the redesigned RunScreen body.
 *
 * Layout (top-to-bottom):
 *
 *   step rail (parent owns)         ← rendered outside this component
 *   project context (medium widths drop below step rail)
 *
 *   ⠋ <voice line>
 *
 *   <todo block — up to 5 tasks>
 *
 *   ◆ mcp: installing  ◆ slack: queued   (extras row — optional)
 *
 *   ✎ src/app/layout.tsx               +12  −0   · 240ms
 *   ✎ src/lib/amplitude.ts             +28  −0   · 180ms
 *   …last N writes…
 *
 *   elapsed 2m 14s · $0.08 used
 *
 *   [d] diff  [e] events  [l] logs  [tab] ask  [/] more
 *
 * Width-responsive collapse (see WidthBucket):
 *
 *   - wide   (>=100 cols): ledger up to 5 rows, full extras row
 *   - medium (>= 60 cols): ledger up to 3 rows, extras row trimmed,
 *                          project context drops below step rail
 *   - narrow (<  60 cols): ledger up to 2 rows, extras row hidden,
 *                          hotkey rail uses single-space separators
 *
 * Subscribes narrowly via `useWizardStore` — read AC #1 in the PR
 * description for the contract.
 */

import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { useResolvedZone } from '../hooks/useResolvedZone.js';
import { BrailleSpinner } from './BrailleSpinner.js';
import { RunTimelineTodos } from './RunTimelineTodos.js';
import { RunTimelineLedger } from './RunTimelineLedger.js';
import { Brand, Colors, SPINNER_FRAMES, SPINNER_INTERVAL } from '../styles.js';
import {
  supportsUnicode,
  widthBucket,
  type WidthBucket,
} from '../lib/terminalCapabilities.js';
import { voice } from '../lib/voice.js';
import type { WizardStore } from '../store.js';
import {
  ADDITIONAL_FEATURE_LABELS,
  TRAILING_FEATURES,
} from '../session-constants.js';
import type { PostAgentStep } from '../../../lib/wizard-session.js';

/** Anything we render in the inline extras row. */
interface ExtraChip {
  key: string;
  label: string;
  state: 'queued' | 'in_progress' | 'done' | 'skipped';
}

interface RunTimelineProps {
  store: WizardStore;
  /**
   * Optional clock override for tests so elapsed time is deterministic.
   * Production callsites never pass this — the timer ticks off the live
   * Date.now().
   */
  now?: () => number;
  /**
   * When true, render the inline `◆ paused` pill between elapsed time
   * and the cost column. Wired today via prop because the wizard store
   * doesn't expose a `$paused` atom yet — the Tab-to-pause flow lands
   * in a follow-up PR. Tests pass `paused` directly.
   */
  paused?: boolean;
}

const ASCII_SPINNER_FRAMES = ['|', '/', '-', '\\'] as const;

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function chipFromCurrentFeature(
  current: ReturnType<WizardStore['getSnapshot']> extends never
    ? never
    : string | null,
): ExtraChip | null {
  // Helper kept inline so the composer doesn't grow a separate types
  // dependency for an ephemeral mapping. `current` is the session field
  // `additionalFeatureCurrent`, which is one of the AdditionalFeature
  // enum values (or null).
  if (!current) return null;
  if (!(current in ADDITIONAL_FEATURE_LABELS)) return null;
  const label =
    ADDITIONAL_FEATURE_LABELS[
      current as keyof typeof ADDITIONAL_FEATURE_LABELS
    ];
  return { key: current, label, state: 'in_progress' };
}

function buildExtraChips(store: WizardStore): ExtraChip[] {
  const chips: ExtraChip[] = [];
  const {
    additionalFeatureCurrent,
    additionalFeatureQueue,
    additionalFeatureCompleted,
    postAgentSteps,
  } = store.session;

  for (const f of additionalFeatureCompleted) {
    if (!TRAILING_FEATURES.has(f)) continue;
    chips.push({ key: f, label: ADDITIONAL_FEATURE_LABELS[f], state: 'done' });
  }
  const currentChip = chipFromCurrentFeature(additionalFeatureCurrent);
  if (
    currentChip &&
    TRAILING_FEATURES.has(
      additionalFeatureCurrent as keyof typeof ADDITIONAL_FEATURE_LABELS,
    )
  ) {
    chips.push(currentChip);
  }
  for (const f of additionalFeatureQueue) {
    if (!TRAILING_FEATURES.has(f)) continue;
    if (f === additionalFeatureCurrent) continue;
    if (additionalFeatureCompleted.includes(f)) continue;
    chips.push({
      key: f,
      label: ADDITIONAL_FEATURE_LABELS[f],
      state: 'queued',
    });
  }

  // Surface "interesting" post-agent steps (MCP install in particular).
  for (const step of postAgentSteps as readonly PostAgentStep[]) {
    chips.push({
      key: step.id,
      label: step.label,
      state:
        step.status === 'completed'
          ? 'done'
          : step.status === 'in_progress'
            ? 'in_progress'
            : step.status === 'skipped'
              ? 'skipped'
              : 'queued',
    });
  }
  return chips;
}

function stateVerb(state: ExtraChip['state']): string {
  switch (state) {
    case 'queued':
      return 'queued';
    case 'in_progress':
      return 'installing';
    case 'done':
      return 'done';
    case 'skipped':
      return 'skipped';
  }
}

function maxLedgerRows(bucket: WidthBucket): number {
  switch (bucket) {
    case 'wide':
      return 5;
    case 'medium':
      return 3;
    case 'narrow':
      return 2;
  }
}

/**
 * Resolve the voice line shown above the todos block.
 *
 * AC: prefers the latest `$statusMessages` entry. Falls back to the
 * voice-library `editing <path>` line if status is empty but a file
 * write is in flight, and `thinking…` if both are empty. The slot is
 * never blank.
 */
function resolveVoiceLine(store: WizardStore): string {
  const status = store.statusMessages;
  if (status.length > 0) {
    return status[status.length - 1].toLowerCase();
  }
  const writes = store.fileWrites;
  if (writes.length > 0) {
    const latest = writes[writes.length - 1];
    if (latest.status === 'planned') {
      return voice.editing(latest.path);
    }
  }
  return voice.thinking();
}

function ProjectContext({
  orgName,
  projectName,
  envName,
}: {
  orgName: string | null;
  projectName: string | null;
  envName: string | null;
}) {
  const parts = [orgName, projectName, envName].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return <Text color={Colors.muted}>{parts.join(' / ')}</Text>;
}

function ExtrasRow({
  chips,
  bucket,
  ascii,
}: {
  chips: ExtraChip[];
  bucket: WidthBucket;
  ascii: boolean;
}) {
  if (chips.length === 0) return null;
  if (bucket === 'narrow') return null;
  // At medium widths drop to the first two chips to keep things on one row.
  const visible = bucket === 'medium' ? chips.slice(0, 2) : chips;
  const glyph = ascii ? '*' : '◆';
  return (
    <Box flexDirection="row" flexWrap="wrap">
      {visible.map((chip, i) => (
        <Box key={chip.key} marginRight={i === visible.length - 1 ? 0 : 2}>
          <Text color={Brand.lilac}>{glyph} </Text>
          <Text color={Colors.body}>
            {chip.label.toLowerCase()}: {stateVerb(chip.state)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function HotkeyRail({ bucket }: { bucket: WidthBucket }) {
  const sep = bucket === 'narrow' ? ' ' : '  ';
  const hotkeys: ReadonlyArray<readonly [string, string]> = [
    ['d', 'diff'],
    ['e', 'events'],
    ['l', 'logs'],
    ['tab', 'ask'],
    ['/', 'more'],
  ];
  return (
    <Box>
      {hotkeys.map(([key, label], i) => (
        <Box key={key}>
          <Text color={Colors.accent}>[{key}]</Text>
          {bucket === 'narrow' ? null : <Text> </Text>}
          <Text color={Colors.body}>{label}</Text>
          {i < hotkeys.length - 1 ? <Text>{sep}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

export const RunTimeline = ({ store, now, paused = false }: RunTimelineProps) => {
  useWizardStore(store);
  const [cols] = useStdoutDimensions();
  const ascii = !supportsUnicode();
  const bucket = widthBucket(cols);
  const isWide = bucket === 'wide';

  // Tick drives the spinner + elapsed timer. Single interval, mirrors
  // the legacy RunScreen so we don't run two timers concurrently when
  // the user has the new UX flag on.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), SPINNER_INTERVAL);
    return () => clearInterval(id);
  }, []);

  const clock = now ?? Date.now;
  const startedAt = store.session.runStartedAt ?? clock();
  const elapsed = Math.floor((clock() - startedAt) / 1000);
  const frame =
    tick %
    (ascii ? ASCII_SPINNER_FRAMES.length : SPINNER_FRAMES.length);
  const spinnerChar = ascii ? ASCII_SPINNER_FRAMES[frame] : null;

  const voiceLine = resolveVoiceLine(store);
  const tasks = store.tasks;
  const extras = buildExtraChips(store);
  const ledgerMax = maxLedgerRows(bucket);

  const orgName = store.session.selectedOrgName;
  const projectName = store.session.selectedProjectName;
  // Go through `useResolvedZone` — direct session.<region> reads are
  // banned by the zone-resolution drift guard (see
  // src/lib/__tests__/zone-resolution.invariants.test.ts).
  const envName = useResolvedZone(store.session);

  return (
    <Box flexDirection="column" overflow="hidden">
      {/* Project context — kept inside the timeline so the medium-width
          variant shows it directly below the step rail (which the
          screen renders above us). */}
      {!isWide && (
        <Box marginBottom={1}>
          <ProjectContext
            orgName={orgName}
            projectName={projectName}
            envName={envName}
          />
        </Box>
      )}

      {/* Voice line: spinner + latest narration */}
      <Box marginBottom={1}>
        {ascii ? (
          <Text color={Colors.active}>{spinnerChar}</Text>
        ) : (
          <BrailleSpinner frame={frame} />
        )}
        <Text> </Text>
        <Text color={Colors.body}>{voiceLine}</Text>
      </Box>

      {/* Todo block */}
      <RunTimelineTodos tasks={tasks} ascii={ascii} max={5} />

      {/* Extras row */}
      {extras.length > 0 && bucket !== 'narrow' ? (
        <Box marginTop={1}>
          <ExtrasRow chips={extras} bucket={bucket} ascii={ascii} />
        </Box>
      ) : null}

      {/* Ledger */}
      {store.fileWrites.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <RunTimelineLedger
            entries={store.fileWrites}
            installDir={store.session.installDir}
            max={ledgerMax}
            cols={cols}
            ascii={ascii}
          />
        </Box>
      ) : null}

      {/* Footer: elapsed (· paused) · cost */}
      <Box marginTop={1}>
        <Text color={Colors.muted}>elapsed {formatElapsed(elapsed)}</Text>
        {paused ? (
          <>
            <Text color={Colors.muted}> </Text>
            <Text color={Brand.lilac}>{ascii ? '*' : '◆'} paused</Text>
          </>
        ) : null}
        <Text color={Colors.muted}> · $0.00 used</Text>
      </Box>

      {/* Hotkey rail */}
      <Box marginTop={1}>
        <HotkeyRail bucket={bucket} />
      </Box>
    </Box>
  );
};
