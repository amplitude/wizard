import { describe, expect, it } from 'vitest';
import { linkify, makeLink } from '../terminal-rendering.js';

function strip(ansi: string): string {
  // eslint-disable-next-line no-control-regex
  return ansi.replace(/\u001b\]8;[^\u0007]*\u0007|\u001b\]8;;\u0007/g, '');
}

describe('linkify', () => {
  it('leaves text without URLs unchanged', () => {
    expect(linkify('nothing to link here')).toBe('nothing to link here');
  });

  it('wraps a bare https URL as a hyperlink', () => {
    const out = linkify('see https://amplitude.com');
    expect(out).toBe(
      `see ${makeLink('https://amplitude.com', 'https://amplitude.com')}`,
    );
  });

  it('wraps a bare http URL as a hyperlink', () => {
    const out = linkify('old http://example.com here');
    expect(out).toContain(makeLink('http://example.com', 'http://example.com'));
  });

  it('converts a markdown link into a labeled hyperlink', () => {
    const out = linkify(
      '[Open in Amplitude](https://app.amplitude.com/chart/abc)',
    );
    expect(out).toBe(
      makeLink('Open in Amplitude', 'https://app.amplitude.com/chart/abc'),
    );
  });

  it('preserves trailing punctuation outside the link target', () => {
    const raw = 'Visit https://amplitude.com.';
    const out = linkify(raw);
    expect(out).toBe(
      `Visit ${makeLink('https://amplitude.com', 'https://amplitude.com')}.`,
    );
    // Trailing period should still be present at the end of the string.
    expect(strip(out).endsWith('https://amplitude.com.')).toBe(true);
  });

  it('extracts URLs embedded in a JSON blob without swallowing the closing quote', () => {
    const raw = '"chartEditUrl":"https://app.amplitude.com/chart/abc"';
    const out = linkify(raw);
    // The URL (without the closing quote) is wrapped.
    expect(out).toContain(
      makeLink(
        'https://app.amplitude.com/chart/abc',
        'https://app.amplitude.com/chart/abc',
      ),
    );
    // The closing quote is preserved.
    expect(strip(out).endsWith('"')).toBe(true);
  });

  it('does not double-wrap a URL that is already inside a markdown link', () => {
    const raw = '[Open](https://app.amplitude.com/chart/abc)';
    const out = linkify(raw);
    // Should produce exactly one OSC 8 start sequence.

    // eslint-disable-next-line no-control-regex
    const starts = out.match(/\u001b\]8;[^\u0007]*\u0007/g) ?? [];
    // terminal-link emits one opening and one closing for each link.
    // If we double-wrapped, we would see two distinct URL escapes.
    const uniqueTargets = new Set(
      starts
        // eslint-disable-next-line no-control-regex
        .map((s) => s.match(/\u001b\]8;;([^\u0007]*)\u0007/)?.[1])
        .filter((u): u is string => !!u && u.length > 0),
    );
    expect(uniqueTargets.size).toBeLessThanOrEqual(1);
  });

  it('handles multiple URLs in one string', () => {
    const raw =
      'first https://a.example/one then [label](https://b.example/two) end';
    const out = linkify(raw);
    expect(out).toContain(
      makeLink('https://a.example/one', 'https://a.example/one'),
    );
    expect(out).toContain(makeLink('label', 'https://b.example/two'));
  });

  it('does not swallow a placeholder when a bare URL abuts a markdown link', () => {
    // Adjacent with no separator — the bare-URL pass must stop at the NUL
    // placeholder sentinel emitted by the markdown pass, otherwise the
    // markdown link is lost during restoration.
    const raw = 'https://a.example[label](https://b.example)';
    const out = linkify(raw);
    expect(out).toContain(makeLink('https://a.example', 'https://a.example'));
    expect(out).toContain(makeLink('label', 'https://b.example'));
    expect(out).not.toContain('LINKIFIED');
    expect(out).not.toContain('\u0000');
  });
});
