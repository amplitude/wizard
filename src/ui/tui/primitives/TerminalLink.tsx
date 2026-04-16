/**
 * TerminalLink — Clickable hyperlink component for Ink.
 *
 * Renders a terminal hyperlink (OSC 8) in supported terminals (iTerm2,
 * VS Code, Hyper, etc.). Falls back to "text (url)" in plain terminals.
 */

import { Text } from 'ink';
import { makeLink } from '../utils/terminal-rendering.js';
import { Colors } from '../styles.js';

interface TerminalLinkProps {
  /** The URL to link to. */
  url: string;
  /** Display text. Defaults to the URL itself. */
  children?: string;
  /** Link color. Defaults to Colors.accent. */
  color?: string;
}

export const TerminalLink = ({ url, children, color }: TerminalLinkProps) => {
  const text = children ?? url;
  return <Text color={color ?? Colors.accent}>{makeLink(text, url)}</Text>;
};
