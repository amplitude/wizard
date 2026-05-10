/**
 * Terminal rendering utilities — pure-string helpers for rich terminal output.
 *
 * Each function returns an ANSI-styled string consumable by Ink's <Text>.
 * No React/Ink dependencies — this module is framework-agnostic.
 */

import terminalLink from 'terminal-link';
import gradient from 'gradient-string';
import { highlight } from 'cli-highlight';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { Brand } from '../styles.js';

// ── Clickable hyperlinks ───────────────────────────────────────────────

/**
 * Create a clickable terminal hyperlink with graceful fallback.
 * In unsupported terminals, returns just the URL when text matches,
 * or "text (url)" when they differ.
 */
export function makeLink(text: string, url: string): string {
  return terminalLink(text, url, {
    fallback: (text, url) => (text === url ? url : `${text} (${url})`),
  });
}

// Markdown link: [label](url) — label is any non-bracket run, url is non-space
// non-paren. Used before the bare-URL pass so we don't double-wrap.
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

// Bare http(s) URL. Stops at whitespace, quotes, brackets, parens, and the
// NUL placeholder sentinel used by the markdown pass so we don't swallow
// JSON/markdown artifacts or already-linkified placeholders. Trailing
// punctuation is stripped after the match so links at end of a sentence
// still work.
const BARE_URL_RE = /https?:\/\/[^\s"'<>()[\]{}\0]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?)>\]]+$/;

/**
 * Replace `[label](url)` markdown links and bare `http(s)://…` URLs with OSC 8
 * clickable hyperlinks. Safe to call on plain strings — returns the input
 * unchanged if no URLs are present. Already-wrapped markdown links are handled
 * in the first pass so the bare-URL pass does not double-wrap their targets.
 */
export function linkify(text: string): string {
  const placeholder = '\u0000LINKIFIED\u0000';
  const wrapped: string[] = [];

  const afterMarkdown = text.replace(
    MARKDOWN_LINK_RE,
    (_match: string, label: string, url: string) => {
      wrapped.push(makeLink(label, url));
      return `${placeholder}${wrapped.length - 1}${placeholder}`;
    },
  );

  const afterBare = afterMarkdown.replace(BARE_URL_RE, (url: string) => {
    const trailing = url.match(TRAILING_PUNCT_RE)?.[0] ?? '';
    const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;
    return makeLink(cleanUrl, cleanUrl) + trailing;
  });

  return afterBare.replace(
    new RegExp(`${placeholder}(\\d+)${placeholder}`, 'g'),
    (_match: string, idx: string) => wrapped[Number(idx)],
  );
}

// ── Brand gradient ─────────────────────────────────────────────────────

const brandGrad = gradient([Brand.blue, Brand.lilac, Brand.violet]);

/** Apply the Amplitude brand gradient (blue → lilac → violet) to text. */
export function brandGradient(text: string): string {
  return brandGrad(text);
}

// ── Syntax highlighting ────────────────────────────────────────────────

/**
 * Syntax-highlight a code string for terminal display.
 * Returns the original string if highlighting fails.
 */
function highlightCode(code: string, language?: string): string {
  try {
    return highlight(code, { language, ignoreIllegals: true });
  } catch {
    return code;
  }
}

// ── Markdown rendering ─────────────────────────────────────────────────

/** Convert a hex color to an ANSI 24-bit foreground escape sequence. */
function hexToAnsi(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Build a Marked instance scoped to a particular reflow / table width.
 *
 * Two width-related fixes baked in here, both visible on the Setup
 * Report (`amplitude-setup-report.md`) which is the most common
 * markdown surface the wizard renders:
 *
 *   1. cli-table3's default `style.head` is `['red']`, which makes
 *      every Markdown table header render bright red — read by users
 *      as "error" since red carries that semantic everywhere else in
 *      the UI. Override `style.head` to bold-only and `style.border`
 *      to plain so the table reads as supporting chrome, not an error
 *      indicator. The body cells get the brand body color.
 *
 *   2. Markdown tables produced by the agent (Event / Description /
 *      File rows) are commonly wider than the terminal viewport.
 *      cli-table3 emits a single fixed-width line per row regardless
 *      of viewport, so when ReportViewer renders it inside a
 *      `<Text wrap="truncate">`, EVERY row gets a stray "…" glyph at
 *      the right edge. Constraining `colWidths` to the visible width
 *      and enabling `wordWrap: true` lets the table fit and removes
 *      the trailing-ellipsis decoration.
 *
 * `width` is in terminal columns. Defaults to 100 for non-Ink
 * callers (e.g. unit tests, CLI commands not driven by Ink).
 */
function buildTerminalMarked(width: number): Marked {
  // Reserve a few columns for ConsoleView padding / outer borders so
  // the table never quite reaches the right edge — matches how the
  // rest of the TUI lays out content.
  const renderWidth = Math.max(40, width - 4);

  // 4-column breakdown for the Setup Report's primary table (Event,
  // Description, File). We don't know the column count statically, so
  // we hand cli-table3 a generous max and let `wordWrap` reflow within
  // each cell. cli-table3 ignores `colWidths` entries past the column
  // count, so over-specifying is safe.
  //
  // ── Narrow-terminal floor handling ─────────────────────────────────
  // Naive `Math.max(MIN, percent)` floors on every column blow past
  // `renderWidth` once the floors sum to more than the viewport (14 +
  // 20 + 20 + 9 chrome = 63 cols, which overflows any terminal under
  // ~67 columns). Compute the unfloored proportional widths first; if
  // their sum already fits, we apply the comfortable floors. If it
  // would overflow, we fall back to splitting `renderWidth - chrome`
  // proportionally with NO floors so the rendered table never exceeds
  // the available width — narrow terminals show a cramped-but-fitting
  // table instead of one that bleeds past the right edge.
  const TABLE_CHROME_COLS = 9; // 4 vertical bars + 6 cell paddings
  const usableWidth = Math.max(0, renderWidth - TABLE_CHROME_COLS);
  const idealEvent = Math.floor(renderWidth * 0.18);
  const idealFile = Math.floor(renderWidth * 0.32);
  const idealDesc = usableWidth - idealEvent - idealFile;
  const flooredSum =
    Math.max(14, idealEvent) +
    Math.max(20, idealFile) +
    Math.max(20, idealDesc);
  const fitsWithFloors = flooredSum <= usableWidth;
  const eventCol = fitsWithFloors ? Math.max(14, idealEvent) : idealEvent;
  const fileCol = fitsWithFloors ? Math.max(20, idealFile) : idealFile;
  // Description column absorbs any rounding remainder so the three
  // columns add up to exactly `usableWidth`.
  const descCol = fitsWithFloors
    ? Math.max(20, usableWidth - eventCol - fileCol)
    : Math.max(1, usableWidth - eventCol - fileCol);

  const m = new Marked();
  m.use(
    markedTerminal({
      firstHeading: (s: string) =>
        `\x1b[1m${hexToAnsi(Brand.blueOnDark)}${s}\x1b[0m`,
      heading: (s: string) => `\x1b[1m${hexToAnsi(Brand.lilac)}${s}\x1b[0m`,
      showSectionPrefix: false,
      reflowText: true,
      width: renderWidth,
      tableOptions: {
        // Override cli-table3's red default head + greyed border so
        // the table reads as neutral chrome, not error state.
        style: {
          head: [], // bold-only via marked-terminal's own table wrap
          border: [],
          'padding-left': 1,
          'padding-right': 1,
        },
        colWidths: [eventCol, descCol, fileCol],
        wordWrap: true,
      },
    }) as Parameters<typeof m.use>[0],
  );
  return m;
}

// Default instance for non-width-aware callers. The ReportViewer
// path passes its own width via `renderMarkdown(md, cols)`.
const defaultTerminalMarked = buildTerminalMarked(100);

/**
 * Render a markdown string to ANSI-styled terminal output.
 * Supports headings, code blocks, tables, lists, bold/italic, and links.
 *
 * @param md     Markdown source.
 * @param width  Terminal columns to fit the output to. When omitted,
 *               renders against a 100-column default — fine for
 *               anything that isn't trying to fit the actual viewport.
 */
export function renderMarkdown(md: string, width?: number): string {
  const m =
    typeof width === 'number' && width > 0
      ? buildTerminalMarked(width)
      : defaultTerminalMarked;
  return m.parse(md) as string;
}
