/**
 * OutageBanner — unit tests covering the three status states, the
 * glyph-always-present contract, and the 5-minute TTL cache.
 *
 *   - `ok` renders nothing (no chrome reserved for healthy state)
 *   - `degraded` renders a lilac strip with the ⚠ glyph + label
 *   - `down` renders a red strip with the ✗ glyph + label
 *   - cache hits within FETCH_TTL_MS skip the fetcher entirely
 *   - cache expiry past FETCH_TTL_MS re-fetches
 *
 * Color is never the only signal — every degraded/down render asserts
 * both the glyph and the label text are present.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import {
  OutageBanner,
  FETCH_TTL_MS,
  type OutageBannerFetcher,
} from '../OutageBanner.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s: string): string => s.replace(ANSI, '');

async function frameOf(node: React.ReactElement): Promise<string> {
  const { lastFrame, unmount } = render(node);
  // Let the useEffect's async fetcher resolve.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const out = stripAnsi(lastFrame() ?? '');
  unmount();
  return out;
}

describe('OutageBanner', () => {
  it('renders nothing when status is ok', async () => {
    const fetcher: OutageBannerFetcher = vi.fn(() => Promise.resolve('ok'));
    const out = await frameOf(<OutageBanner fetcher={fetcher} />);
    expect(out.trim()).toBe('');
  });

  it('renders the degraded glyph + label when status is degraded', async () => {
    const fetcher: OutageBannerFetcher = vi.fn(() =>
      Promise.resolve('degraded'),
    );
    const out = await frameOf(<OutageBanner fetcher={fetcher} />);
    // Glyph (warning) AND label are both present — color is never the only
    // signal a degraded state carries.
    expect(out).toContain('⚠');
    expect(out).toContain('Amplitude services degraded');
  });

  it('renders the down glyph + label when status is down', async () => {
    const fetcher: OutageBannerFetcher = vi.fn(() => Promise.resolve('down'));
    const out = await frameOf(<OutageBanner fetcher={fetcher} />);
    expect(out).toContain('✗');
    expect(out).toContain('Amplitude services unavailable');
  });

  it('hits the cache within FETCH_TTL_MS and skips the fetcher', async () => {
    const fetcher: OutageBannerFetcher = vi.fn(() => Promise.resolve('down'));
    // Pin time so the cache check is deterministic.
    const now = (() => {
      const t = 1_000_000;
      return () => t;
    })();
    // First render — populates the cache.
    {
      const { lastFrame, unmount } = render(
        <OutageBanner fetcher={fetcher} now={now} />,
      );
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(stripAnsi(lastFrame() ?? '')).toContain('Amplitude services');
      unmount();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Second render within the TTL — fetcher must not be re-invoked.
    {
      const { lastFrame, unmount } = render(
        <OutageBanner fetcher={fetcher} now={now} />,
      );
      // Tick the microtask queue so the effect would have fired if it were
      // going to.
      await new Promise((r) => setImmediate(r));
      // Banner renders synchronously from the cache.
      expect(stripAnsi(lastFrame() ?? '')).toContain('Amplitude services');
      unmount();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after FETCH_TTL_MS expires', async () => {
    let status: 'ok' | 'degraded' | 'down' = 'degraded';
    const fetcher: OutageBannerFetcher = vi.fn(() => Promise.resolve(status));
    let t = 5_000_000;
    const now = () => t;

    // Prime.
    {
      const { unmount } = render(<OutageBanner fetcher={fetcher} now={now} />);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      unmount();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance time past the TTL and flip the underlying status. The next
    // mount must re-fetch and pick up the new value.
    t += FETCH_TTL_MS + 1_000;
    status = 'down';

    const { lastFrame, unmount } = render(
      <OutageBanner fetcher={fetcher} now={now} />,
    );
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(stripAnsi(lastFrame() ?? '')).toContain(
      'Amplitude services unavailable',
    );
    unmount();
  });

  it('renders nothing when the fetcher throws', async () => {
    const fetcher: OutageBannerFetcher = vi.fn(() =>
      Promise.reject(new Error('boom')),
    );
    const out = await frameOf(<OutageBanner fetcher={fetcher} />);
    // Defensive — fetcher failures must never crash the banner. Falls
    // back to the empty "ok" render.
    expect(out.trim()).toBe('');
  });
});
