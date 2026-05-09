/**
 * /help slash command — text generation tests.
 *
 * Pins the `/help` output so accidental copy regressions trip the
 * test rather than silently shipping a misleading description.
 */
import { describe, it, expect } from 'vitest';
import { COMMANDS, getHelpText } from '../console-commands.js';

describe('getHelpText', () => {
  it('lists every registered command', () => {
    const text = getHelpText(false);
    for (const cmd of COMMANDS) {
      expect(text).toContain(cmd.cmd);
      expect(text).toContain(cmd.desc);
    }
  });

  it('groups commands by run-active vs run-idle', () => {
    const text = getHelpText(false);
    expect(text).toMatch(/Available anytime/);
    expect(text).toMatch(/Available before\/after a setup run/);
  });

  it('switches the run-active section header when a run is active', () => {
    const text = getHelpText(true);
    expect(text).toMatch(/Paused while a setup run is active/);
    expect(text).toMatch(/Ctrl\+C to cancel/);
  });

  it('lists /help itself as a command', () => {
    const text = getHelpText(false);
    expect(text).toContain('/help');
  });

  it('lists /status as a command', () => {
    const text = getHelpText(false);
    expect(text).toContain('/status');
  });

  it('mentions Tab for question shortcut', () => {
    const text = getHelpText(false);
    expect(text).toMatch(/Tab/);
  });
});
