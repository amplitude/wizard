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

// marked-terminal's types declare the return as a Renderer, but at runtime it
// produces a valid MarkedExtension. Cast to satisfy marked.use().
marked.use(
  markedTerminal({
    firstHeading: (s: string) => `\x1b[1m\x1b[38;2;64;131;255m${s}\x1b[0m`,
    heading: (s: string) => `\x1b[1m\x1b[38;2;105;128;255m${s}\x1b[0m`,
    showSectionPrefix: false,
    reflowText: true,
    width: 100,
  }) as Parameters<typeof marked.use>[0],
);

/**
 * Render a markdown string to ANSI-styled terminal output.
 * Supports headings, code blocks, tables, lists, bold/italic, and links.
 */
export function renderMarkdown(md: string): string {
  return marked.parse(md) as string;
}
