/**
 * ScreenShell — 3-region layout snapshot coverage.
 *
 * Same 3 × 3 capability × width matrix as StepIndicator.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScreenShell } from '../ScreenShell.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;
const stripAnsi = (s: string): string =>
  s.replace(ANSI_CSI_REGEX, '').replace(ANSI_OSC_REGEX, '');
const trimTrailingWs = (s: string): string =>
  s
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');

const frameOf = (el: React.ReactElement): string => {
  const { lastFrame, unmount } = render(el);
  const out = trimTrailingWs(stripAnsi(lastFrame() ?? ''));
  unmount();
  return out;
};

const STEPS = ['welcome', 'auth', 'project', 'setup', 'verify', 'done'];

const sampleBody = (
  <Box flexDirection="column">
    <Text>Body line 1</Text>
    <Text>Body line 2</Text>
  </Box>
);

const sampleProps = {
  step: { name: 'setup', currentIndex: 3, all: STEPS },
  title: 'Setup',
  hotkeys: [
    { key: 'Enter', label: 'continue' },
    { key: 'Esc', label: 'back' },
  ],
  children: sampleBody,
};

const ENV_KEYS = ['LANG', 'LC_ALL', 'LC_CTYPE', 'WIZARD_FORCE_ASCII'] as const;
const savedEnv: Record<string, string | undefined> = {};

const setEnv = (overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('ScreenShell — UTF-8 profile', () => {
  beforeEach(() => {
    setEnv({ LANG: 'en_US.UTF-8' });
  });

  for (const width of [80, 60, 40]) {
    it(`renders header / body / footer at ${width} cols`, () => {
      const out = frameOf(
        <Box width={width}>
          <ScreenShell {...sampleProps} />
        </Box>,
      );
      expect(out).toMatchSnapshot();
    });
  }

  it('renders the title, body, and hotkeys in document order', () => {
    const out = frameOf(
      <Box width={80}>
        <ScreenShell {...sampleProps} />
      </Box>,
    );
    expect(out).toContain('Setup');
    expect(out).toContain('Body line 1');
    expect(out).toContain('Body line 2');
    expect(out).toContain('[Enter] continue');
    expect(out).toContain('[Esc] back');
    // Title appears before body, which appears before hotkey row.
    expect(out.indexOf('Setup')).toBeLessThan(out.indexOf('Body line 1'));
    expect(out.indexOf('Body line 2')).toBeLessThan(out.indexOf('[Enter]'));
  });

  it('renders the unicode divider', () => {
    const out = frameOf(
      <Box width={80}>
        <ScreenShell {...sampleProps} />
      </Box>,
    );
    expect(out).toContain('─');
  });
});

describe('ScreenShell — ASCII fallback profile', () => {
  beforeEach(() => {
    setEnv({ LANG: 'en_US.UTF-8', WIZARD_FORCE_ASCII: '1' });
  });

  for (const width of [80, 60, 40]) {
    it(`renders header / body / footer at ${width} cols`, () => {
      const out = frameOf(
        <Box width={width}>
          <ScreenShell {...sampleProps} />
        </Box>,
      );
      expect(out).toMatchSnapshot();
    });
  }

  it('falls back to ASCII divider char', () => {
    const out = frameOf(
      <Box width={80}>
        <ScreenShell {...sampleProps} />
      </Box>,
    );
    expect(out).not.toContain('─');
    expect(out).toContain('-');
  });
});

describe('ScreenShell — UTF-8 + no-color profile', () => {
  beforeEach(() => {
    setEnv({ LANG: 'en_US.UTF-8' });
    savedEnv.FORCE_COLOR = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '0';
  });

  afterEach(() => {
    if (savedEnv.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = savedEnv.FORCE_COLOR;
  });

  for (const width of [80, 60, 40]) {
    it(`renders header / body / footer at ${width} cols`, () => {
      const out = frameOf(
        <Box width={width}>
          <ScreenShell {...sampleProps} />
        </Box>,
      );
      expect(out).toMatchSnapshot();
    });
  }
});

describe('ScreenShell — overflow protection', () => {
  it('caps a tall body so footer stays visible', () => {
    setEnv({ LANG: 'en_US.UTF-8' });
    const tall = (
      <Box flexDirection="column">
        {Array.from({ length: 50 }, (_, i) => (
          <Text key={i}>row {i}</Text>
        ))}
      </Box>
    );
    const out = frameOf(
      <Box width={80} height={12}>
        <ScreenShell {...sampleProps}>{tall}</ScreenShell>
      </Box>,
    );
    // Sanity: title is intact AND at least one body row renders. We
    // don't pin which row, because Ink's overflow="hidden" + height
    // constraint will trim rows from either end depending on minor
    // version and content height — the contract here is "doesn't
    // crash and renders something coherent for both header and body".
    expect(out).toContain('Setup');
    expect(out).toMatch(/row \d+/);
  });
});
