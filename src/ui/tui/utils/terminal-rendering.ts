/**
 * Terminal rendering utilities — pure-string helpers for rich terminal output.
 *
 * Each function returns an ANSI-styled string consumable by Ink's <Text>.
 * No React/Ink dependencies — this module is framework-agnostic.
 */

import terminalLink from 'terminal-link';
import gradient from 'gradient-string';
import { highlight } from 'cli-highlight';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { Brand } from '../styles.js';

// ── Clickable hyperlinks ───────────────────────────────────────────────

/**
 * Create a clickable terminal hyperlink with graceful fallback.
 * In unsupported terminals, returns "text (url)" or just "url".
 */
export function makeLink(text: string, url: string): string {
  return terminalLink(text, url, {
    fallback: (text, url) => `${text} (${url})`,
  });
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

/** Convert a hex color (e.g. '#4083FF') to an ANSI truecolor escape. */
function hexToAnsi(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

// marked-terminal's types declare the return as a Renderer, but at runtime it
// produces a valid MarkedExtension. Cast to satisfy marked.use().
const md = new marked.Marked();
md.use(
  markedTerminal({
    firstHeading: (s: string) =>
      `\x1b[1m${hexToAnsi(Brand.blueOnDark)}${s}\x1b[0m`,
    heading: (s: string) => `\x1b[1m${hexToAnsi(Brand.lilac)}${s}\x1b[0m`,
    showSectionPrefix: false,
    reflowText: true,
    width: 100,
  }) as Parameters<typeof marked.use>[0],
);

/**
 * Render a markdown string to ANSI-styled terminal output.
 * Supports headings, code blocks, tables, lists, bold/italic, and links.
 */
export function renderMarkdown(input: string): string {
  return md.parse(input) as string;
}
