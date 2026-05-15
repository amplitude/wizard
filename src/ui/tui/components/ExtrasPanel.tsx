/**
 * ExtrasPanel — shared MCP / Slack / Session Replay surface.
 *
 * PR 8 of the Timeline UX redesign. Promotes the three "extras" we
 * previously surfaced only at the end of a run to first-class citizens
 * across the wizard. Renders a compact, state-aware row per item with a
 * consistent glyph + color contract so the same component can sit in:
 *
 *   - IntroScreen (returning-user variant) — "here's what's queued"
 *   - EventPlanFullScreen — one-line "also queued" footer
 *   - RunScreen — live state alongside the timeline
 *   - DataIngestionCheckScreen — "offer to install while you wait"
 *   - OutroScreen — final receipt
 *
 * State matrix (kind × state → glyph + color):
 *
 *   available / queued → Brand.lilac, ◆ (or `*` ASCII)
 *   installing         → Brand.blue,  spinner left of label
 *   done               → Brand.lilac, ✓ (or `*` ASCII)
 *   skipped            → Brand.muted, ○ (or `o` ASCII)
 *
 * Color is NEVER load-bearing on its own — every state has a distinct
 * glyph so the panel stays readable in low-color terminals (and the ASCII
 * fallback covers terminals that mangle the UTF-8 diamond / check).
 *
 * Gated everywhere it's integrated on `WIZARD_NEW_UX === '1'` so legacy
 * flows are byte-identical until the env flag is set.
 */

import { Box, Text } from 'ink';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrailleSpinner } from './BrailleSpinner.js';
import { Brand, Colors } from '../styles.js';
import { Integration } from '../../../lib/constants.js';

// ── Public types ────────────────────────────────────────────────────

export type ExtraState =
  | 'available'
  | 'queued'
  | 'installing'
  | 'done'
  | 'skipped';

export type ExtraKind = 'mcp' | 'slack' | 'session-replay';

export interface ExtraItem {
  kind: ExtraKind;
  label: string;
  state: ExtraState;
  detail?: string;
}

export interface ExtrasPanelProps {
  items: ExtraItem[];
  /**
   * When true, render ASCII-safe glyphs (`*`, `o`) instead of UTF-8
   * (◆, ○, ✓). Lets callers opt in to plain-text rendering for
   * snapshot determinism or environments that mangle BMP glyphs.
   */
  ascii?: boolean;
  /**
   * Optional title rendered above the rows. When omitted, the panel
   * is a bare list — the calling screen owns its own framing copy.
   */
  title?: string;
}

// ── Framework gating (Session Replay) ──────────────────────────────

/**
 * Web frameworks where Session Replay applies. Native / backend
 * integrations omit SR from the panel entirely — the SDK isn't even
 * available there, so surfacing it would be a lie.
 *
 * Hard-coded here (rather than a flag on FrameworkConfig) because:
 *   - it's a tight, stable list (changes ~yearly when a new web
 *     framework lands), and
 *   - making the panel responsible for crossing a registry layer
 *     would couple ExtrasPanel to the whole framework subsystem just
 *     to render three lines.
 *
 * If you add a new web framework, append it here.
 */
export const WEB_FRAMEWORKS: ReadonlySet<Integration> = new Set([
  Integration.nextjs,
  Integration.vue,
  Integration.reactRouter,
  Integration.javascript_web,
]);

/**
 * Filter a candidate items array to those compatible with the given
 * integration. Today only Session Replay is gated; other extras pass
 * through unchanged.
 */
export function filterExtrasByFramework(
  items: ExtraItem[],
  integration: Integration | null | undefined,
): ExtraItem[] {
  return items.filter((item) => {
    if (item.kind !== 'session-replay') return true;
    if (!integration) return false;
    return WEB_FRAMEWORKS.has(integration);
  });
}

// ── MCP-client detection (read-only) ───────────────────────────────

export interface McpClientDetection {
  claudeCode: boolean;
  cursor: boolean;
  zed: boolean;
}

/**
 * Detect which MCP-capable AI coding tools the user has installed on
 * this machine. PURE READ — never installs, never mutates a config.
 * The full McpInstaller (services/mcp-installer.ts) does the real
 * install work; this helper only powers the `detail` string on the
 * MCP ExtraItem (e.g. "Claude Code + Cursor detected").
 *
 * Detection rules:
 *
 *   - Claude Code: `~/.claude.json` exists (the global config file
 *     Claude Code writes on first launch).
 *   - Cursor: platform-specific user-data dir exists.
 *       macOS    `~/Library/Application Support/Cursor`
 *       Linux    `~/.config/Cursor`
 *       Windows  `%APPDATA%/Cursor`
 *   - Zed: `~/.config/zed` exists (mac + linux use the same path).
 *
 * Failures (permissions, missing HOME) are swallowed and reported as
 * "not detected" — detection is best-effort, not authoritative.
 */
export function detectMcpClients(): McpClientDetection {
  const home = safeHome();
  return {
    claudeCode: safeExists(path.join(home, '.claude.json')),
    cursor: safeExists(cursorConfigPath(home)),
    zed: safeExists(path.join(home, '.config', 'zed')),
  };
}

function safeHome(): string {
  try {
    return os.homedir() ?? '';
  } catch {
    return '';
  }
}

function safeExists(p: string): boolean {
  if (!p) return false;
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function cursorConfigPath(home: string): string {
  if (!home) return '';
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData ? path.join(appData, 'Cursor') : '';
  }
  return path.join(home, '.config', 'Cursor');
}

/**
 * Build a short "X + Y detected" detail string from a detection
 * result. Returns null when no clients are detected — callers should
 * fall back to a generic "no AI tools detected" or omit the detail.
 */
export function summarizeMcpDetection(d: McpClientDetection): string | null {
  const names: string[] = [];
  if (d.claudeCode) names.push('Claude Code');
  if (d.cursor) names.push('Cursor');
  if (d.zed) names.push('Zed');
  if (names.length === 0) return null;
  return `${names.join(' + ')} detected`;
}

// ── Rendering ───────────────────────────────────────────────────────

/** Glyph for each state. UTF-8 and ASCII variants kept in lockstep so
 *  the visual hierarchy (filled vs. open) is preserved either way. */
const GLYPHS = {
  utf8: {
    available: '◆',
    queued: '◆',
    installing: '',
    done: '✓',
    skipped: '○',
  },
  ascii: {
    available: '*',
    queued: '*',
    installing: '',
    done: '*',
    skipped: 'o',
  },
} as const;

/**
 * Per-state foreground color. `available` / `queued` and `done` share
 * Brand.lilac on purpose — completed and queued extras read as the
 * same "secondary success" tone; the glyph distinguishes them.
 */
function colorForState(state: ExtraState): string {
  switch (state) {
    case 'available':
    case 'queued':
      return Brand.lilac;
    case 'installing':
      return Brand.blue;
    case 'done':
      return Brand.lilac;
    case 'skipped':
      return Colors.muted;
  }
}

interface RowProps {
  item: ExtraItem;
  ascii: boolean;
}

const Row = ({ item, ascii }: RowProps) => {
  const color = colorForState(item.state);
  const glyphSet = ascii ? GLYPHS.ascii : GLYPHS.utf8;
  const glyph = glyphSet[item.state];

  return (
    <Box gap={1}>
      {item.state === 'installing' ? (
        <BrailleSpinner color={Brand.blue} />
      ) : (
        <Text color={color}>{glyph}</Text>
      )}
      <Text color={color}>{item.label}</Text>
      {item.detail && <Text color={Colors.muted}>— {item.detail}</Text>}
    </Box>
  );
};

export const ExtrasPanel = ({
  items,
  ascii = false,
  title,
}: ExtrasPanelProps) => {
  if (items.length === 0) return null;
  return (
    <Box flexDirection="column" overflow="hidden">
      {title && (
        <Text color={Colors.muted} bold>
          {title}
        </Text>
      )}
      {items.map((item) => (
        <Row key={`${item.kind}:${item.label}`} item={item} ascii={ascii} />
      ))}
    </Box>
  );
};
