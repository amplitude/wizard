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
export function highlightCode(code: string, language?: string): string {
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

// Scoped Marked instance — does not mutate the global singleton.
const terminalMarked = new Marked();
terminalMarked.use(
  markedTerminal({
    firstHeading: (s: string) =>
      `\x1b[1m${hexToAnsi(Brand.blueOnDark)}${s}\x1b[0m`,
    heading: (s: string) => `\x1b[1m${hexToAnsi(Brand.lilac)}${s}\x1b[0m`,
    showSectionPrefix: false,
    reflowText: true,
    width: 100,
  }) as Parameters<typeof terminalMarked.use>[0],
);

/**
 * Render a markdown string to ANSI-styled terminal output.
 * Supports headings, code blocks, tables, lists, bold/italic, and links.
 */
export function renderMarkdown(md: string): string {
  return terminalMarked.parse(md) as string;
}
