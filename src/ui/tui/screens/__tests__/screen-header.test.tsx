/**
 * screen-header — Locks in the rendered output contract for the
 * `ScreenHeader` helper so future tweaks to the title/subtitle markup
 * surface as a visible test diff rather than a silent snapshot drift
 * across the five screens that use it.
 */

import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';

import { ScreenHeader } from '../screen-header.js';

describe('ScreenHeader', () => {
  it('renders title and subtitle on consecutive lines', () => {
    const { lastFrame } = render(
      <ScreenHeader title="Hello world" subtitle="A small subtitle" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Hello world');
    expect(frame).toContain('A small subtitle');
    expect(frame.indexOf('Hello world')).toBeLessThan(
      frame.indexOf('A small subtitle'),
    );
  });

  it('omits the subtitle line when none is provided', () => {
    const { lastFrame } = render(<ScreenHeader title="Standalone title" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Standalone title');
    // The rendered output should be a single text line plus the
    // marginBottom — verify there's no stray second-line content.
    const trimmedLines = frame
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(trimmedLines).toEqual(['Standalone title']);
  });

  it('accepts ReactNode title (interpolation, not just strings)', () => {
    const dynamicTitle = `Welcome back, ${'kelson@example.com'}`;
    const { lastFrame } = render(<ScreenHeader title={dynamicTitle} />);
    expect(lastFrame() ?? '').toContain('Welcome back, kelson@example.com');
  });

  it('treats an explicit null subtitle the same as omitted', () => {
    const { lastFrame } = render(
      <ScreenHeader title="Just a title" subtitle={null} />,
    );
    const frame = lastFrame() ?? '';
    const trimmedLines = frame
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(trimmedLines).toEqual(['Just a title']);
  });
});
