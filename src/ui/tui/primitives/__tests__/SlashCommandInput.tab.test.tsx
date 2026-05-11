/**
 * SlashCommandInput Tab-accept tests.
 *
 * Pre-change behavior: Tab in the slash palette extended the input to
 * the longest common prefix of the currently filtered candidates
 * (`/diag` + Tab → `/diagnostics`). That was a useful but uncommon
 * affordance — Raycast, Slack, and most modern command palettes treat
 * Tab as "accept the highlighted suggestion".
 *
 * Post-change behavior (this file): Tab replaces the input with the
 * currently highlighted command + a trailing space, leaving the
 * palette open so the user can keep typing arguments or hit Enter to
 * submit.
 *
 * Asserts:
 *   - `/d` + Tab fills in the first highlighted match (`/debug`) + space.
 *   - Selecting a different match with ↓ then Tab completes that match.
 *   - Tab with no filtered matches is swallowed (no-op).
 *   - Enter after Tab submits the completed command.
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { SlashCommandInput } from '../SlashCommandInput.js';
import { COMMANDS } from '../../console-commands.js';
import { waitForFrame } from '../../__tests__/ink-stdin.js';

const commands = COMMANDS.map((c) => ({ cmd: c.cmd, desc: c.desc }));

const TAB = '\t';
const DOWN = '[B';

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;

const sanitize = (frame: string | undefined): string =>
  (frame ?? '')
    .replace(ANSI_REGEX, '')
    .replace(ANSI_OSC_REGEX, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');

describe('SlashCommandInput Tab accepts highlighted suggestion', () => {
  it('fills the input with the highlighted command + space', async () => {
    let submitted: string | null = null;

    const view = render(
      <SlashCommandInput
        commands={commands}
        isActive
        onSubmit={(v) => {
          submitted = v;
        }}
        onDeactivate={() => {}}
      />,
    );
    await waitForFrame();
    await waitForFrame();

    // `/d` filters to /debug + /diagnostics. The first match is
    // highlighted by default — Tab should accept it.
    view.stdin.write('/d');
    await waitForFrame();
    view.stdin.write(TAB);
    await waitForFrame();

    const frameAfterTab = sanitize(view.lastFrame());
    // The first cmd-prefix match for `/d` is /debug (matches before
    // /diagnostics in the COMMANDS array).
    expect(frameAfterTab).toContain('/debug');
    // Palette stays open so the user can keep typing args. Enter
    // submits the completed value.
    view.stdin.write('\r');
    await waitForFrame();

    expect(submitted).toBe('/debug');
    view.unmount();
  });

  it('completes the second match when the user navigates to it', async () => {
    let submitted: string | null = null;

    const view = render(
      <SlashCommandInput
        commands={commands}
        isActive
        onSubmit={(v) => {
          submitted = v;
        }}
        onDeactivate={() => {}}
      />,
    );
    await waitForFrame();
    await waitForFrame();

    // Each keystroke gets its own frame so ink commits and re-renders
    // before the next stdin chunk lands — otherwise the DOWN sequence
    // can race with the trailing Tab and the highlight never moves.
    view.stdin.write('/');
    await waitForFrame();
    view.stdin.write('d');
    await waitForFrame();
    await waitForFrame();
    // Move highlight from /debug → /diagnostics.
    view.stdin.write(DOWN);
    await waitForFrame();
    await waitForFrame();
    view.stdin.write(TAB);
    await waitForFrame();
    await waitForFrame();

    const frameAfterTab = sanitize(view.lastFrame());
    expect(frameAfterTab).toContain('/diagnostics');

    view.stdin.write('\r');
    await waitForFrame();
    expect(submitted).toBe('/diagnostics');
    view.unmount();
  });

  it('is a no-op when no filtered options match', async () => {
    let submitted: string | null = null;

    const view = render(
      <SlashCommandInput
        commands={commands}
        isActive
        onSubmit={(v) => {
          submitted = v;
        }}
        onDeactivate={() => {}}
      />,
    );
    await waitForFrame();
    await waitForFrame();

    // `/zzz` matches nothing; we're outside slash mode entirely. Tab
    // must not crash or mutate input into something unexpected.
    view.stdin.write('/zzz');
    await waitForFrame();
    view.stdin.write(TAB);
    await waitForFrame();

    const frame = sanitize(view.lastFrame());
    expect(frame).toContain('/zzz');

    expect(submitted).toBeNull();
    view.unmount();
  });

  it('renders the palette footer hint when matches exist', async () => {
    const view = render(
      <SlashCommandInput
        commands={commands}
        isActive
        onSubmit={() => {}}
        onDeactivate={() => {}}
      />,
    );
    await waitForFrame();
    await waitForFrame();

    view.stdin.write('/');
    await waitForFrame();

    const frame = sanitize(view.lastFrame());
    expect(frame).toContain('navigate');
    // Tab only completes (fills the input); Enter is what actually runs.
    // Make sure the footer spells them out separately so users don't think
    // Tab will submit (Bugbot 3220814211).
    expect(frame).toContain('Tab complete');
    expect(frame).toContain('Enter run');
    expect(frame).not.toContain('Tab/Enter run');
    expect(frame).toContain('Esc cancel');
    view.unmount();
  });

  it('keeps the palette open after Tab inserts the trailing space', async () => {
    // Regression for Bugbot 3220814221: Tab fills `/debug ` (with trailing
    // space). Before the fix, `query` became "debug " which matched nothing
    // and `filtered` emptied → palette and footer disappeared mid-completion.
    // Filter now keys off the first whitespace-delimited word, so the
    // completed command stays in the visible list.
    const view = render(
      <SlashCommandInput
        commands={commands}
        isActive
        onSubmit={() => {}}
        onDeactivate={() => {}}
      />,
    );
    await waitForFrame();
    await waitForFrame();

    view.stdin.write('/d');
    await waitForFrame();
    view.stdin.write(TAB);
    await waitForFrame();
    await waitForFrame();

    const frame = sanitize(view.lastFrame());
    // Completed command still highlighted in the palette.
    expect(frame).toContain('/debug');
    // Footer still rendered → palette didn't collapse on trailing space.
    expect(frame).toContain('Tab complete');
    expect(frame).toContain('Enter run');
    view.unmount();
  });
});
