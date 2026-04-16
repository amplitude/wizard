/**
 * Terminal rendering utilities — pure-string helpers for rich terminal output.
 *
 * Each function returns an ANSI-styled string consumable by Ink's <Text>.
 * No React/Ink dependencies — this module is framework-agnostic.
 */

import terminalLink from 'terminal-link';
import gradient from 'gradient-string';
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

// ── Brand gradient ─────────────────────────────────────────────────────

const brandGrad = gradient([Brand.blue, Brand.lilac, Brand.violet]);

/** Apply the Amplitude brand gradient (blue → lilac → violet) to text. */
export function brandGradient(text: string): string {
  return brandGrad(text);
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
