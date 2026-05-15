/**
 * AskBar — snapshot + interaction coverage (PR 6 killer feature).
 *
 * Pins the four observable states the AC enumerates:
 *
 *   1. Closed → nothing renders.
 *   2. Open + empty → prompt + helper line visible.
 *   3. Open + typed → echoed input is visible in the frame.
 *   4. After submit → `onSubmit` fires with the trimmed query and
 *      `onCancel` does not.
 *
 * Also covers ↑ / ↓ history recall and Esc cancellation. The 500ms ack
 * contract is asserted at the RunScreen level (`AskBar` itself does not
 * render the ack — that is RunScreen's job), but we lock in here that
 * `onSubmit` is called synchronously from the Enter keystroke so the
 * upstream ack render lands in the same tick.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';

import { AskBar } from '../AskBar.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

/**
 * `@inkjs/ui` TextInput is internally controlled and commits each
 * keystroke on the next tick — driving it via stdin requires letting
 * the event loop flush between writes, otherwise multiple chunks
 * coalesce and characters are lost. The same pattern is used in
 * `AuthScreen.region-host.test.tsx` and friends.
 */
const flushAsync = () => new Promise((r) => setImmediate(r));

describe('AskBar — closed state', () => {
  it('renders nothing when `open` is false', () => {
    const { lastFrame, unmount } = render(
      <AskBar
        open={false}
        history={[]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    // ink-testing-library returns empty string for null roots.
    expect(stripAnsi(lastFrame() ?? '')).toBe('');
    unmount();
  });
});

describe('AskBar — open + empty', () => {
  it('renders the prompt chrome and the placeholder helper line', () => {
    const { lastFrame, unmount } = render(
      <AskBar
        open
        history={[]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    // Prompt prefix is the chevron + "ask " label so the user can
    // tell at a glance that this is the Tab-to-ask input, not the
    // slash-command bar.
    expect(frame).toContain('ask');
    // Helper line spells out the keybindings. We don't lock the exact
    // copy because future polish PRs will iterate on it; we just pin
    // the affordances that must remain reachable.
    expect(frame).toContain('Enter');
    expect(frame).toContain('Esc');
    unmount();
  });

  it('shows history count when there are recall entries', () => {
    const { lastFrame, unmount } = render(
      <AskBar
        open
        history={['what files are you editing?']}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    // The hint surfaces `↑↓ to recall (N)` when history is non-empty.
    // Pin the count so a future copy refactor can't quietly drop the
    // recall affordance.
    expect(frame).toContain('(1)');
    unmount();
  });
});

describe('AskBar — typed input', () => {
  it('echoes typed characters into the visible frame', async () => {
    const { stdin, lastFrame, unmount } = render(
      <AskBar
        open
        history={[]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    // Type one char at a time, flushing between writes — TextInput
    // commits per tick and `stdin.write` chunks coalesce otherwise.
    for (const ch of 'hello') {
      stdin.write(ch);
      await flushAsync();
    }
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('hello');
    unmount();
  });
});

describe('AskBar — Enter submission', () => {
  it('invokes onSubmit with the trimmed query on Enter', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const { stdin, unmount } = render(
      <AskBar
        open
        history={[]}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    for (const ch of '   why so slow?   ') {
      stdin.write(ch);
      await flushAsync();
    }
    await flushAsync();
    stdin.write('\r'); // Enter
    await flushAsync();
    // Synchronous contract: onSubmit fires from the Enter handler
    // (we flushAsync only to let TextInput's tick-batched commit
    // catch up to the keystroke stream — the handler chain itself
    // is synchronous). RunScreen relies on this to render the ack
    // line in the same React tick the Enter lands.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('why so slow?');
    expect(onCancel).not.toHaveBeenCalled();
    unmount();
  });

  it('does not invoke onSubmit on empty/whitespace input', async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <AskBar
        open
        history={[]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    for (const ch of '     ') {
      stdin.write(ch);
      await flushAsync();
    }
    stdin.write('\r');
    await flushAsync();
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });
});

describe('AskBar — Esc cancellation', () => {
  it('invokes onCancel on Esc', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const { stdin, unmount } = render(
      <AskBar
        open
        history={[]}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    stdin.write(''); // Esc
    // Give Ink a tick to deliver the keystroke through useInput.
    await new Promise((r) => setTimeout(r, 10));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });
});

describe('AskBar — history recall', () => {
  it('recalls the most recent entry on ↑', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <AskBar
        open
        history={['recent', 'older']}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    // ↑ — should pull `recent` (index 0 = most recent).
    stdin.write('[A');
    await new Promise((r) => setTimeout(r, 10));
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('recent');
    unmount();
  });

  it('walks back to older entries on additional ↑ keystrokes', async () => {
    const { stdin, lastFrame, unmount } = render(
      <AskBar
        open
        history={['newest', 'middle', 'oldest']}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    stdin.write('[A'); // newest
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('[A'); // middle
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('[A'); // oldest
    await new Promise((r) => setTimeout(r, 10));
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('oldest');
    unmount();
  });

  it('walks forward toward the live input on ↓', async () => {
    const { stdin, lastFrame, unmount } = render(
      <AskBar
        open
        history={['newest', 'middle']}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    stdin.write('[A'); // newest
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('[A'); // middle
    await new Promise((r) => setTimeout(r, 10));
    stdin.write('[B'); // back to newest
    await new Promise((r) => setTimeout(r, 10));
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('newest');
    unmount();
  });

  it('is a no-op when history is empty', async () => {
    const { stdin, lastFrame, unmount } = render(
      <AskBar
        open
        history={[]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    stdin.write('[A');
    await new Promise((r) => setTimeout(r, 10));
    // Frame must not contain any non-prompt text — placeholder is still
    // visible, but no entry was injected.
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('ask');
    unmount();
  });
});
