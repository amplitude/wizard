/**
 * StepIndicator — capability + width snapshot coverage.
 *
 * Covers the three capability profiles called out in the PR plan:
 *   - UTF-8 + truecolor (default)
 *   - UTF-8 + 16-color  (NO_COLOR via FORCE_COLOR=0 / Ink defaults)
 *   - ASCII fallback    (WIZARD_FORCE_ASCII=1)
 *
 * At 80, 60, and 40 columns each.
 */

import React from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StepIndicator } from '../StepIndicator.js';

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

describe('StepIndicator — UTF-8 profile', () => {
  beforeEach(() => {
    setEnv({ LANG: 'en_US.UTF-8' });
  });

  for (const width of [80, 60, 40]) {
    it(`renders unicode glyphs at ${width} cols`, () => {
      const out = frameOf(
        <Box width={width}>
          <StepIndicator steps={STEPS} currentIndex={2} />
        </Box>,
      );
      expect(out).toMatchSnapshot();
    });
  }

  it('marks completed steps with ✓ and future steps with ○', () => {
    const out = frameOf(
      <Box width={80}>
        <StepIndicator steps={STEPS} currentIndex={3} />
      </Box>,
    );
    // Completed (0..2): ✓ welcome, ✓ auth, ✓ project
    expect(out).toContain('✓ welcome');
    expect(out).toContain('✓ auth');
    expect(out).toContain('✓ project');
    // Active (3): ❯ then ● setup
    expect(out).toContain('❯');
    expect(out).toContain('● setup');
    // Future (4..5): ○ verify, ○ done
    expect(out).toContain('○ verify');
    expect(out).toContain('○ done');
  });

  it('renders no active glyph when currentIndex past the end', () => {
    const out = frameOf(
      <Box width={80}>
        <StepIndicator steps={STEPS} currentIndex={STEPS.length} />
      </Box>,
    );
    // Every step rendered as completed
    expect(out).toContain('✓ welcome');
    expect(out).toContain('✓ done');
    expect(out).not.toContain('❯');
    expect(out).not.toContain('● ');
  });
});

describe('StepIndicator — ASCII fallback profile', () => {
  beforeEach(() => {
    setEnv({ LANG: 'en_US.UTF-8', WIZARD_FORCE_ASCII: '1' });
  });

  for (const width of [80, 60, 40]) {
    it(`renders ASCII glyphs at ${width} cols`, () => {
      const out = frameOf(
        <Box width={width}>
          <StepIndicator steps={STEPS} currentIndex={2} />
        </Box>,
      );
      expect(out).toMatchSnapshot();
    });
  }

  it('uses > / * / o glyphs instead of ❯ / ✓ / ●', () => {
    const out = frameOf(
      <Box width={80}>
        <StepIndicator steps={STEPS} currentIndex={3} />
      </Box>,
    );
    expect(out).not.toContain('❯');
    expect(out).not.toContain('✓');
    expect(out).not.toContain('●');
    expect(out).not.toContain('○');
    expect(out).toContain('> ');
    expect(out).toContain('* welcome');
    expect(out).toContain('o setup');
    expect(out).toContain('o verify');
  });
});

describe('StepIndicator — UTF-8 + no-color profile', () => {
  beforeEach(() => {
    // Ink consults FORCE_COLOR=0 to disable color. Combined with UTF-8
    // locale this represents the "monochrome but unicode-capable"
    // profile (e.g. NO_COLOR-respecting CI runner with a UTF-8 locale).
    setEnv({ LANG: 'en_US.UTF-8' });
    savedEnv.FORCE_COLOR = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '0';
  });

  afterEach(() => {
    if (savedEnv.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = savedEnv.FORCE_COLOR;
  });

  for (const width of [80, 60, 40]) {
    it(`renders unicode glyphs sans color at ${width} cols`, () => {
      const out = frameOf(
        <Box width={width}>
          <StepIndicator steps={STEPS} currentIndex={2} />
        </Box>,
      );
      // Glyphs unchanged; absence of color is implicit in the snapshot
      // (we strip ANSI for readability — so color codes never appear
      // anyway). The point is to pin layout under this profile.
      expect(out).toMatchSnapshot();
    });
  }
});
