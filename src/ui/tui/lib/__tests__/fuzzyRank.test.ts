/**
 * fuzzyRank — unit coverage.
 *
 * Pins the scoring tiers so a future refactor can't quietly flip
 * substring < subsequence (which would surface less-relevant matches
 * above more-relevant ones in the palette).
 */

import { describe, it, expect } from 'vitest';
import { fuzzyRank, type FuzzyRankItem } from '../fuzzyRank.js';

const items: FuzzyRankItem[] = [
  { id: 'help', label: 'help' },
  { id: 'whoami', label: 'whoami' },
  { id: 'region', label: 'region' },
  { id: 'diff', label: 'diff' },
  { id: 'diagnostics', label: 'diagnostics' },
  { id: 'dashboard', label: 'dashboard' },
  { id: 'logout', label: 'logout' },
];

describe('fuzzyRank', () => {
  it('returns items in original order when the query is empty', () => {
    const out = fuzzyRank('', items);
    expect(out.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('returns items in original order when the query is whitespace only', () => {
    const out = fuzzyRank('   ', items);
    expect(out.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('exact prefix beats substring beats subsequence', () => {
    const out = fuzzyRank('log', [
      // subsequence-only: l, then o, then g (with gaps)
      { id: 'lab-org', label: 'lab-org' },
      // substring match: contains "log" at offset 5
      { id: 'foo-log-bar', label: 'foo-log-bar' },
      // exact prefix
      { id: 'logout', label: 'logout' },
    ]);
    expect(out.map((i) => i.id)).toEqual(['logout', 'foo-log-bar', 'lab-org']);
  });

  it('exact prefix ranks shorter command first', () => {
    // Both `diff` and `diagnostics` are prefix matches for `di` — the
    // shorter one should win (closer to the literal query).
    const out = fuzzyRank('di', items);
    const ids = out.map((i) => i.id);
    expect(ids.indexOf('diff')).toBeLessThan(ids.indexOf('diagnostics'));
  });

  it('substring beats subsequence', () => {
    const out = fuzzyRank('out', [
      // pure subsequence — o, u, t appear with gaps
      { id: 'orchestrate', label: 'o-u-x-y-t' },
      // contiguous substring
      { id: 'logout', label: 'logout' },
    ]);
    expect(out.map((i) => i.id)).toEqual(['logout', 'orchestrate']);
  });

  it('subsequence with fewer gaps beats more gaps', () => {
    const out = fuzzyRank('abc', [
      // 'abc' as subsequence with lots of gaps
      { id: 'wide', label: 'aXXXbXXXc' },
      // 'abc' as subsequence with fewer gaps
      { id: 'tight', label: 'aXbXc' },
    ]);
    expect(out.map((i) => i.id)).toEqual(['tight', 'wide']);
  });

  it('matches via keywords when the label alone would miss', () => {
    const out = fuzzyRank('zone', [
      { id: 'help', label: 'help' },
      { id: 'region', label: 'region', keywords: ['zone', 'us', 'eu'] },
      { id: 'logout', label: 'logout' },
    ]);
    expect(out.map((i) => i.id)[0]).toBe('region');
  });

  it('filters out items with no matching tier', () => {
    const out = fuzzyRank('xyz', items);
    expect(out).toEqual([]);
  });

  it('preserves input order for items with equal scores (stable)', () => {
    // Two items, both pure subsequence matches with identical gap
    // counts — must keep the input order.
    const out = fuzzyRank('a', [
      { id: 'first', label: 'a-cat' },
      { id: 'second', label: 'a-dog' },
    ]);
    // Both are prefix matches with identical length — same score —
    // input order should be preserved.
    expect(out.map((i) => i.id)).toEqual(['first', 'second']);
  });

  it('is case-insensitive on both query and candidate', () => {
    const out = fuzzyRank('DIA', items);
    expect(out.map((i) => i.id)[0]).toBe('diagnostics');
  });

  it('does not mutate the input array', () => {
    const before = items.map((i) => i.id);
    fuzzyRank('log', items);
    expect(items.map((i) => i.id)).toEqual(before);
  });
});
