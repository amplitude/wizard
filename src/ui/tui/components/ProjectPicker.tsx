/**
 * ProjectPicker — Windowed, fuzzy + column-scoped project picker.
 *
 * Designed for orgs with thousands of projects. Renders no more than
 * `MAX_VISIBLE_ROWS` project rows at any time, regardless of dataset
 * size — so a 5000-project frame stays well under the 100-Text-node
 * budget enforced by the snapshot tests.
 *
 * Filter syntax:
 *   - Bare query        — fuzzy across name + org + env
 *   - `%org foo`        — scope match to org name/id
 *   - `%name web`       — scope match to project name
 *   - `%env prod`       — scope match to environment name
 *   - Scopes may stack: `%org acme %name web`
 *
 * Gated behind `WIZARD_NEW_UX=1` at the screen callsite — this
 * component itself is presentational and has no env-var coupling.
 *
 * PR 5 / 10 of the Timeline UX redesign.
 *
 * Deferred dependencies (swap on merge):
 *   - `fuzzyRank` from `src/ui/tui/lib/fuzzyRank.ts` (PR 3 — not yet on
 *     base). We inline a minimal substring + position-bonus ranker
 *     below; replace `rankMatch` with the PR-3 export when PR 3 lands.
 *   - `terminalCapabilities` from PR 1 — we inline the
 *     `WIZARD_FORCE_ASCII` / `LANG`-lacks-UTF-8 check directly.
 *   - `voice.*` strings from PR 2 — using plain strings; PR 10 sweeps.
 */

import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useMemo, useState, useRef, useEffect } from 'react';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { Colors, Icons } from '../styles.js';

/** Hard cap — never render more than this many project rows in one frame. */
export const MAX_VISIBLE_ROWS = 50;

/** Inline ASCII fallback (defers PR 1's terminalCapabilities). */
function shouldForceAscii(): boolean {
  if (process.env.WIZARD_FORCE_ASCII === '1') return true;
  const lang = process.env.LANG ?? '';
  if (!lang) return false;
  return !/UTF-?8/i.test(lang);
}

export interface ProjectPickerEntry {
  /** Stable project ID. */
  id: string;
  /** Project name shown in the list. */
  name: string;
  /** Owning org's display name (used for fuzzy + `%org` scoping). */
  orgName: string;
  /** Owning org's ID (matched alongside the name under `%org`). */
  orgId: string;
  /**
   * Optional environment label (e.g. "Production"). Multi-env projects
   * may pass a single representative env or omit it — the picker treats
   * it as an additional fuzzy field.
   */
  envName?: string | null;
}

export interface ProjectPickerProps {
  projects: ProjectPickerEntry[];
  onSelect: (project: ProjectPickerEntry) => void;
  /**
   * Fired when the user invokes the inline new-project form. The parent
   * owns the actual API call; this component only collects name + env.
   */
  onCreate?: (input: { name: string; envName: string }) => void;
  /** Pre-seed the query input — useful for restoring state on remount. */
  initialQuery?: string;
}

/* ─── Column-scope tokenizer ────────────────────────────────────────── */

type Scope = 'org' | 'name' | 'env';

interface ParsedQuery {
  scopes: Partial<Record<Scope, string>>;
  residual: string;
}

const SCOPE_RE = /%(org|name|env)\s+([^%]*?)(?=\s*%|$)/gi;

/**
 * Parse `%org foo %name web` → { scopes: { org: 'foo', name: 'web' }, residual: '' }.
 * Anything outside a `%scope …` chunk falls into the residual fuzzy term.
 */
export function parseQuery(raw: string): ParsedQuery {
  const scopes: Partial<Record<Scope, string>> = {};
  // Capture and strip scope spans first.
  const stripped = raw.replace(SCOPE_RE, (_full, scope: string, value: string) => {
    const key = scope.toLowerCase() as Scope;
    const trimmed = value.trim();
    if (trimmed) scopes[key] = trimmed.toLowerCase();
    return ' ';
  });
  return { scopes, residual: stripped.replace(/\s+/g, ' ').trim().toLowerCase() };
}

/* ─── Minimal inline fuzzy ranker (deferral: PR 3) ──────────────────── */

/**
 * Returns a numeric rank for `needle` against `haystack`, or `null` if no
 * match. Higher rank = better match. Strategy: case-insensitive substring
 * match with a bonus for prefix matches and a small bonus for earlier
 * positions. Good enough for typical project-name filtering; PR 3's
 * `fuzzyRank` adds subsequence-with-gap scoring on top.
 */
export function rankMatch(haystack: string, needle: string): number | null {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  const idx = h.indexOf(n);
  if (idx === -1) return null;
  // Prefix > word-boundary > anywhere. Position closer to 0 = better.
  let score = 1000 - idx;
  if (idx === 0) score += 500;
  else if (idx > 0 && /\W/.test(h[idx - 1] ?? '')) score += 200;
  // Shorter haystacks rank higher when the needle is the same length.
  score -= Math.max(0, h.length - n.length);
  return score;
}

/* ─── Filter + rank pipeline ───────────────────────────────────────── */

interface RankedEntry {
  entry: ProjectPickerEntry;
  score: number;
}

export function filterAndRank(
  projects: ProjectPickerEntry[],
  parsed: ParsedQuery,
): RankedEntry[] {
  const { scopes, residual } = parsed;
  const out: RankedEntry[] = [];

  for (const entry of projects) {
    let score = 0;
    let keep = true;

    // Column-scoped matches are mandatory when present.
    if (scopes.org !== undefined) {
      const a = rankMatch(entry.orgName, scopes.org);
      const b = rankMatch(entry.orgId, scopes.org);
      const best = pickBest(a, b);
      if (best === null) {
        keep = false;
      } else {
        score += best;
      }
    }
    if (keep && scopes.name !== undefined) {
      const r = rankMatch(entry.name, scopes.name);
      if (r === null) keep = false;
      else score += r;
    }
    if (keep && scopes.env !== undefined) {
      const r = rankMatch(entry.envName ?? '', scopes.env);
      if (r === null) keep = false;
      else score += r;
    }

    if (!keep) continue;

    // Residual is fuzzy across all visible fields.
    if (residual) {
      const r = pickBest(
        rankMatch(entry.name, residual),
        rankMatch(entry.orgName, residual),
        rankMatch(entry.envName ?? '', residual),
      );
      if (r === null) continue;
      score += r;
    }

    out.push({ entry, score });
  }

  out.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return out;
}

function pickBest(...scores: Array<number | null>): number | null {
  let best: number | null = null;
  for (const s of scores) {
    if (s === null) continue;
    if (best === null || s > best) best = s;
  }
  return best;
}

/* ─── Component ────────────────────────────────────────────────────── */

type SubState = 'picker' | 'newProject';

export const ProjectPicker = ({
  projects,
  onSelect,
  onCreate,
  initialQuery = '',
}: ProjectPickerProps) => {
  const [, rows] = useStdoutDimensions();
  const [query, setQuery] = useState(initialQuery);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [subState, setSubState] = useState<SubState>('picker');

  // Mirror `query` into a ref so the useInput closure (which is recreated
  // each render but may fire before the ref-updating effect commits its
  // re-render) always reads the freshest typed value. Without this, the
  // `n` hotkey gating ("only on empty query") races with TextInput's
  // onChange dispatch and can fire after the user has already typed.
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const ascii = shouldForceAscii();
  const cursorGlyph = ascii ? '>' : Icons.triangleSmallRight;

  // Reserve ~10 rows of chrome (header, filter input, footer, hints).
  // Floor at 5; cap at MAX_VISIBLE_ROWS so we never exceed the budget.
  const visibleWindow = Math.max(
    5,
    Math.min(MAX_VISIBLE_ROWS, (rows || 24) - 10),
  );

  const parsed = useMemo(() => parseQuery(query), [query]);
  const ranked = useMemo(
    () => filterAndRank(projects, parsed),
    [projects, parsed],
  );
  const totalMatches = ranked.length;
  const visible = ranked.slice(0, visibleWindow);
  const hiddenCount = Math.max(0, totalMatches - visible.length);

  // Reset focus when filter changes to avoid an out-of-bounds index.
  const safeIndex = Math.min(focusedIndex, Math.max(0, visible.length - 1));

  useScreenInput(
    (input, key) => {
      if (subState === 'newProject') return; // sub-form owns input
      if (key.escape) return; // bubble Esc to parent screen
      if (key.upArrow) {
        setFocusedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setFocusedIndex((i) => Math.min(visible.length - 1, i + 1));
        return;
      }
      if (key.return) {
        const picked = visible[safeIndex];
        if (picked) onSelect(picked.entry);
        return;
      }
      if (
        (input === 'n' || input === 'N') &&
        queryRef.current.trim() === '' &&
        onCreate
      ) {
        setSubState('newProject');
        return;
      }
    },
    { isActive: subState === 'picker' },
  );

  if (subState === 'newProject') {
    return (
      <NewProjectInlineForm
        onCancel={() => setSubState('picker')}
        onCreate={(input) => {
          onCreate?.(input);
          setSubState('picker');
        }}
      />
    );
  }

  return (
    <Box flexDirection="column" overflow="hidden">
      <Box>
        <Text color={Colors.muted}>Filter: </Text>
        <Box flexGrow={1}>
          <TextInput
            defaultValue={initialQuery}
            placeholder="type to filter — %org, %name, %env scope keys"
            onChange={(value) => {
              setQuery(value);
              setFocusedIndex(0);
            }}
          />
        </Box>
      </Box>

      {visible.length === 0 ? (
        <Box marginTop={1}>
          <Text color={Colors.muted}>
            no matches — keep typing or press n to create one
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {visible.map(({ entry }, i) => {
            const isFocused = i === safeIndex;
            return (
              <Box key={entry.id}>
                <Text color={isFocused ? Colors.accent : Colors.subtle}>
                  {isFocused ? cursorGlyph : ' '}
                </Text>
                <Text color={isFocused ? Colors.heading : Colors.body}>
                  {' '}
                  {entry.name}
                </Text>
                <Text color={Colors.muted}>
                  {'  '}
                  {entry.orgName}
                  {entry.envName ? ` · ${entry.envName}` : ''}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {hiddenCount > 0 && (
        <Box marginTop={1}>
          <Text color={Colors.muted}>
            showing {visible.length} of {totalMatches} — keep typing to narrow
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.muted}>
          {Icons.dot} ↑↓ select · Enter to choose
          {onCreate ? ' · n to create new' : ''} · Esc to cancel
        </Text>
      </Box>
    </Box>
  );
};

/* ─── Inline new-project sub-form ──────────────────────────────────── */

interface NewProjectInlineFormProps {
  onCancel: () => void;
  onCreate: (input: { name: string; envName: string }) => void;
}

const NewProjectInlineForm = ({
  onCancel,
  onCreate,
}: NewProjectInlineFormProps) => {
  const [phase, setPhase] = useState<'name' | 'env'>('name');
  const [name, setName] = useState('');

  useScreenInput(
    (_input, key) => {
      if (key.escape) {
        onCancel();
      }
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" overflow="hidden">
      <Text bold color={Colors.heading}>
        Create a new project
      </Text>
      {phase === 'name' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={Colors.body}>Project name</Text>
          <TextInput
            placeholder="My new project"
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (!trimmed) return;
              setName(trimmed);
              setPhase('env');
            }}
          />
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text color={Colors.body}>Environment name</Text>
          <Text color={Colors.muted}>
            e.g. Production. Enter to confirm, Esc to cancel.
          </Text>
          <TextInput
            placeholder="Production"
            onSubmit={(value) => {
              const trimmed = value.trim() || 'Production';
              onCreate({ name, envName: trimmed });
            }}
          />
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={Colors.muted}>{Icons.dot} Esc to cancel</Text>
      </Box>
    </Box>
  );
};
