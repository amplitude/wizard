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

import { stripAnsi } from '../../__tests__/helpers/strip-ansi.js';

const sanitize = (frame: string | undefined): string =>
  stripAnsi(frame ?? '')
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

    // `/de` filters to /debug only. The first match is highlighted by
    // default — Tab should accept it. We use `/de` rather than `/d`
    // because new commands like `/diff` later landed on main and would
    // otherwise sort ahead of /debug, breaking the assertion when this
    // branch merges with main.
    view.stdin.write('/de');
    await waitForFrame();
    view.stdin.write(TAB);
    await waitForFrame();

    const frameAfterTab = sanitize(view.lastFrame());
    // The first cmd-prefix match for `/de` is /debug.
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

    // Use a self-contained commands list so the test doesn't depend on
    // the COMMANDS-array ordering (which can shift when new commands
    // like /diff/help land between branches).
    const testCommands = [
      { cmd: '/foo-first', desc: 'first option' },
      { cmd: '/foo-second', desc: 'second option' },
    ];

    const view = render(
      <SlashCommandInput
        commands={testCommands}
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
    view.stdin.write('f');
    await waitForFrame();
    await waitForFrame();
    // Move highlight from /foo-first → /foo-second.
    view.stdin.write(DOWN);
    await waitForFrame();
    await waitForFrame();
    view.stdin.write(TAB);
    await waitForFrame();
    await waitForFrame();

    const frameAfterTab = sanitize(view.lastFrame());
    expect(frameAfterTab).toContain('/foo-second');

    view.stdin.write('\r');
    await waitForFrame();
    expect(submitted).toBe('/foo-second');
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

  it('preserves args when submitting a command with arguments', async () => {
    // Regression for Bugbot 3220907967: typing `/feedback hello world`
    // and pressing Enter previously submitted just `/feedback` because
    // the filter keyed off the first word and the Enter handler
    // preferred `filtered[clampedIndex].cmd` whenever it was non-empty.
    // Argv was silently dropped for `/feedback` and `/create-project`.
    // The fix: Enter distinguishes command-only (no space) from
    // command-with-args (space present) — the latter submits verbatim.
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

    // Type the whole command + args, then Enter.
    for (const ch of '/feedback hello world') {
      view.stdin.write(ch);
      await waitForFrame();
    }
    // Extra frame between the last character and Enter so ink commits
    // the final 'd' before the '\r' is processed (otherwise they coalesce
    // and the submitted value is the value-before-last-keystroke).
    await waitForFrame();
    view.stdin.write('\r');
    await waitForFrame();
    await waitForFrame();

    expect(submitted).toBe('/feedback hello world');
    view.unmount();
  });

  it('palette-picks when Enter is pressed on a partial command (no args)', async () => {
    // Companion to the regression test above: typing `/he` and pressing
    // Enter should still submit the highlighted match (`/help`).
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

    for (const ch of '/he') {
      view.stdin.write(ch);
      await waitForFrame();
    }
    await waitForFrame();
    view.stdin.write('\r');
    await waitForFrame();
    await waitForFrame();

    expect(submitted).toBe('/help');
    view.unmount();
  });

  it('submits exact command verbatim when Enter is pressed (no args)', async () => {
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

    for (const ch of '/help') {
      view.stdin.write(ch);
      await waitForFrame();
    }
    await waitForFrame();
    view.stdin.write('\r');
    await waitForFrame();
    await waitForFrame();

    expect(submitted).toBe('/help');
    view.unmount();
  });

  it('submits trailing-space command verbatim (treated as command-with-empty-args)', async () => {
    // After Tab completion fills `/feedback ` (trailing space), pressing
    // Enter immediately should submit `/feedback` verbatim (the trailing
    // space is trimmed by `value.trim()`). The downstream parser handles
    // "missing required arg" UX — we don't want the palette pick to
    // override the user's explicit `/cmd ` typed value. Documenting the
    // choice here: trailing-space-without-args submits verbatim, not
    // palette-picked, because the presence of a space signals intent to
    // pass args even when none are typed yet. Bugbot 3221028494: detect
    // hasArgs on the *untrimmed* value so the trailing space survives.
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

    for (const ch of '/feedback ') {
      view.stdin.write(ch);
      await waitForFrame();
    }
    await waitForFrame();
    view.stdin.write('\r');
    await waitForFrame();
    await waitForFrame();

    // `value.trim()` strips the trailing space, so the submitted value
    // is `/feedback` — but it took the "command-with-args" branch
    // (because `value` contained a space before trim), not the palette
    // pick branch. Either way the user-visible result is `/feedback`.
    expect(submitted).toBe('/feedback');
    view.unmount();
  });

  it('partial command with trailing space submits verbatim (no palette-pick promotion)', async () => {
    // Regression for Bugbot 3221028494. Before the fix, `hasArgs` was
    // computed on the trimmed value, so `/de ` (partial cmd + space)
    // was indistinguishable from `/de` and would silently palette-pick
    // `/debug`. After the fix, the trailing space signals "I'm typing
    // args" — Enter must submit `/de` verbatim (downstream will report
    // "Unknown command: /de"), not silently expand to `/debug`.
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

    for (const ch of '/de ') {
      view.stdin.write(ch);
      await waitForFrame();
    }
    await waitForFrame();
    view.stdin.write('\r');
    await waitForFrame();
    await waitForFrame();

    expect(submitted).toBe('/de');
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
