/**
 * SlashCommandInput Tab-autocomplete pinning test.
 *
 * Pre-fix behavior: pressing Tab inside the slash-command picker was
 * silently ignored (`if (key.tab) return;`). The KeyHintBar advertises
 * Tab as "Ask a question", but inside the picker we want CLI-style
 * autocomplete instead: extend the input to the longest common prefix
 * of the currently filtered candidates.
 *
 * Asserts:
 *   - `/d` + Tab is a no-op (no common prefix beyond `/d` exists across
 *     /debug + /diagnostics).
 *   - `/diag` + Tab extends to `/diagnostics` (single candidate).
 *   - Tab with no filtered options is a no-op (no commands match).
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { SlashCommandInput } from '../SlashCommandInput.js';
import { COMMANDS } from '../../console-commands.js';
import { waitForFrame } from '../../__tests__/ink-stdin.js';

const commands = COMMANDS.map((c) => ({ cmd: c.cmd, desc: c.desc }));

const TAB = '\t';

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

describe('SlashCommandInput Tab autocomplete', () => {
  it('extends input to the longest common prefix when ambiguous', async () => {
    // Capture submitted value so we can confirm Enter still fires the
    // expected command after autocomplete.
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

    view.stdin.write('/d');
    await waitForFrame();

    // Tab with `/d`: ambiguous between /debug + /diagnostics; LCP is
    // already `/d`, so the input should be unchanged.
    view.stdin.write(TAB);
    await waitForFrame();

    const frameAfterFirstTab = sanitize(view.lastFrame());
    expect(frameAfterFirstTab).toContain('/d');
    // We should still see at least two filtered candidates.
    expect(frameAfterFirstTab).toContain('/debug');
    expect(frameAfterFirstTab).toContain('/diagnostics');

    // Keep typing — `/diag` filters to /diagnostics only. Tab now
    // completes to `/diagnostics`.
    view.stdin.write('iag');
    await waitForFrame();
    view.stdin.write(TAB);
    await waitForFrame();

    const frameAfterSecondTab = sanitize(view.lastFrame());
    expect(frameAfterSecondTab).toContain('/diagnostics');

    // Hit Enter — the picker submits the highlighted command.
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
});
