/**
 * DiscoveryFeed — coverage for the cold-start "insight chips" panel.
 *
 * Locks down the contract:
 *   - Hidden when there are zero facts (no header reserved).
 *   - Hidden on terminals narrower than MIN_COLS_FOR_DISCOVERY_FEED so
 *     RunScreen's responsive layout (#667) keeps working.
 *   - Renders one row per fact with label + value, padded for alignment.
 *   - Caps visible rows at MAX_VISIBLE — older rows slide off the head.
 *   - resolveVisibleCount only counts facts whose discoveredAt has
 *     already arrived (so a future-dated fact stays hidden until the
 *     next tick).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  DiscoveryFeed,
  MIN_COLS_FOR_DISCOVERY_FEED,
  resolveVisibleCount,
} from '../DiscoveryFeed.js';
import type { DiscoveryFact } from '../../../../lib/wizard-session.js';

import { stripAnsi } from '../../__tests__/helpers/strip-ansi.js';

const t0 = 1_700_000_000_000;
const WIDE = 120;

const fact = (
  id: string,
  label: string,
  value: string,
  offsetMs = 0,
): DiscoveryFact => ({
  id,
  label,
  value,
  discoveredAt: t0 + offsetMs,
});

describe('DiscoveryFeed', () => {
  it('renders nothing when facts is empty', () => {
    const { lastFrame } = render(
      <DiscoveryFeed facts={[]} tick={0} cols={WIDE} now={t0 + 1000} />,
    );
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe('');
  });

  it('hides on narrow terminals (responsive guard)', () => {
    const facts = [fact('framework', 'Framework', 'Next.js 15')];
    const { lastFrame } = render(
      <DiscoveryFeed
        facts={facts}
        tick={0}
        cols={MIN_COLS_FOR_DISCOVERY_FEED - 1}
        now={t0 + 1000}
      />,
    );
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe('');
  });

  it('renders the header and each fact row with label + value', () => {
    const facts = [
      fact('framework', 'Framework', 'Next.js 15'),
      fact('package-manager', 'Package manager', 'pnpm', 1),
      fact('typescript', 'TypeScript', 'yes', 2),
    ];
    const { lastFrame } = render(
      <DiscoveryFeed facts={facts} tick={0} cols={WIDE} now={t0 + 1000} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Discovered');
    expect(out).toContain('3 facts');
    expect(out).toContain('Framework');
    expect(out).toContain('Next.js 15');
    expect(out).toContain('Package manager');
    expect(out).toContain('pnpm');
    expect(out).toContain('TypeScript');
    expect(out).toContain('yes');
  });

  it('uses the singular "fact" when only one is visible', () => {
    const facts = [fact('framework', 'Framework', 'Next.js')];
    const { lastFrame } = render(
      <DiscoveryFeed facts={facts} tick={0} cols={WIDE} now={t0 + 1000} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('1 fact');
    // The plural form should not appear in the header.
    expect(out).not.toMatch(/\b1 facts\b/);
  });

  it('caps visible rows to MAX_VISIBLE and keeps the most recent ones', () => {
    // 12 facts, cap is 8 — we should see the last 8.
    const facts: DiscoveryFact[] = Array.from({ length: 12 }, (_, i) =>
      fact(`f${i}`, `Label ${i}`, `value-${i}`, i),
    );
    const { lastFrame } = render(
      <DiscoveryFeed facts={facts} tick={0} cols={WIDE} now={t0 + 3000} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('value-11');
    expect(out).toContain('value-4');
    // Earlier rows fall off the head.
    expect(out).not.toContain('value-0');
    expect(out).not.toContain('value-3');
  });

  it('honors discoveredAt — future-dated facts are not yet visible', () => {
    // Two facts in the past, one published "in the future" relative to now.
    const facts: DiscoveryFact[] = [
      fact('framework', 'Framework', 'Next.js'),
      fact('typescript', 'TypeScript', 'yes', 1),
      fact('region', 'Region', 'US', 5_000), // 5s in the future
    ];
    expect(resolveVisibleCount(facts, t0 + 300)).toBe(2);
    expect(resolveVisibleCount(facts, t0 + 6_000)).toBe(3);
  });
});
