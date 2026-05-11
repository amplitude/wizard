/**
 * GradientText behavior tests.
 *
 * Two surfaces under test:
 *
 *  1. Visible text is preserved — the gradient must not drop or
 *     duplicate characters.
 *  2. Gradient structure — the React tree contains one <Text> per
 *     visible character, each carrying its own `color` prop, with at
 *     least three DISTINCT color values across the headline. We assert
 *     on the React tree (via TestRenderer) rather than the rendered
 *     ANSI frame because under vitest the test runner is non-TTY and
 *     ink/chalk strip color codes. The structural assertion still
 *     catches a regression to a single <Text color=...> (which would
 *     collapse to one distinct color across the tree).
 */

import React from 'react';
import { Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { GradientText } from '../GradientText.js';

interface TextProps {
  color?: string;
  children?: unknown;
}

/**
 * Walk a React element tree and collect every <Text> element's color
 * prop. We inspect the structural JSX rather than rendered ANSI
 * because under vitest the runner is non-TTY and ink/chalk strip color
 * codes; the structural assertion still catches a regression to a
 * single <Text color=...> wrapper.
 */
function collectColors(node: unknown): string[] {
  const acc: string[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    const elem = n as React.ReactElement;
    if (elem.type === Text) {
      const props = elem.props as TextProps;
      if (props.color) acc.push(props.color);
    }
    if (elem.props && (elem.props as { children?: unknown }).children) {
      walk((elem.props as { children?: unknown }).children);
    }
  };
  walk(node);
  return acc;
}

/** Collect the visible characters from the same React element tree. */
function collectText(node: unknown): string {
  let out = '';
  const walk = (n: unknown): void => {
    if (typeof n === 'string') {
      out += n;
      return;
    }
    if (typeof n === 'number') {
      out += String(n);
      return;
    }
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    const elem = n as React.ReactElement;
    if (elem.props && (elem.props as { children?: unknown }).children !== undefined) {
      walk((elem.props as { children?: unknown }).children);
    }
  };
  walk(node);
  return out;
}

describe('GradientText', () => {
  it('renders the supplied text characters in order', () => {
    const view = render(<GradientText>Amplitude is live!</GradientText>);
    const visible = view.lastFrame() ?? '';
    expect(visible).toContain('Amplitude is live!');
    view.unmount();
  });

  it('emits one Text per character, each with its own color, and applies a multi-color gradient', () => {
    const element = <GradientText>Amplitude is live!</GradientText>;
    // GradientText is a function component; invoking the function gives
    // us back the React element tree it would render.
    const rendered = (GradientText as (
      p: typeof element.props,
    ) => React.ReactNode)(element.props);
    const colors = collectColors(rendered);

    // One <Text> per visible character.
    expect(colors.length).toBe('Amplitude is live!'.length);
    // Every color is a hex string.
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    // A gradient by definition produces multiple distinct colors. A
    // regression to a single <Text color=...> would collapse to one.
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThanOrEqual(3);
  });

  it('returns null for empty strings (no Yoga node emitted)', () => {
    const element = <GradientText>{''}</GradientText>;
    const rendered = (GradientText as (
      p: typeof element.props,
    ) => React.ReactNode)(element.props);
    expect(rendered).toBeNull();
  });

  it('honors a custom from/to color pair (pinned endpoint hexes)', () => {
    const element = (
      <GradientText from="#000000" to="#ffffff">
        AB
      </GradientText>
    );
    const rendered = (GradientText as (
      p: typeof element.props,
    ) => React.ReactNode)(element.props);
    const colors = collectColors(rendered);

    expect(collectText(rendered)).toBe('AB');
    expect(colors).toEqual(['#000000', '#ffffff']);
  });
});
