/**
 * OSC 8 hyperlink escape sequence.
 *
 * Wraps `label` so supporting terminals (iTerm2, WezTerm, Ghostty, Kitty,
 * recent Terminal.app, modern VS Code) render it as a clickable link to `url`.
 * Terminals that don't support OSC 8 render only the label, so this is safe
 * to emit unconditionally. We also keep the raw URL in the label so terminals
 * that do URL auto-detection (without OSC 8) still make it cmd-clickable.
 */
const ESC = '\x1b';
const ST = `${ESC}\\`;

export function osc8Link(url: string, label: string = url): string {
  return `${ESC}]8;;${url}${ST}${label}${ESC}]8;;${ST}`;
}
