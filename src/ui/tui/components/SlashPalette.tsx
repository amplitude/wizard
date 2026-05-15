/**
 * SlashPalette — `/`-triggered command palette skeleton.
 *
 * Renders an inline command picker with fuzzy-ranked results when the
 * parent screen asks it to open. This PR ships the *skeleton*: the
 * palette is a self-contained component, and the parent screen owns
 * `open` state (in a later PR, `RunScreen` and friends will toggle it
 * on `/` keystroke).
 *
 * Wiring:
 *   • The catalog is built from `COMMANDS` in `console-commands.ts`
 *     plus a handful of palette-only stubs (`/events`, `/resume` —
 *     already added to `console-commands.ts` for PR 3). Existing
 *     commands route to `onCommand(cmd)` so the parent can dispatch
 *     them through the established `executeCommand` pipeline. Stubs
 *     short-circuit to `store.setCommandFeedback(...)` with a
 *     "not yet wired" notice.
 *   • TextInput from `@inkjs/ui` consumes `Enter` and most printable
 *     keys, but ignores `↑`/`↓`/`Esc`. We layer a parallel `useInput`
 *     handler for navigation and dismissal.
 *   • Defensive outer `<Box overflow="hidden">` defends against the
 *     #779 overdraw bug — when the list temporarily renders taller
 *     than its container during transitions, Ink can leave stale
 *     glyphs around. Clipping the box rules that out.
 *
 * Out of scope for this PR (per the timeline-ux plan):
 *   • Opening the palette from any screen — parent controls `open`.
 *   • Real handlers for the stub commands — they'll arrive in later
 *     PRs and replace the inline feedback path.
 */

import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useMemo, useState } from 'react';
import { Colors, Icons } from '../styles.js';
import { COMMANDS } from '../console-commands.js';
import { fuzzyRank, type FuzzyRankItem } from '../lib/fuzzyRank.js';
import type { WizardStore } from '../store.js';

/**
 * Catalog entry shape. Extends the fuzzy-rank item with a `kind`
 * discriminator so the dispatcher knows whether to route to the
 * existing handler or surface the stub-feedback notice.
 */
export interface PaletteCommand extends FuzzyRankItem {
  /** Description shown next to the command name. */
  description: string;
  /**
   * 'existing' — call `onCommand(id)` so the parent dispatches via
   * `executeCommand`. 'stub' — handled in-palette via setCommandFeedback.
   */
  kind: 'existing' | 'stub';
}

/**
 * Commands that ship without real handlers in PR 3. Picking one of
 * these from the palette surfaces a "not yet wired" notice; real
 * handlers replace the stub treatment in later PRs.
 */
const STUB_COMMAND_IDS = new Set<string>(['/events', '/resume']);

/**
 * Keyword overrides for commands whose label alone wouldn't catch
 * common user queries. e.g. a user typing `org` should find
 * `/whoami` (because that's where they confirm the active org). Kept
 * deliberately small for now — real telemetry from `wizard feedback`
 * can grow this over time.
 */
const KEYWORD_OVERRIDES: Record<string, string[]> = {
  '/whoami': ['user', 'org', 'project', 'identity'],
  '/region': ['zone', 'us', 'eu', 'data center'],
  '/diff': ['changes', 'files'],
  '/diagnostics': ['paths', 'storage', 'debug'],
  '/snake': ['game'],
  '/events': ['plan', 'taxonomy', 'tracking'],
  '/resume': ['continue', 'checkpoint'],
  '/feedback': ['report', 'bug'],
  '/mcp': ['cursor', 'editor', 'install'],
};

/**
 * Build the palette catalog from `COMMANDS`. De-duplicates by `cmd`
 * (the existing registry has a stray duplicate `/help` entry that we
 * don't want to surface twice).
 */
function buildCatalog(): PaletteCommand[] {
  const seen = new Set<string>();
  const out: PaletteCommand[] = [];
  for (const def of COMMANDS) {
    if (seen.has(def.cmd)) continue;
    seen.add(def.cmd);
    out.push({
      id: def.cmd,
      label: def.cmd,
      description: def.desc,
      keywords: KEYWORD_OVERRIDES[def.cmd],
      kind: STUB_COMMAND_IDS.has(def.cmd) ? 'stub' : 'existing',
    });
  }
  return out;
}

export interface SlashPaletteProps {
  /** When false, the palette renders nothing. */
  open: boolean;
  /**
   * Called when the user picks a non-stub command. The argument is
   * the command id (e.g. `/whoami`). Parent is expected to forward
   * this to the existing `executeCommand` pipeline.
   */
  onCommand: (cmd: string) => void;
  /** Called when the user dismisses the palette (Esc, or no input). */
  onClose: () => void;
  /**
   * The wizard store. Stub commands route their "not yet wired"
   * notice through `store.setCommandFeedback` rather than calling
   * `onCommand`, so the parent doesn't need to special-case them.
   *
   * Optional so tests can omit it (the catalog renders fine without
   * a store; dispatching a stub without one no-ops).
   */
  store?: WizardStore;
  /**
   * Test override for the command catalog. Production callers should
   * leave this undefined — the default is built from `COMMANDS`.
   */
  catalog?: PaletteCommand[];
}

/**
 * Render a single row in the result list. Pulled out so the focused
 * vs unfocused styling stays in one place.
 */
const PaletteRow = ({
  command,
  focused,
}: {
  command: PaletteCommand;
  focused: boolean;
}) => {
  const marker = focused ? Icons.triangleSmallRight : ' ';
  const nameColor = focused ? Colors.accent : Colors.body;
  const descColor = focused ? Colors.body : Colors.muted;
  return (
    <Box flexDirection="row">
      <Text color={Colors.accent}>{marker} </Text>
      <Text color={nameColor} bold={focused}>
        {command.label}
      </Text>
      <Text color={Colors.muted}> · </Text>
      <Text color={descColor}>{command.description}</Text>
    </Box>
  );
};

export const SlashPalette = ({
  open,
  onCommand,
  onClose,
  store,
  catalog,
}: SlashPaletteProps) => {
  const items = useMemo(() => catalog ?? buildCatalog(), [catalog]);
  // `query` always includes the leading `/`. Trimmed before ranking
  // so a user typing nothing extra (just `/`) sees the full catalog
  // in its original order.
  const [query, setQuery] = useState<string>('/');
  const [focusIndex, setFocusIndex] = useState(0);

  // Strip the leading slash before ranking — every catalog id is
  // slash-prefixed too, so leaving the `/` in the query would only
  // match the prefix tier and never the substring/subsequence tiers
  // for partial queries like `dia`.
  const ranked = useMemo(() => {
    const stripped = query.startsWith('/') ? query.slice(1) : query;
    if (stripped.trim().length === 0) return items;
    // Rank against the bare command name (without the slash) so the
    // prefix tier fires for queries like `dia` → `/diagnostics`.
    const naked = items.map((c) => ({
      ...c,
      label: c.label.startsWith('/') ? c.label.slice(1) : c.label,
    }));
    const order = fuzzyRank(stripped, naked);
    // Re-attach to the original entries so the rendered label keeps
    // its `/` prefix.
    const byId = new Map(items.map((c) => [c.id, c]));
    return order
      .map((r) => byId.get(r.id))
      .filter((c): c is PaletteCommand => c !== undefined);
  }, [items, query]);

  // Clamp focus when the result list shrinks (e.g. user types another
  // character and the focused row falls off the end).
  const clampedFocus =
    ranked.length === 0 ? 0 : Math.min(focusIndex, ranked.length - 1);

  // Layer a parallel input handler for keys @inkjs/ui TextInput
  // ignores: ↑ / ↓ for navigation, Esc for dismiss. Enter is
  // consumed by TextInput and surfaces via its `onSubmit`.
  useInput(
    (_input, key) => {
      if (!open) return;
      if (key.escape) {
        onClose();
        return;
      }
      if (key.upArrow) {
        setFocusIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setFocusIndex((i) =>
          ranked.length === 0 ? 0 : Math.min(ranked.length - 1, i + 1),
        );
        return;
      }
    },
    { isActive: open },
  );

  if (!open) return null;

  const handleSubmit = () => {
    const picked = ranked[clampedFocus];
    if (!picked) {
      // No matches — Enter is a no-op. We let the user keep typing or
      // hit Esc; closing on a no-match Enter would feel abrupt.
      return;
    }
    if (picked.kind === 'stub') {
      store?.setCommandFeedback([
        `${picked.label} — not yet wired — coming in a later PR`,
      ]);
      onClose();
      return;
    }
    onCommand(picked.id);
    onClose();
  };

  return (
    // overflow="hidden" defends against #779 overdraw: when the list
    // shrinks the next frame can leak old rows below the container.
    // Clipping the outer box trims them.
    <Box flexDirection="column" overflow="hidden">
      <Box flexDirection="row">
        <Text color={Colors.accent}>{Icons.prompt} </Text>
        <TextInput
          defaultValue="/"
          placeholder="/help"
          onChange={(v) => {
            setQuery(v);
            // Snap focus back to the top whenever the query changes
            // so the user always sees the best match highlighted.
            setFocusIndex(0);
          }}
          onSubmit={handleSubmit}
        />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {ranked.length === 0 ? (
          <Text color={Colors.muted}>no commands match</Text>
        ) : (
          ranked.map((cmd, i) => (
            <PaletteRow
              key={cmd.id}
              command={cmd}
              focused={i === clampedFocus}
            />
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.muted}>
          {Icons.dot} [Enter] run · [Esc] close · [↑↓] navigate
        </Text>
      </Box>
    </Box>
  );
};
